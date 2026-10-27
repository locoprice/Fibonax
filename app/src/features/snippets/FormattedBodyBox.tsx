import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Bold, Italic, List, ListOrdered, Underline, type LucideIcon } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import {
  blockText,
  chipLabel,
  docFromNode,
  docFromPlain,
  docToHtml,
  docToPlain,
  hasFormatting,
  positionAt,
  segmentTokens,
  syncDoc,
  type Block,
  type FormattedDoc,
  type Mark,
} from '@/lib/formattedBody';
import { cn } from '@/lib/utils';

/**
 * The snippet body box: text shown as it will look, with Bold, Italic,
 * Underline and the two lists, and every field as a chip.
 *
 * It keeps the contract of the plain text box it replaced, so every window in
 * the side panel works unchanged: `value`, `selectionStart` / `selectionEnd`
 * and `setSelectionRange` in plain-body characters, and `focus`. The plain
 * body stays the source; the layout beside it is reported with
 * `onLayoutChange`, or null while nothing is formatted
 * (lib/formattedBody.ts).
 */
export interface BodyBoxHandle {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  focus(options?: FocusOptions): void;
  setSelectionRange(start: number, end: number): void;
}

interface FormattedBodyBoxProps {
  id: string;
  /** The plain body of the language on screen. */
  value: string;
  /** That language's saved layout. Read when `slot` changes, never in between. */
  html: string | null;
  /** Which body is on screen (snippet and language). A new slot reloads the box. */
  slot: string;
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Text typed in the box, as the plain body. */
  onChange: (plain: string) => void;
  /** The layout after any change, or null while nothing is formatted. */
  onLayoutChange: (html: string | null) => void;
  /** Where the caret stands, in plain-body characters. */
  onCaret: (offset: number) => void;
}

type Command = 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList';

const TOOLS: readonly { command: Command; label: string; keys: string; Icon: LucideIcon }[] = [
  { command: 'bold', label: 'Bold', keys: 'Ctrl+B', Icon: Bold },
  { command: 'italic', label: 'Italic', keys: 'Ctrl+I', Icon: Italic },
  { command: 'underline', label: 'Underline', keys: 'Ctrl+U', Icon: Underline },
  { command: 'insertUnorderedList', label: 'Bullet list', keys: '', Icon: List },
  { command: 'insertOrderedList', label: 'Numbered list', keys: '', Icon: ListOrdered },
];

const CHIP =
  'mx-px inline-block rounded-[6px] bg-primary-light px-1.5 align-baseline font-mono text-[11px] leading-5 text-primary';

/** The document from a saved layout, read in an inert document so nothing in it runs. */
function docFromLayout(html: string | null, plain: string): FormattedDoc {
  if (!html) return docFromPlain(plain);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  // The text is the source: a layout saved alongside an older text follows it.
  return syncDoc(docFromNode(parsed.body), plain);
}

function wrapMarks(node: Node, marks: readonly Mark[]): Node {
  return [...marks].reverse().reduce<Node>((inner, mark) => {
    const el = document.createElement(mark);
    el.appendChild(inner);
    return el;
  }, node);
}

function marksAtChar(block: Block, char: number): Mark[] {
  let at = 0;
  for (const run of block.runs) {
    if (char < at + run.text.length) return run.marks;
    at += run.text.length;
  }
  return [];
}

/** One line's text and chips. An empty line holds a `<br>` so it keeps its height. */
function fillLine(line: HTMLElement, block: Block) {
  const text = blockText(block);
  if (text === '') {
    line.appendChild(document.createElement('br'));
    return;
  }
  let pos = 0;
  for (const seg of segmentTokens(text)) {
    if (seg.kind === 'token') {
      const chip = document.createElement('span');
      chip.contentEditable = 'false';
      chip.dataset.token = seg.raw;
      chip.title = seg.raw;
      chip.className = CHIP;
      chip.textContent = chipLabel(seg.raw);
      line.appendChild(wrapMarks(chip, marksAtChar(block, pos)));
      pos += seg.raw.length;
      continue;
    }
    const end = pos + seg.text.length;
    let at = 0;
    for (const run of block.runs) {
      const from = Math.max(pos, at);
      const to = Math.min(end, at + run.text.length);
      if (to > from) line.appendChild(wrapMarks(document.createTextNode(text.slice(from, to)), run.marks));
      at += run.text.length;
    }
    pos = end;
  }
}

