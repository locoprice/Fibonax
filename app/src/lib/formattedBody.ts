/**
 * A snippet body with formatting: Bold, Italic, Underline, bullet and
 * numbered lists. The model behind the editor's formatted box.
 *
 * The plain body stays the source that every builder, list and rule reads.
 * Each of its lines is one block here, and a list line carries its prefix in
 * the plain text ("• ", "1. "), which is also what a chat or a plain box gets.
 * The layout saved beside it (`body_html`) is the same lines as HTML with
 * fields left as their codes, so the fill form fills it exactly as it fills
 * the plain body (docs/FORMATTED_SNIPPETS_DESIGN.md). A body with no
 * formatting saves no layout at all.
 *
 * Pure: no DOM here except `docFromNode`, which only reads one.
 */

import { changedSpan } from '@/lib/bodyItems';

export type Mark = 'b' | 'i' | 'u';
export type ListKind = 'none' | 'bullet' | 'number';

export interface Run {
  text: string;
  /** In MARK_ORDER, no repeats. */
  marks: Mark[];
}

export interface Block {
  list: ListKind;
  runs: Run[];
}

export type FormattedDoc = Block[];

const MARK_ORDER: readonly Mark[] = ['b', 'i', 'u'];
export const BULLET_PREFIX = '• ';
const NUMBER_PREFIX = /^(\d+)\. /;

function sortMarks(marks: readonly Mark[]): Mark[] {
  return MARK_ORDER.filter((m) => marks.includes(m));
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

export function blockText(block: Block): string {
  return block.runs.map((r) => r.text).join('');
}

/** Joins neighbouring runs with the same marks and drops empty ones. */
function normalizeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const marks = sortMarks(run.marks);
    const last = out[out.length - 1];
    if (last && sameMarks(last.marks, marks)) last.text += run.text;
    else out.push({ text: run.text, marks });
  }
  return out;
}

/** The prefix a block's line carries in the plain body. */
export function listPrefix(doc: FormattedDoc, index: number): string {
  const block = doc[index];
  if (!block || block.list === 'none') return '';
  if (block.list === 'bullet') return BULLET_PREFIX;
  let n = 1;
  for (let i = index - 1; i >= 0 && doc[i]?.list === 'number'; i--) n += 1;
  return `${n}. `;
}

export function docToPlain(doc: FormattedDoc): string {
  return doc.map((block, i) => listPrefix(doc, i) + blockText(block)).join('\n');
}

/** A plain body as a document: every line a paragraph, nothing marked. */
export function docFromPlain(plain: string): FormattedDoc {
  return plain
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => ({ list: 'none' as const, runs: line ? [{ text: line, marks: [] }] : [] }));
}

/** Whether anything in the document is formatted, so a layout is worth saving. */
export function hasFormatting(doc: FormattedDoc): boolean {
  return doc.some((b) => b.list !== 'none' || b.runs.some((r) => r.marks.length > 0));
}

// ── Layout (body_html) ──────────────────────────────────────────────────────

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineHtml(block: Block): string {
  return block.runs
    .map((r) => {
      const open = r.marks.map((m) => `<${m}>`).join('');
      const close = [...r.marks].reverse().map((m) => `</${m}>`).join('');
      return open + escapeText(r.text) + close;
    })
    .join('');
}

/**
 * The layout an email gets: one `<div>` per line (an empty line keeps its
 * height with a `<br>`), list lines in `<ul>` / `<ol>`, marks as `<b>`, `<i>`,
 * `<u>`. Fields stay as their codes, escaped like any text.
 */
export function docToHtml(doc: FormattedDoc): string {
  let out = '';
  let i = 0;
  while (i < doc.length) {
    const block = doc[i] as Block;
    if (block.list === 'none') {
      out += `<div>${inlineHtml(block) || '<br>'}</div>`;
      i += 1;
      continue;
    }
    const tag = block.list === 'bullet' ? 'ul' : 'ol';
    out += `<${tag}>`;
    while (i < doc.length && doc[i]?.list === block.list) {
      out += `<li>${inlineHtml(doc[i] as Block) || '<br>'}</li>`;
      i += 1;
    }
    out += `</${tag}>`;
  }
  return out;
}

