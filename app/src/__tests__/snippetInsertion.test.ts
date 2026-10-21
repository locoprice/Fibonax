import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Line-break fidelity of the expansion writer — extension/content/content.js
// insertText(). It is the single choke point every expansion path funnels
// through (trigger match, overlay insert, picker, prompt shortcut), so pinning
// it here covers all of them.
//
// Three regressions are pinned, two found in July 2026 and one in September:
//
// 1. Windows line endings. The body was split on '\n' alone, so every line kept
//    a trailing '\r'. The CR rode into the message as an invisible character,
//    and a blank line — the lone "\r" segment — read as text rather than an
//    empty line, losing its break.
//
// 2. Lexical (WhatsApp Web). It accepts execCommand('insertLineBreak'),
//    RETURNS TRUE, and inserts nothing — so the insertParagraph →
//    insertText('\n') fallbacks never fired and a multi-paragraph snippet
//    landed as one dense block. Verified against a real Lexical editor:
//    "Buenos días Marco:\n\nSoy Valentina 🎉" arrived as
//    "Buenos días Marco:Soy Valentina 🎉". Lexical does honour a text/plain
//    paste, so multi-line bodies are offered to the editor as a paste first,
//    with the per-line path kept for every editor that doesn't claim it.
//
// 3. Lexical again. It keeps a native edit only when the edit changes a text
//    node it already has. A trigger that is a whole text node (the start of a
//    message, a new line, right after bold text) was removed by the browser as
//    a node and Lexical put it back: a one-line snippet did not expand at all,
//    and a longer one landed after the trigger. On a Lexical host the trigger
//    now goes through a beforeinput the editor claims, and every body, one line
//    or many, is offered as a paste.
//
// content.js is a content script (top-level chrome.* calls), so it cannot be
// imported. Slice the real shipping functions out of the source instead and run
// them against a recording document — the same "evaluate the real source"
// stance formulaConditions.test.ts and deletionSync.test.ts take.

type InsertText = (el: unknown, text: string) => void;

interface PasteRecord {
  type: string;
  text: string;
}
interface InputRecord {
  type: string;
  inputType: string;
  data: string | null;
  ranges: unknown[];
}
interface Recorded {
  cmds: Array<{ cmd: string; value: string | null }>;
  pastes: PasteRecord[];
  inputs: InputRecord[];
  // every command and event, in the order the browser was asked for them
  order: string[];
  inserted: string;
  // where the first line of the body was written: over the selected trigger, at
  // the caret, or at a caret the browser left on another line
  firstWrite: string | null;
}
interface Options {
  // false → the plain textarea/input branch
  contentEditable?: boolean;
  // the editor calls preventDefault on paste (Lexical does)
  claimsPaste?: boolean;
  // the editor claims the paste but writes nothing (hostile / untrusted-event
  // rejection) — the probe must then fall back to the per-line path
  swallowsPaste?: boolean;
  // the host is a Lexical root (data-lexical-editor="true"), as in WhatsApp Web
  lexical?: boolean;
  // the editor claims the beforeinput that removes the trigger; false models a
  // build that ignores it
  claimsDeletion?: boolean;
  // nothing is selected: a right-click insert at a bare caret
  collapsed?: boolean;
  // removing the trigger leaves the caret on another line (it was the whole of
  // its line), and what lies between that caret and where the trigger began:
  // an element (a <br> or a block) or a "\n" character (a pre-wrap field)
  movesCaret?: boolean;
  between?: 'element' | 'newline';
  // the page will not hand over its selection
  selectionThrows?: boolean;
}
interface DispatchedEvent {
  type: string;
  inputType?: string;
  data?: string | null;
  targetRanges?: Array<{ init: unknown }>;
  clipboardData?: { getData: (t: string) => string };
}

function sliceFunction(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`insertText: "${signature}" not found in content.js`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('insertText: unbalanced braces while slicing');
}

const source = readFileSync(
  resolve(process.cwd(), '..', 'extension', 'content', 'content.js'),
  'utf8',
);
// How a position in a field is counted: text, plus emoji pictures read as the
// emoji they show (Gmail). Every slice that measures or resolves a position
// needs these alongside it.
const positionHelpers = [
  (source.match(/^var EMOJI_IN_ALT_RE = .*;$/m) ?? [''])[0],
  ...[
    'function _ceEmojiPictureText(node) {',
    'function _ceUnitText(node) {',
    'function _ceUnitWalker(host) {',
    'function _ceVisibleText(host) {',
    'function _ceRangeLength(range, host) {',
    'function _cePointBeside(node, after) {',
  ].map((sig) => sliceFunction(source, sig)),
].join('\n');

const fnSource = [
  'function _ceHost(el) {',
  'function _isLexicalHost(host) {',
  'function _ceCaretCharOffset(host, fromStart) {',
  'function _ceWaitFor(test, ms, cb) {',
  'function _ceSendDelete(host, range) {',
  'function _ceRetryDelete(host, startCO, endCO, gone, end) {',
  'function _ceDeleteSelection(host, done) {',
  'function _ceLineInsert(text) {',
  'function _ceHoldSelection() {',
  'function _ceBringBackTrigger(held) {',
  'function _cePasteInsert(el, text) {',
  'function _cePasteLand(el, host, dt, text) {',
  'function insertText(el, text) {',
]
  .map((sig) => sliceFunction(source, sig))
  .join('\n');