/** Draws the document into the box: a `<div>` a line, lists as lists. */
function renderDoc(root: HTMLElement, doc: FormattedDoc) {
  root.replaceChildren();
  let i = 0;
  while (i < doc.length) {
    const block = doc[i] as Block;
    if (block.list === 'none') {
      const line = document.createElement('div');
      fillLine(line, block);
      root.appendChild(line);
      i += 1;
      continue;
    }
    const list = document.createElement(block.list === 'bullet' ? 'ul' : 'ol');
    while (i < doc.length && doc[i]?.list === block.list) {
      const item = document.createElement('li');
      fillLine(item, doc[i] as Block);
      list.appendChild(item);
      i += 1;
    }
    root.appendChild(list);
  }
}

/** The elements that hold one line each, in order, as `renderDoc` draws them. */
function lineElements(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.childNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      node.childNodes.forEach((item) => {
        if (item instanceof HTMLElement && item.tagName === 'LI') out.push(item);
      });
    } else {
      out.push(node);
    }
  });
  return out;
}

/** Plain-body characters before a DOM point: the box up to it, read as a document. */
function offsetAt(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  return docToPlain(docFromNode(holder)).length;
}

/** The DOM point of a plain-body offset. Inside a chip, the point after it. */
function pointAt(root: HTMLElement, doc: FormattedDoc, offset: number): { node: Node; offset: number } {
  const pos = positionAt(doc, offset);
  const line = lineElements(root)[pos.block];
  if (!line) return { node: root, offset: root.childNodes.length };
  let left = pos.char;
  // Text nodes and chips, in order. A chip's own label is not text of the line.
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      if (n instanceof HTMLElement) return n.dataset.token !== undefined ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      return n.parentElement?.closest('[data-token]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let last: Node | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof HTMLElement) {
      const length = (n.dataset.token ?? '').length;
      if (left === 0) return besideNode(n, 0);
      if (left < length) return besideNode(n, 1);
      left -= length;
    } else {
      const length = (n.textContent ?? '').length;
      if (left <= length) return { node: n, offset: left };
      left -= length;
    }
    last = n;
  }
  return last ? besideNode(last, 1) : { node: line, offset: 0 };
}

/** The point just before (0) or just after (1) a node. */
function besideNode(node: Node, after: 0 | 1): { node: Node; offset: number } {
  const parent = node.parentNode as Node;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) + after };
}

const EMPTY_DOC: FormattedDoc = [{ list: 'none', runs: [] }];

function layoutOf(doc: FormattedDoc): string | null {
  return hasFormatting(doc) ? docToHtml(doc) : null;
}