const MARK_TAGS: Readonly<Record<string, Mark>> = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u' };
const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK']);

/** Whether a `<br>` only holds an empty line open (the last thing in its block). */
function isPlaceholderBreak(br: Element): boolean {
  let next = br.nextSibling;
  while (next && next.nodeType === 3 && next.textContent === '') next = next.nextSibling;
  if (next) return false;
  const parent = br.parentElement;
  return !!parent && (BLOCK_TAGS.has(parent.tagName) || parent.tagName === 'LI');
}

/**
 * Reads a document from a DOM tree: the editor's own box, or a saved layout
 * parsed into an inert document. Only lines, lists, marks and field chips
 * (`data-token`) are read; every other element is passed through for its text,
 * and scripts, styles and frames are skipped whole.
 */
export function docFromNode(root: Node): FormattedDoc {
  const blocks: Block[] = [];
  let current: Block | null = null;

  const open = (list: ListKind): Block => {
    current = { list, runs: [] };
    blocks.push(current);
    return current;
  };
  const add = (text: string, marks: Mark[], list: ListKind) => {
    if (text === '') return;
    (current ?? open(list)).runs.push({ text, marks });
  };

  const walk = (node: Node, marks: Mark[], list: ListKind) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        add((child.textContent ?? '').replace(/\r?\n/g, ' '), marks, list);
        return;
      }
      if (child.nodeType !== 1) return;
      const el = child as Element;
      const tag = el.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag)) return;
      const token = el.getAttribute('data-token');
      if (token !== null) {
        add(token, marks, list);
        return;
      }
      if (tag === 'BR') {
        if (!isPlaceholderBreak(el)) {
          if (!current) open(list);
          open(list);
        }
        return;
      }
      const mark = MARK_TAGS[tag];
      if (mark) {
        walk(el, marks.includes(mark) ? marks : [...marks, mark], list);
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        const kind: ListKind = tag === 'UL' ? 'bullet' : 'number';
        current = null;
        el.childNodes.forEach((item) => {
          if (item.nodeType === 1 && (item as Element).tagName.toUpperCase() === 'LI') {
            open(kind);
            walk(item, marks, kind);
            current = null;
          } else if (item.nodeType === 1) {
            walk(item, marks, kind);
          }
        });
        current = null;
        return;
      }
      if (tag === 'LI') {
        open(list === 'none' ? 'bullet' : list);
        walk(el, marks, list === 'none' ? 'bullet' : list);
        current = null;
        return;
      }
      if (BLOCK_TAGS.has(tag)) {
        // A line opens with its first text, so a box inside a box is one
        // line; a box holding no text at all is an empty line.
        current = null;
        const before = blocks.length;
        walk(el, marks, list);
        if (blocks.length === before) open(list);
        current = null;
        return;
      }
      walk(el, marks, list);
    });
  };

  walk(root, [], 'none');
  const doc = blocks.map((b) => ({ list: b.list, runs: normalizeRuns(b.runs) }));
  return doc.length > 0 ? doc : [{ list: 'none', runs: [] }];
}

// ── Editing by plain-text position ──────────────────────────────────────────

/** Where a plain-body offset falls: the block, and the character in its text (after the prefix). */
export function positionAt(doc: FormattedDoc, offset: number): { block: number; char: number } {
  let lineStart = 0;
  for (let i = 0; i < doc.length; i++) {
    const textStart = lineStart + listPrefix(doc, i).length;
    const textEnd = textStart + blockText(doc[i] as Block).length;
    if (offset <= textEnd || i === doc.length - 1) {
      return { block: i, char: Math.max(0, Math.min(offset - textStart, textEnd - textStart)) };
    }
    lineStart = textEnd + 1;
  }
  return { block: 0, char: 0 };
}

/** The plain-body offset of a character in a block's text. */
export function offsetOf(doc: FormattedDoc, block: number, char: number): number {
  let lineStart = 0;
  for (let i = 0; i < block; i++) lineStart += listPrefix(doc, i).length + blockText(doc[i] as Block).length + 1;
  return lineStart + listPrefix(doc, block).length + char;
}