// The verify and settle windows the confirmed delete reads are plain top-level
// vars in content.js, so they are lifted out the same way. This recording stub
// has no real selection offsets, so the confirmation steps aside here and the
// paste stays synchronous; the check itself is pinned by scripts/check-expansion.js.
const lexicalTimings = (source.match(/^var LEXICAL_[A-Z_]+ = \d+;/gm) ?? []).join('\n');

// Runs the real insertText against a stub editor and records everything it asked
// the browser to do: execCommand calls, beforeinput events and paste events.
function run(text: string, opts: Options = {}): Recorded {
  const {
    contentEditable = true,
    claimsPaste = false,
    swallowsPaste = false,
    lexical = false,
    claimsDeletion = true,
    collapsed = false,
    movesCaret = false,
    between,
    selectionThrows = false,
  } = opts;
  const cmds: Recorded['cmds'] = [];
  const pastes: PasteRecord[] = [];
  const inputs: InputRecord[] = [];
  const order: string[] = [];
  // Text the probe will see. A claimed, non-swallowed paste means the editor
  // wrote the body; a swallowed one leaves the field as it was.
  let fieldText = '';

  const el = {
    isContentEditable: contentEditable,
    tagName: contentEditable ? 'DIV' : 'TEXTAREA',
    getAttribute: (name: string) => {
      if (name === 'contenteditable') return contentEditable ? 'true' : null;
      if (name === 'data-lexical-editor') return lexical ? 'true' : null;
      return null;
    },
    parentElement: null,
    focus: () => {},
    get textContent() {
      return fieldText;
    },
    dispatchEvent: (ev: DispatchedEvent) => {
      order.push(ev.type);
      if (ev.type === 'beforeinput') {
        inputs.push({
          type: ev.type,
          inputType: ev.inputType ?? '',
          data: ev.data ?? null,
          ranges: (ev.targetRanges ?? []).map((r) => r.init),
        });
        return !claimsDeletion; // false: preventDefault, the editor claimed it
      }
      const pasted = ev.clipboardData ? ev.clipboardData.getData('text/plain') : '';
      pastes.push({ type: ev.type, text: pasted });
      if (!claimsPaste) return true; // not prevented: the editor ignored it
      if (!swallowsPaste) fieldText += pasted;
      return false; // preventDefault → the editor claimed it
    },
  };

  // Where the next write lands: over the selected trigger, at the caret, or at a
  // caret the browser left on another line once the trigger was removed.
  let at = collapsed ? 'caret' : 'trigger';
  let removed = false;
  let firstWrite: string | null = null;

  const doc = {
    activeElement: el,
    execCommand: (cmd: string, _ui: boolean, value: string | null) => {
      order.push('execCommand:' + cmd);
      cmds.push({ cmd, value: value ?? null });
      if (cmd === 'insertText' && value === '' && !removed) {
        removed = true;
        at = movesCaret && !collapsed ? 'moved' : 'caret';
      } else if (firstWrite === null) {
        firstWrite = at;
      }
      return true; // Lexical's lie: reports success for commands it drops
    },
    // What _ceBringBackTrigger reads: the range between the caret and where the
    // trigger began, and the selection it builds over the trigger it gives back.
    createRange: () => {
      const r = {
        tag: 'range',
        setStart: () => {},
        setEnd: () => {},
        selectNodeContents: () => {
          r.tag = 'trigger';
        },
        cloneContents: () => ({
          querySelector: () => (between === 'element' ? {} : null),
          textContent: between === 'newline' ? '\n' : '',
        }),
      };
      return r;
    },
    createTextNode: (value: string) => ({ nodeValue: value }),
  };

  // The selection deleteChars set over the trigger (or a bare caret).
  const range = {
    collapsed,
    startContainer: 'trigger-start',
    startOffset: 0,
    endContainer: 'trigger-end',
    endOffset: 6,
    toString: () => (collapsed ? '' : '::multi'),
    // the start of the selection, held across the removal of the trigger
    cloneRange: () => ({
      startContainer: 'trigger-start',
      startOffset: 0,
      collapse: () => {},
      comparePoint: () => -1,
      insertNode: () => {
        order.push('trigger back');
      },
    }),
  };
  const win = {
    getSelection: () => {
      if (selectionThrows) throw new Error('no selection');
      return {
        rangeCount: 1,
        getRangeAt: () => range,
        removeAllRanges: () => {},
        addRange: (r: { tag: string }) => {
          order.push('select');
          at = r.tag;
        },
      };
    },
  };
  class StubStaticRange {
    init: unknown;
    constructor(init: unknown) {
      this.init = init;
    }
  }
  class StubInputEvent {
    type: string;
    inputType: string;
    data: string | null;
    targetRanges: StubStaticRange[];
    constructor(
      type: string,
      init: { inputType: string; data: string | null; targetRanges: StubStaticRange[] },
    ) {
      this.type = type;
      this.inputType = init.inputType;
      this.data = init.data;
      this.targetRanges = init.targetRanges;
    }
  }

  class StubDataTransfer {
    private data: Record<string, string> = {};
    setData(type: string, value: string) {
      this.data[type] = value;
    }
    getData(type: string) {
      return this.data[type] ?? '';
    }
  }
  class StubClipboardEvent {
    type: string;
    clipboardData: StubDataTransfer;
    constructor(type: string, init: { clipboardData: StubDataTransfer }) {
      this.type = type;
      this.clipboardData = init.clipboardData;
    }
  }

  // insertText also asks whether the snippet is opening a sentence, which needs
  // a live caret this recording stub deliberately does not have. Answer no, so
  // what is pinned here stays line-break fidelity alone. The auto-capitalization
  // rules are pinned against the same shipping source in
  // snippetAutoCapitalize.test.ts.
  const factory = new Function(
    'document',
    'DataTransfer',
    'ClipboardEvent',
    '_shouldAutoCap',
    'window',
    'InputEvent',
    'StaticRange',
    `${lexicalTimings}\n${positionHelpers}\n${fnSource}\nreturn insertText;`,
  ) as (
    d: unknown,
    dt: unknown,
    ce: unknown,
    cap: () => boolean,
    w: unknown,
    ie: unknown,
    sr: unknown,
  ) => InsertText;

  factory(
    doc,
    StubDataTransfer,
    StubClipboardEvent,
    () => false,
    win,
    StubInputEvent,
    StubStaticRange,
  )(el, text);

  return { cmds, pastes, inputs, order, inserted: textOf(cmds), firstWrite };
}