export const FormattedBodyBox = forwardRef<BodyBoxHandle, FormattedBodyBoxProps>(function FormattedBodyBox(
  { id, value, html, slot, placeholder, disabled, invalid, onChange, onLayoutChange, onCaret },
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Filled from the slot's layout as the box mounts (the slot effect below).
  const docRef = useRef<FormattedDoc>(EMPTY_DOC);
  // The layout and text of the slot on screen, read when the slot changes: in
  // between, the box itself is the source, and its own changes come back here.
  const loadRef = useRef({ html, value });
  loadRef.current = { html, value };
  // The last selection inside the box, kept while focus is in a window, the
  // way a text box keeps its own.
  const selRef = useRef({ start: value.length, end: value.length });
  const [active, setActive] = useState<Partial<Record<Command, boolean>>>({});
  const [empty, setEmpty] = useState(value === '');

  const draw = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    renderDoc(root, docRef.current);
    setEmpty(docToPlain(docRef.current) === '');
  }, []);

  // A new body on screen (another snippet, another language) starts from its layout.
  useLayoutEffect(() => {
    const load = loadRef.current;
    docRef.current = docFromLayout(load.html, load.value);
    selRef.current = { start: load.value.length, end: load.value.length };
    draw();
  }, [slot, draw]);

  // A change made outside the box (a window's Insert or Save, Remove, Undo,
  // Clear, a translation) is brought in, keeping the formatting around it.
  useLayoutEffect(() => {
    if (value === docToPlain(docRef.current)) return;
    docRef.current = syncDoc(docRef.current, value);
    draw();
    onLayoutChange(layoutOf(docRef.current));
  }, [value, draw, onLayoutChange]);

  const readSelection = useCallback((): { start: number; end: number } | null => {
    const root = rootRef.current;
    const sel = window.getSelection();
    // Only while the box has focus: once a window is open, the caret is the
    // one the box had, as in a text box.
    if (!root || !sel || sel.rangeCount === 0 || document.activeElement !== root) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const start = offsetAt(root, range.startContainer, range.startOffset);
    const end = range.collapsed ? start : offsetAt(root, range.endContainer, range.endOffset);
    return { start, end };
  }, []);

  const setSelection = useCallback((start: number, end: number) => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel) return;
    const a = pointAt(root, docRef.current, start);
    const b = end === start ? a : pointAt(root, docRef.current, end);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    sel.removeAllRanges();
    sel.addRange(range);
    selRef.current = { start, end };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      get value() {
        return docToPlain(docRef.current);
      },
      get selectionStart() {
        return (readSelection() ?? selRef.current).start;
      },
      get selectionEnd() {
        return (readSelection() ?? selRef.current).end;
      },
      focus(options?: FocusOptions) {
        rootRef.current?.focus(options);
      },
      setSelectionRange(start: number, end: number) {
        setSelection(start, end);
      },
    }),
    [readSelection, setSelection],
  );

  // The caret and the pressed buttons follow the selection while it is in the box.
  useEffect(() => {
    const onSelectionChange = () => {
      const now = readSelection();
      if (!now) return;
      selRef.current = now;
      onCaret(now.start);
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
      });
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [readSelection, onCaret]);

  function handleInput() {
    const root = rootRef.current;
    if (!root) return;
    docRef.current = docFromNode(root);
    const plain = docToPlain(docRef.current);
    setEmpty(plain === '');
    onChange(plain);
    onLayoutChange(layoutOf(docRef.current));
  }

  function apply(command: Command) {
    const root = rootRef.current;
    if (!root || disabled) return;
    if (!readSelection()) {
      root.focus();
      setSelection(selRef.current.start, selRef.current.end);
    }
    document.execCommand(command);
    handleInput();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // A line break inside a line would be a line the document cannot place:
    // Shift+Enter starts a new line, as Enter does.
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertParagraph');
    }
  }

  // Pasted text goes in as text, a line at a time. Formatting copied from
  // elsewhere is the Pro layout feature, not this box.
  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const lines = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, i) => {
      if (i > 0) document.execCommand('insertParagraph');
      if (line) document.execCommand('insertText', false, line);
    });
  }

  // A chip is one piece: clicking it puts the caret after it, where the
  // windows for that field and Insert both work.
  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const chip = (e.target as HTMLElement).closest('[data-token]');
    if (!chip || !rootRef.current?.contains(chip)) return;
    const range = document.createRange();
    range.setStartAfter(chip);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  // A field code typed by hand becomes a chip once the box is left.
  function handleBlur() {
    const root = rootRef.current;
    if (!root) return;
    const drawn = document.createElement('div');
    renderDoc(drawn, docRef.current);
    if (drawn.innerHTML !== root.innerHTML) draw();
  }

  return (
    <div
      className={cn(
        'flex min-h-[160px] w-full flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-card focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
        invalid && 'border-danger focus-within:border-danger focus-within:ring-danger/20',
        disabled && 'opacity-50',
      )}
    >
      <div role="toolbar" aria-label="Formatting" aria-controls={id} className="flex shrink-0 items-center gap-0.5 border-b border-line px-1.5 py-1">
        {TOOLS.map(({ command, label, keys, Icon }, i) => (
          <span key={command} className="flex items-center">
            {i === 3 && <span aria-hidden className="mx-1 h-4 w-px bg-line" />}
            <Tooltip label={keys ? `${label} (${keys})` : label} placement="top" className="flex">
              <button
                type="button"
                aria-label={label}
                aria-pressed={!!active[command]}
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(command)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors',
                  'hover:bg-bg-alt hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  active[command] && 'bg-primary-light text-primary hover:bg-primary-light hover:text-primary',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
          </span>
        ))}
      </div>
      <div
        id={id}
        ref={rootRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Body"
        aria-invalid={invalid || undefined}
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDrop={(e) => e.preventDefault()}
        onClick={handleClick}
        onBlur={handleBlur}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-3.5 py-3 text-sm leading-relaxed text-ink focus:outline-none',
          '[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6',
          empty &&
            'relative before:pointer-events-none before:absolute before:left-3.5 before:top-3 before:whitespace-pre-line before:text-ink-subtle before:content-[attr(data-placeholder)]',
        )}
      />
    </div>
  );
});