function sliceRuns(runs: readonly Run[], from: number, to: number): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    const a = Math.max(from, at);
    const b = Math.min(to, end);
    if (b > a) out.push({ text: run.text.slice(a - at, b - at), marks: run.marks });
    at = end;
  }
  return out;
}

/** The marks text typed at `char` takes: those of the character before it, else after. */
function marksAt(runs: readonly Run[], char: number): Mark[] {
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    if (char > at && char <= end) return run.marks;
    at = end;
  }
  return runs[0]?.marks ?? [];
}

/** A new line written as plain text: a "• " or "1. " at its start makes it a list line. */
function blockFromLine(line: string, marks: Mark[]): Block {
  if (line.startsWith(BULLET_PREFIX)) return { list: 'bullet', runs: normalizeRuns([{ text: line.slice(2), marks }]) };
  const n = NUMBER_PREFIX.exec(line);
  if (n) return { list: 'number', runs: normalizeRuns([{ text: line.slice(n[0].length), marks }]) };
  return { list: 'none', runs: normalizeRuns([{ text: line, marks }]) };
}

/** Swaps the plain body's `start`..`end` for `text`, keeping the formatting around it. */
export function replacePlainRange(doc: FormattedDoc, start: number, end: number, text: string): FormattedDoc {
  const a = positionAt(doc, start);
  const b = positionAt(doc, Math.max(start, end));
  const first = doc[a.block] as Block;
  const last = doc[b.block] as Block;
  const marks = marksAt(first.runs, a.char);
  const head = sliceRuns(first.runs, 0, a.char);
  const tail = sliceRuns(last.runs, b.char, blockText(last).length);
  // Taking out whole lines from the start of one up to the start of another
  // leaves the second line as it was, its list or none.
  const textStartA = offsetOf(doc, a.block, 0);
  const lineStartA = textStartA - listPrefix(doc, a.block).length;
  const keepsLast =
    a.block !== b.block && (start < textStartA || start === lineStartA) && end <= offsetOf(doc, b.block, 0);
  const list = keepsLast ? last.list : first.list;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const made: Block[] = [];
  if (lines.length === 1) {
    made.push({ list, runs: normalizeRuns([...head, { text: lines[0] ?? '', marks }, ...tail]) });
  } else {
    made.push({ list: first.list, runs: normalizeRuns([...head, { text: lines[0] ?? '', marks }]) });
    for (const line of lines.slice(1, -1)) made.push(blockFromLine(line, marks));
    const lastLine = blockFromLine(lines[lines.length - 1] ?? '', marks);
    made.push({ list: lastLine.list, runs: normalizeRuns([...lastLine.runs, ...tail]) });
  }
  return [...doc.slice(0, a.block), ...made, ...doc.slice(b.block + 1)];
}

/**
 * The document brought in line with a plain body changed elsewhere: a window's
 * Insert or Save, Remove, Undo, a rename, a translation. Lines that did not
 * change keep everything. When the changed lines are as many as before, each
 * is edited where it differs, so its formatting outside that stretch stays;
 * otherwise the changed stretch is replaced as text.
 */
export function syncDoc(doc: FormattedDoc, plain: string): FormattedDoc {
  const next = plain.replace(/\r\n?/g, '\n');
  const before = docToPlain(doc);
  if (before === next) return doc;
  const oldLines = before.split('\n');
  const newLines = next.split('\n');
  let top = 0;
  while (top < oldLines.length && top < newLines.length && oldLines[top] === newLines[top]) top += 1;
  let bottom = 0;
  while (
    bottom < oldLines.length - top &&
    bottom < newLines.length - top &&
    oldLines[oldLines.length - 1 - bottom] === newLines[newLines.length - 1 - bottom]
  ) {
    bottom += 1;
  }
  const oldCount = oldLines.length - top - bottom;
  const newCount = newLines.length - top - bottom;
  if (oldCount !== newCount) {
    const span = changedSpan(before, next);
    return replacePlainRange(doc, span.start, span.end, span.text);
  }
  const out = doc.map((block) => ({ list: block.list, runs: [...block.runs] }));
  for (let k = 0; k < oldCount; k++) {
    const i = top + k;
    const block = out[i] as Block;
    const prefix = listPrefix(doc, i);
    const line = newLines[i] ?? '';
    let text = line;
    if (prefix !== '') {
      if (line.startsWith(prefix)) text = line.slice(prefix.length);
      else block.list = 'none';
    }
    const span = changedSpan(blockText(block), text);
    const marks = marksAt(block.runs, span.start);
    block.runs = normalizeRuns([
      ...sliceRuns(block.runs, 0, span.start),
      { text: span.text, marks },
      ...sliceRuns(block.runs, span.end, blockText(block).length),
    ]);
  }
  return out;
}