// The text a recorded command sequence actually writes into the field.
function textOf(cmds: Recorded['cmds']): string {
  return cmds.map((c) => (c.cmd === 'insertText' ? (c.value ?? '') : '\n')).join('');
}

const CRLF = 'Hi Marco,\r\n\r\nVilla Casa Azul is free 12-19 Aug.\r\n\r\nBest,\r\nValentina';
const LF = CRLF.replace(/\r\n/g, '\n');

describe('snippet expansion — line-break fidelity', () => {
  it('writes a CRLF body exactly like its LF equivalent (contenteditable)', () => {
    expect(run(CRLF).cmds).toEqual(run(LF).cmds);
  });

  it('keeps every blank line in a CRLF body', () => {
    const { cmds, inserted } = run(CRLF);
    // The leading consume (see the paste route) contributes nothing to the text.
    expect(inserted).toBe(LF);
    const breaks = cmds.filter((c) => c.cmd !== 'insertText').length;
    expect(breaks).toBe((LF.match(/\n/g) ?? []).length);
  });

  it('never emits a carriage return into the field', () => {
    for (const ce of [true, false]) {
      for (const body of [CRLF, 'Alpha\rBeta\r\rDelta', LF]) {
        const { cmds, pastes } = run(body, { contentEditable: ce, claimsPaste: ce });
        expect(cmds.some((c) => (c.value ?? '').includes('\r'))).toBe(false);
        expect(pastes.some((p) => p.text.includes('\r'))).toBe(false);
      }
    }
  });

  it('normalizes CRLF on the plain textarea/input path too', () => {
    expect(run(CRLF, { contentEditable: false }).cmds).toEqual([
      { cmd: 'insertText', value: LF },
    ]);
  });

  it('leaves plain unformatted text untouched', () => {
    const plain = 'Checking availability now, one moment.';
    expect(run(plain).cmds).toEqual([{ cmd: 'insertText', value: plain }]);
    expect(run(plain, { contentEditable: false }).cmds).toEqual([
      { cmd: 'insertText', value: plain },
    ]);
  });

  it('preserves indentation and repeated spaces verbatim', () => {
    const indented = 'Details:\n    - Villa: Casa Azul\n    - Dates:  12-19 Aug';
    expect(run(indented).inserted).toBe(indented);
    expect(run(indented, { contentEditable: false }).cmds).toEqual([
      { cmd: 'insertText', value: indented },
    ]);
  });
});