// ── Field chips ─────────────────────────────────────────────────────────────

export type Segment = { kind: 'text'; text: string } | { kind: 'token'; raw: string };

const BUTTON_HEAD = /^\{\s*button(?:\s|\})/i;
const BUTTON_CLOSE = '{/button}';

/**
 * A line cut into text and codes, each code shown as one chip: `{…}`,
 * `{{…}}`, and a whole `{button …}…{/button}`. A `{` that never closes is
 * text, as it is to the engine.
 */
export function segmentTokens(text: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  let plainFrom = 0;
  const flush = (to: number) => {
    if (to > plainFrom) out.push({ kind: 'text', text: text.slice(plainFrom, to) });
  };
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    let end = -1;
    if (text.charAt(open + 1) === '{') {
      const shut = text.indexOf('}}', open + 2);
      end = shut === -1 ? -1 : shut + 2;
    } else {
      const close = text.indexOf('}', open + 1);
      const inner = close === -1 ? -1 : text.indexOf('{', open + 1);
      if (close !== -1 && (inner === -1 || inner > close)) {
        end = close + 1;
        if (BUTTON_HEAD.test(text.slice(open, end))) {
          const shut = text.indexOf(BUTTON_CLOSE, end);
          if (shut !== -1) end = shut + BUTTON_CLOSE.length;
        }
      }
    }
    if (end === -1) {
      i = open + 1;
      continue;
    }
    flush(open);
    out.push({ kind: 'token', raw: text.slice(open, end) });
    i = end;
    plainFrom = end;
  }
  flush(text.length);
  return out;
}

function settingOf(inner: string, key: string): string {
  const m = new RegExp(`(?:^|;)\\s*${key}\\s*=\\s*([^;]*)`, 'i').exec(inner);
  return m ? (m[1] ?? '').trim() : '';
}

function clip(s: string, max = 28): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** What a chip says: the field's name, "Picture: Logo", "If …". The code itself is its tooltip. */
export function chipLabel(raw: string): string {
  if (raw.startsWith('{{')) return clip(raw.slice(2, -2));
  if (BUTTON_HEAD.test(raw)) {
    const label = /label\s*=\s*"([^"]*)"/i.exec(raw)?.[1] ?? '';
    return clip(`Button${label ? `: ${label}` : ''}`);
  }
  const inner = raw.slice(1, -1).trim();
  const colon = inner.indexOf(':');
  const head = (colon === -1 ? inner : inner.slice(0, colon)).trim().toLowerCase();
  const rest = colon === -1 ? '' : inner.slice(colon + 1);
  if (inner.startsWith('=')) return clip(`= ${inner.slice(1)}`);
  if (head === 'formtext' || head === 'formdate') return clip(settingOf(rest, 'name') || 'Field');
  if (head === 'formmenu') return clip(settingOf(rest.slice(rest.indexOf(';') + 1), 'name') || 'Choice');
  if (head === 'picture') return clip(`Picture${settingOf(rest, 'alt') ? `: ${settingOf(rest, 'alt')}` : ''}`);
  if (head === 'if') return clip(`If ${rest}`);
  if (head === 'elseif') return clip(`Or if ${rest}`);
  if (inner === 'else') return 'Otherwise';
  if (inner === 'endif') return 'End of rule';
  if (head === 'time') return 'Automatic date';
  if (head === 'greeting' || inner === 'greeting') return 'Greeting';
  if (head === 'var') return clip(`Saved value ${rest.split('=')[0] ?? ''}`);
  if (head === 'case') return 'Letter case';
  if (inner === '/case') return 'End of letter case';
  if (head === 'gender') return 'Gendered word';
  return clip(inner);
}