describe('snippet expansion: editors that claim a paste', () => {
  it('offers a multi-line body as a text/plain paste', () => {
    const { pastes } = run(LF, { claimsPaste: true });
    expect(pastes).toEqual([{ type: 'paste', text: LF }]);
  });

  it('consumes the trigger before pasting, so no shortcut fragment survives', () => {
    // A paste event carries no target ranges: the editor would paste at its own
    // cached caret and leave "::neob" in the field. Outside Lexical, an empty
    // execCommand('insertText') over the selection deleteChars set removes it.
    const { cmds } = run(LF, { claimsPaste: true });
    expect(cmds[0]).toEqual({ cmd: 'insertText', value: '' });
    // and nothing else: the paste carried the body
    expect(cmds).toHaveLength(1);
  });

  it('keeps a single-line body off the paste route outside Lexical', () => {
    const { pastes, cmds } = run('Todo confirmado', { claimsPaste: true });
    expect(pastes).toEqual([]);
    expect(cmds).toEqual([{ cmd: 'insertText', value: 'Todo confirmado' }]);
  });

  it('falls back to per-line insertion when the editor ignores the paste', () => {
    const { cmds, inserted } = run(LF, { claimsPaste: false });
    expect(inserted).toBe(LF);
    expect(cmds.filter((c) => c.cmd === 'insertLineBreak').length).toBe(
      (LF.match(/\n/g) ?? []).length,
    );
  });

  it('recovers when the editor claims the paste but writes nothing', () => {
    vi.useFakeTimers();
    try {
      const { cmds } = run(LF, { claimsPaste: true, swallowsPaste: true });
      expect(cmds).toHaveLength(1); // only the trigger consume, so far
      vi.advanceTimersByTime(200); // probe fires, sees an empty field
      expect(textOf(cmds)).toBe(LF);
      expect(cmds.filter((c) => c.cmd === 'insertLineBreak').length).toBe(
        (LF.match(/\n/g) ?? []).length,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('snippet expansion: Lexical (WhatsApp Web)', () => {
  const lexical = { lexical: true, claimsPaste: true };
  const TRIGGER = { startContainer: 'trigger-start', startOffset: 0, endContainer: 'trigger-end', endOffset: 6 };

  it('offers a single-line body as a paste too', () => {
    const { pastes, cmds } = run('Todo confirmado', lexical);
    expect(pastes).toEqual([{ type: 'paste', text: 'Todo confirmado' }]);
    expect(cmds).toEqual([]);
  });

  it('removes the trigger through a beforeinput the editor claims, then pastes', () => {
    for (const body of ['Todo confirmado', LF]) {
      const { inputs, order } = run(body, lexical);
      expect(inputs).toEqual([
        { type: 'beforeinput', inputType: 'insertText', data: '', ranges: [TRIGGER] },
      ]);
      // No native edit: Lexical undoes one over a whole text node.
      expect(order).toEqual(['beforeinput', 'paste']);
    }
  });

  it('falls back to execCommand when the editor does not claim the removal', () => {
    const { inputs, order } = run(LF, { ...lexical, claimsDeletion: false });
    expect(inputs).toHaveLength(1);
    expect(order).toEqual(['beforeinput', 'execCommand:insertText', 'paste']);
  });

  it('has nothing to remove at a bare caret (right-click insert)', () => {
    const { inputs, pastes } = run('Todo confirmado', { ...lexical, collapsed: true });
    expect(inputs).toEqual([]);
    expect(pastes).toEqual([{ type: 'paste', text: 'Todo confirmado' }]);
  });

  it('falls back to per-line insertion when the editor ignores the paste', () => {
    const { inserted } = run('Todo confirmado', { lexical: true, claimsPaste: false });
    expect(inserted).toBe('Todo confirmado');
  });
});

describe('snippet expansion: a trigger at the start of a new line', () => {
  // A trigger typed after a line break sits in its own text node, after the
  // <br>. Its start offset falls exactly between two text nodes, and resolving
  // it to the end of the first made the range take the <br> as well: the
  // form-field window and the fill-in box replaced the line break, and Undo
  // removed it.
  type Point = { node: unknown; offset: number };
  const toPoint = new Function(
    'document',
    'NodeFilter',
    `${positionHelpers}\n${sliceFunction(source, 'function _ceCharOffsetToPoint(')}\nreturn _ceCharOffsetToPoint;`,
  )(
    {
      createTreeWalker: (root: { childNodes: unknown[] }) => {
        let i = -1;
        return { nextNode: () => root.childNodes[++i] ?? null };
      },
    },
    { SHOW_TEXT: 4 },
  ) as (host: unknown, target: number, atStart?: boolean) => Point;

  const nodes = [{ nodeValue: 'Line A' }, { nodeValue: '::fld' }];
  const host = { childNodes: nodes };

  it('starts a range at the text after the boundary', () => {
    expect(toPoint(host, 6, true)).toEqual({ node: nodes[1], offset: 0 });
  });

  it('still ends a range at the text before the boundary', () => {
    expect(toPoint(host, 6)).toEqual({ node: nodes[0], offset: 6 });
  });

  it('resolves an offset inside a text node the same either way', () => {
    expect(toPoint(host, 8, true)).toEqual({ node: nodes[1], offset: 2 });
    expect(toPoint(host, 8)).toEqual({ node: nodes[1], offset: 2 });
  });

  it('keeps a start at the very end on the last text node', () => {
    expect(toPoint(host, 11, true)).toEqual({ node: nodes[1], offset: 5 });
  });
});

describe('positions in a field that shows emoji as pictures (Gmail)', () => {
  // Gmail shows each emoji as <img alt="☺️"> with no text behind it. Counted as
  // nothing, a snippet ending in one measured 2 characters short: Undo started
  // 2 characters early ("Hola " came back as "Hol") and stopped before the
  // picture, leaving the emoji. v3.68.5.
  interface MiniNode {
    nodeType: number;
    nodeValue: string | null;
    tagName?: string;
    alt?: string;
    parentNode: MiniNode | null;
    childNodes: MiniNode[];
    firstChild: MiniNode | null;
    nextSibling: MiniNode | null;
    getAttribute: (name: string) => string | null;
    querySelectorAll: (sel: string) => MiniNode[];
  }
  const text = (value: string): MiniNode => ({
    nodeType: 3, nodeValue: value, parentNode: null, childNodes: [], firstChild: null, nextSibling: null,
    getAttribute: () => null, querySelectorAll: () => [],
  });
  const picture = (alt: string): MiniNode => ({
    nodeType: 1, nodeValue: null, tagName: 'IMG', alt, parentNode: null, childNodes: [], firstChild: null,
    nextSibling: null, getAttribute: (name) => (name === 'alt' ? alt : null), querySelectorAll: () => [],
  });
  function field(...children: MiniNode[]): MiniNode {
    const host: MiniNode = {
      nodeType: 1, nodeValue: null, tagName: 'DIV', parentNode: null, childNodes: children,
      firstChild: children[0] ?? null, nextSibling: null, getAttribute: () => null,
      querySelectorAll: (sel) => (sel === 'img' ? children.filter((c) => c.tagName === 'IMG') : []),
    };
    children.forEach((c, i) => { c.parentNode = host; c.nextSibling = children[i + 1] ?? null; });
    return host;
  }
  const NF = { SHOW_TEXT: 4, SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 };
  const doc = {
    createTreeWalker: (root: MiniNode, _what: number, filter: { acceptNode: (n: MiniNode) => number }) => {
      const order: MiniNode[] = [];
      (function visit(n: MiniNode) { n.childNodes.forEach((c) => { order.push(c); visit(c); }); })(root);
      const shown = order.filter((n) => filter.acceptNode(n) === NF.FILTER_ACCEPT);
      let i = -1;
      return { nextNode: () => shown[++i] ?? null };
    },
  };
  const api = new Function(
    'document',
    'NodeFilter',
    positionHelpers + '\n' + sliceFunction(source, 'function _ceCharOffsetToPoint(') +
      '\nreturn { toPoint: _ceCharOffsetToPoint, visibleText: _ceVisibleText, rangeLength: _ceRangeLength };',
  )(doc, NF) as {
    toPoint: (host: MiniNode, target: number, atStart?: boolean) => { node: MiniNode; offset: number };
    visibleText: (host: MiniNode) => string;
    rangeLength: (range: { toString(): string; intersectsNode(n: MiniNode): boolean }, host: MiniNode) => number;
  };

  // "Hola " typed, then a snippet "Hi Pedro ☺️" whose emoji Gmail showed as a picture.
  const typed = text('Hola Hi Pedro ');
  const emoji = picture('☺️');
  const host = field(typed, emoji);
  const SNIPPET = 'Hi Pedro ☺️';

  it('reads the picture as the emoji it shows', () => {
    expect(api.visibleText(host)).toBe('Hola ' + SNIPPET);
  });

  it('counts the picture when measuring up to a caret after it', () => {
    // Everything up to the caret: the text, plus the picture inside the range.
    const upToCaret = { toString: () => typed.nodeValue ?? '', intersectsNode: (n: MiniNode) => n === emoji };
    expect(api.rangeLength(upToCaret, host)).toBe(('Hola ' + SNIPPET).length);
  });

  it('gives Undo a region that keeps what was typed and takes the picture', () => {
    const end = ('Hola ' + SNIPPET).length;
    const start = end - SNIPPET.length;
    expect(api.toPoint(host, start, true)).toEqual({ node: typed, offset: 5 });
    expect(api.toPoint(host, end)).toEqual({ node: host, offset: 2 }); // just after the picture
  });

  it('starts a region before a picture that opens it', () => {
    const opening = picture('🙂');
    const after = text(' hi');
    const h = field(text('Hola '), opening, after);
    expect(api.toPoint(h, 5, true)).toEqual({ node: h, offset: 1 }); // just before the picture
  });

  it('leaves pictures that are not an emoji out of the count, as before', () => {
    const h = field(text('Hi '), picture(':smile:'), text('there'));
    expect(api.visibleText(h)).toBe('Hi there');
  });
});

describe('snippet expansion: re-selecting the trigger after the fill window closes', () => {
  // When the fill window closes, focus falls on the page itself. Gmail moves
  // its caret back to where it last was when its field regains focus, so the
  // field must be focused before the trigger is selected. The old check asked
  // whether the focused element contains the field, which document.body always
  // does: the field was never focused, Gmail put its caret back after the
  // selection was made, and the snippet landed after the trigger
  // ("::timeBuenos días Pedro…"). v3.68.5.
  type Node = { nodeValue: string };
  interface Field {
    childNodes: Node[];
    parentElement: null;
    getAttribute: (name: string) => string | null;
    contains: (other: unknown) => boolean;
    focus: () => void;
  }

  function setup(focusOnField: boolean) {
    const text: Node = { nodeValue: '::time' };
    const order: string[] = [];
    let selected: { start: number; end: number } | null = null;
    const page = { contains: () => true };
    const field: Field = {
      childNodes: [text],
      parentElement: null,
      getAttribute: (name) => (name === 'contenteditable' ? 'true' : null),
      contains: (other) => other === field || other === text,
      focus: () => {
        order.push('focus');
        doc.activeElement = field;
        // Gmail: its caret comes back after the trigger, dropping any selection.
        selected = { start: 6, end: 6 };
      },
    };
    const doc: { activeElement: unknown; createTreeWalker: unknown; createRange: unknown } = {
      activeElement: focusOnField ? field : page,
      createTreeWalker: (root: Field) => {
        let i = -1;
        return { nextNode: () => root.childNodes[++i] ?? null };
      },
      createRange: () => {
        const r = { start: 0, end: 0, collapsed: true, toString: () => text.nodeValue.slice(r.start, r.end) };
        return Object.assign(r, {
          setStart: (_n: unknown, o: number) => { r.start = o; r.collapsed = r.start === r.end; },
          setEnd: (_n: unknown, o: number) => { r.end = o; r.collapsed = r.start === r.end; },
        });
      },
    };
    const win = {
      getSelection: () => ({
        removeAllRanges: () => { selected = null; },
        addRange: (r: { start: number; end: number }) => {
          order.push('select');
          selected = { start: r.start, end: r.end };
        },
      }),
    };
    const restore = new Function(
      'document',
      'window',
      'NodeFilter',
      [
        'function _ceHost(el) {',
        'function _ceFocusInHost(el) {',
        'function _ceCharOffsetToPoint(host, target, atStart) {',
        'function _ceRestoreTriggerRange(el, caretCO, n) {',
      ].map((sig) => sliceFunction(source, sig)).join('\n') + '\n' + positionHelpers + '\nreturn _ceRestoreTriggerRange;',
    )(doc, win, { SHOW_TEXT: 4 }) as (el: unknown, caretCO: number, n: number) => boolean;
    return { restore, field, order, selection: () => selected };
  }

  it('focuses the field first when focus fell on the page, so the trigger stays selected', () => {
    const t = setup(false);
    expect(t.restore(t.field, 6, 6)).toBe(true);
    expect(t.order).toEqual(['focus', 'select']);
    expect(t.selection()).toEqual({ start: 0, end: 6 });
  });

  it('leaves focus alone when it is already in the field', () => {
    const t = setup(true);
    expect(t.restore(t.field, 6, 6)).toBe(true);
    expect(t.order).toEqual(['select']);
    expect(t.selection()).toEqual({ start: 0, end: 6 });
  });
});

describe('Undo after a contenteditable insert', () => {
  // Undo deletes [endCharOffset - visibleLen, endCharOffset), counted in text
  // characters from the start of the field. A field styled white-space:
  // pre-wrap takes each line break as a "\n" character, and those offsets count
  // it: a length read off the text alone left one character of the snippet
  // behind per line break ("Hi ::multi" undid to "Hi Li").
  interface Marked {
    syncInserted?: boolean;
    visibleLen?: number;
    endCharOffset?: number;
  }
  // _ceMeasureBefore's reading: the replaced selection and the field's length.
  type Before = { start: number; end: number; total: number };
  type Mark = (snapshot: Marked, el: unknown, before: Before, text: string) => void;
  // The field here is plain text, so its counted text is its text.
  const markWith = new Function(
    '_ceCaretCharOffset',
    '_ceVisibleText',
    [
      sliceFunction(source, 'function _ceHost(el) {'),
      sliceFunction(source, 'function _isLexicalHost(host) {'),
      sliceFunction(source, 'function _markSyncInserted('),
      'return _markSyncInserted;',
    ].join('\n'),
  ) as (caretCharOffset: () => number, visibleText: (host: { textContent: string }) => string) => Mark;

  // field: the field's text once insertText has returned. caret: where its live
  // caret stands then. startCO: where the insert began.
  function mark(
    opts: { field: string; caret: number; startCO?: number; lexical?: boolean; before?: Before },
    text: string,
  ): Marked {
    const el = {
      getAttribute: (name: string) => {
        if (name === 'contenteditable') return 'true';
        if (name === 'data-lexical-editor') return opts.lexical ? 'true' : null;
        return null;
      },
      parentElement: null,
      textContent: opts.field,
    };
    const snapshot: Marked = {};
    // No reading of the field from before the insert (total -1): the length is
    // counted from the snippet's text, the fallback these first cases pin.
    const before = opts.before ?? { start: opts.startCO ?? 3, end: opts.startCO ?? 3, total: -1 };
    markWith(() => opts.caret, (host) => host.textContent)(snapshot, el, before, text);
    return snapshot;
  }
  const region = (s: Marked) => [(s.endCharOffset ?? 0) - (s.visibleLen ?? 0), s.endCharOffset];

  const BODY = 'Line one\n\nLine two'; // 16 characters of text, 2 line breaks

  it('covers the line breaks a pre-wrap field wrote as characters', () => {
    // "Hi " and then the body with its two "\n": the caret ends at 3 + 18.
    expect(region(mark({ field: 'Hi Line one\n\nLine two', caret: 21 }, BODY))).toEqual([3, 21]);
  });

  it('reads nothing after the caret', () => {
    const field = 'Hi Line one\n\nLine two\nand the rest';
    expect(region(mark({ field, caret: 21 }, BODY))).toEqual([3, 21]);
  });

  it('covers a field that wrote its line breaks as <br>', () => {
    // A <br> is no character: the field's text runs the lines together.
    expect(region(mark({ field: 'Hi Line oneLine two', caret: 19 }, BODY))).toEqual([3, 19]);
  });

  it('follows the caret to wherever the snippet landed', () => {
    // The trigger sat at 6, after "Line A", and the snippet went in at the
    // start of the field: Undo takes the snippet, not the text after 6.
    const field = 'Line oneLine twoLine A';
    expect(region(mark({ field, caret: 16, startCO: 6 }, BODY))).toEqual([0, 16]);
  });

  it('counts from the start on Lexical, whose paste has not landed yet', () => {
    expect(region(mark({ field: 'Hi ', caret: 3, lexical: true }, BODY))).toEqual([3, 19]);
  });

  // Gmail tidies the text as it lands: it drops the space at the end of the
  // first line and shows the emoji as a picture (counted as the emoji). The
  // snippet's own text is then one character longer than what landed, and a
  // length counted from it took the space typed before the snippet. The field
  // grew by exactly what landed, so measuring the growth is right. v3.68.5.
  it('measures what landed when the editor tidies the text (Gmail)', () => {
    const line1 = 'x'.repeat(102); // landed without its trailing space
    const line2 = 'y'.repeat(120) + '☺️';
    const snippet = line1 + ' \n' + line2 + '\n\n';
    const field = 'Hola ' + line1 + line2 + '\n'; // the stray line break was there before
    const before = { start: 5, end: 11, total: 'Hola ::time\n'.length };
    expect(region(mark({ field, caret: 5 + line1.length + line2.length, before }, snippet))).toEqual([5, 229]);
  });

  it('keeps the counted length when the editor has not written the text yet', () => {
    // The trigger is gone and the paste is still on its way: the field has not grown.
    const s = mark({ field: 'Hi ', caret: 3, before: { start: 3, end: 9, total: 9 } }, BODY);
    expect(s.visibleLen).toBe(16);
  });

  it('falls back to the text when the caret is not in the field', () => {
    expect(mark({ field: 'Hi Line one\n\nLine two', caret: -1 }, BODY)).toEqual({
      syncInserted: true,
      visibleLen: 16,
      endCharOffset: -1,
    });
  });
});

describe('snippet expansion: a trigger that is the whole of its line', () => {
  // Removing a trigger that was alone on its line makes the line disappear, and
  // the browser moves the caret to another line: the end of the line above, the
  // start of the next one, or the start of the field. Where the page ignores the
  // paste, the body was then written line by line at that caret ("Line ALine one"),
  // joined to the text of another line, with the line it was typed on left empty.
  // A one-line body never did this: its first execCommand replaces the selected
  // trigger in one step. The multi-line path now gives the trigger back, selected,
  // so its first line does the same. The real shapes (Shift+Enter and Enter lines,
  // a pre-wrap field, Gmail-style div lines) were checked in the browser; this
  // pins the order of what is asked of it. v3.74.2.
  const BACK = [
    'execCommand:insertText', // the trigger goes
    'paste', // the page ignores the paste
    'trigger back',
    'select',
    'execCommand:insertText', // the first line replaces it
  ];

  it('writes the first line over the trigger when removing it moved the caret to another line', () => {
    const { firstWrite, order, inserted } = run(LF, { movesCaret: true, between: 'element' });
    expect(order.slice(0, BACK.length)).toEqual(BACK);
    expect(firstWrite).toBe('trigger');
    expect(inserted).toBe(LF);
  });

  it('does the same in a field that writes its line breaks as characters (pre-wrap)', () => {
    const { firstWrite, order } = run(LF, { movesCaret: true, between: 'newline' });
    expect(order.slice(0, BACK.length)).toEqual(BACK);
    expect(firstWrite).toBe('trigger');
  });

  it('leaves the caret where the browser put it when nothing but a tag lies between', () => {
    // A caret that only moved past formatting (bold, a link) is still on the line.
    const { firstWrite, order } = run(LF, { movesCaret: true });
    expect(order).not.toContain('trigger back');
    expect(firstWrite).toBe('moved');
  });

  it('leaves the caret alone when it never left the trigger', () => {
    const { firstWrite, order } = run(LF);
    expect(order).not.toContain('trigger back');
    expect(firstWrite).toBe('caret');
  });

  it('leaves the field alone when the editor claims the paste', () => {
    const { order, firstWrite } = run(LF, { claimsPaste: true, movesCaret: true, between: 'element' });
    expect(order).toEqual(['execCommand:insertText', 'paste']);
    expect(firstWrite).toBeNull();
  });

  it('has nothing to give back at a bare caret (right-click insert)', () => {
    const { order, firstWrite } = run(LF, { collapsed: true, movesCaret: true, between: 'element' });
    expect(order).not.toContain('trigger back');
    expect(firstWrite).toBe('caret');
  });

  it('keeps a one-line body replacing the trigger in one step', () => {
    const { order, firstWrite } = run('Todo confirmado', { movesCaret: true, between: 'element' });
    expect(order).toEqual(['execCommand:insertText']);
    expect(firstWrite).toBe('trigger');
  });

  it('still writes the body when the page will not hand over its selection', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { inserted, order } = run(LF, { selectionThrows: true });
      expect(inserted).toBe(LF);
      expect(order).not.toContain('trigger back');
      expect(quiet).toHaveBeenCalledTimes(1);
    } finally {
      quiet.mockRestore();
    }
  });

  it('does not touch the Lexical path', () => {
    const { order } = run(LF, { lexical: true, movesCaret: true, between: 'element' });
    expect(order.slice(0, 3)).toEqual(['beforeinput', 'paste', 'execCommand:insertText']);
    expect(order).not.toContain('trigger back');
    expect(order).not.toContain('select');
  });
});

describe('Undo keeps the space in front of the snippet', () => {
  // "Hi " typed at the end of a plain field is kept by Chrome as a non-breaking
  // space, and becomes a normal one once the trigger's first colon follows. Undo
  // removes the snippet with Range.deleteContents, which skips that clean-up and
  // leaves a normal space at the end of the line. Chrome draws nothing for it (a
  // zero-width box) and drops it when typing resumes: "Hi " undone, then "there"
  // typed, read "Hithere". A field that keeps its spaces (white-space: pre-wrap)
  // draws it, and it stays as typed. v3.74.1.
  interface TextNode {
    nodeType: number;
    nodeValue: string;
    replaceData: (offset: number, count: number, data: string) => void;
  }
  interface Snapshot {
    type: string;
    el: unknown;
    syncInserted: boolean;
    endCharOffset: number;
    visibleLen: number;
  }
  const NF = { SHOW_TEXT: 4, SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 };

  // The text of a one-line field after Undo has taken the snippet out of it.
  function undoLeaves(opts: { before: string; snippet: string; drawn: boolean }): string {
    const node: TextNode = {
      nodeType: 3,
      nodeValue: opts.before + opts.snippet,
      replaceData: (offset, count, data) => {
        node.nodeValue = node.nodeValue.slice(0, offset) + data + node.nodeValue.slice(offset + count);
      },
    };
    const host = {
      nodeType: 1,
      childNodes: [node],
      parentElement: null,
      contains: () => true,
      focus: () => {},
      dispatchEvent: () => true,
      getAttribute: (name: string) => (name === 'contenteditable' ? 'true' : null),
    };
    const makeRange = () => {
      const r = {
        start: 0,
        end: 0,
        setStart: (_n: unknown, offset: number) => {
          r.start = offset;
        },
        setEnd: (_n: unknown, offset: number) => {
          r.end = offset;
        },
        collapse: () => {},
        deleteContents: () => {
          node.nodeValue = node.nodeValue.slice(0, r.start) + node.nodeValue.slice(r.end);
        },
        // Chrome gives a space it does not draw a box of no width
        getClientRects: () => [{ width: opts.drawn ? 4.4 : 0 }],
      };
      return r;
    };
    const doc = {
      activeElement: host,
      createRange: makeRange,
      createTreeWalker: (
        root: { childNodes: TextNode[] },
        _what: number,
        filter: { acceptNode: (n: TextNode) => number },
      ) => {
        const shown = root.childNodes.filter((n) => filter.acceptNode(n) === NF.FILTER_ACCEPT);
        let i = -1;
        return { nextNode: () => shown[++i] ?? null };
      },
    };
    const win = { getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {} }) };
    class StubEvent {}
    const restore = new Function(
      'document',
      'window',
      'NodeFilter',
      'InputEvent',
      'Event',
      positionHelpers +
        '\n' +
        [
          'function _ceHost(el) {',
          'function _isLexicalHost(host) {',
          'function _ceCharOffsetToPoint(host, target, atStart) {',
          'function _ceHoldSpace(at) {',
          'function restoreFieldState(snapshot) {',
        ]
          .map((sig) => sliceFunction(source, sig))
          .join('\n') +
        '\nreturn restoreFieldState;',
    )(doc, win, NF, StubEvent, StubEvent) as (snapshot: Snapshot) => void;

    restore({
      type: 'ce',
      el: host,
      syncInserted: true,
      endCharOffset: node.nodeValue.length,
      visibleLen: opts.snippet.length,
    });
    return node.nodeValue;
  }

  const SNIPPET = 'Hello there.';

  it('keeps the space as a non-breaking one when no box is drawn for it', () => {
    expect(undoLeaves({ before: 'Hi ', snippet: SNIPPET, drawn: false })).toBe('Hi\u00a0');
  });

  it('leaves the space alone in a field that draws it (pre-wrap)', () => {
    expect(undoLeaves({ before: 'Hi ', snippet: SNIPPET, drawn: true })).toBe('Hi ');
  });

  it('changes only the space next to the snippet', () => {
    expect(undoLeaves({ before: 'Hi there ', snippet: SNIPPET, drawn: false })).toBe('Hi there\u00a0');
  });

  it('has nothing to keep when the snippet followed a letter', () => {
    expect(undoLeaves({ before: 'Hi', snippet: SNIPPET, drawn: false })).toBe('Hi');
  });

  it('has nothing to keep when the snippet opened the field', () => {
    expect(undoLeaves({ before: '', snippet: SNIPPET, drawn: false })).toBe('');
  });
});
