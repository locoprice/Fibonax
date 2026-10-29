/**
 * An email layout as a snippet body: the HTML copied from an email, or opened
 * from an .html file, kept as it is, with the snippet's fields inside it as
 * their codes. The plain body beside it is read off the layout, one line per
 * block or table row with the cells side by side, so every builder, the fill
 * form and the chats that take no formatting read the same words
 * (docs/FORMATTED_SNIPPETS_DESIGN.md). The bar's own layouts (lines, lists,
 * Bold, Italic, Underline) stay with lib/formattedBody.ts; this is for
 * everything else.
 *
 * Needs a DOM: the editor, and jsdom in tests.
 */

import DOMPurify from 'dompurify';
import { BULLET_PREFIX, segmentTokens } from '@/lib/formattedBody';
import type { CurrencyCode } from '@/lib/formNumberToken';

/**
 * What a layout may keep: the elements and attributes an email is laid out
 * with. Nothing that runs, nothing that loads a script or a style sheet.
 * Layouts come from teammates too, so this runs on every one that comes in.
 */
const ALLOWED_TAGS = [
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'div', 'p', 'span', 'br', 'b', 'strong', 'i', 'em',
  'u', 's', 'font', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'img',
  'center', 'small', 'sup', 'sub',
];
const ALLOWED_ATTR = [
  'style', 'width', 'height', 'align', 'valign', 'border', 'cellspacing', 'cellpadding', 'colspan', 'rowspan',
  'bgcolor', 'color', 'size', 'face', 'dir', 'alt', 'href', 'src',
];

/** The largest layout the database keeps (`snippets_body_html_size`). */
export const LAYOUT_MAX_BYTES = 200000;

/** Elements that start a line of their own in the plain body, or a cell. */
const BLOCK_TAGS = new Set([
  'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY',
  'TFOOT', 'TR', 'TD', 'TH', 'HR', 'CENTER',
]);
/** Elements whose text is only the markup's own spacing. */
const STRUCTURE_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'UL', 'OL']);
/** What the bar's own layouts are made of (lib/formattedBody.ts `docToHtml`). */
const BAR_TAGS = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'IMG']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK']);
/** The part of a layout a value sits in, whose words before it name the field. */
const PART_TAGS = new Set(['TD', 'TH', 'LI', 'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

function parse(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body;
}

function isBlock(node: Node | null): boolean {
  return !!node && node.nodeType === 1 && (BLOCK_TAGS.has((node as Element).tagName) || (node as Element).tagName === 'BR');
}

// ── Cleaning ────────────────────────────────────────────────────────────────

/**
 * The emoji a picture stands for, or '' for any other picture: Gmail keeps
 * every emoji in a message as a small picture whose description is the emoji.
 * A description with letters or digits (a logo, ":smile:") is not one. The
 * extension counts positions in a field by the same rule
 * (`_ceEmojiPictureText` in extension/content/content.js).
 */
function emojiOf(img: Element): string {
  const alt = img.getAttribute('alt') ?? '';
  return /\p{Extended_Pictographic}/u.test(alt) && !/[A-Za-z0-9]/.test(alt) ? alt : '';
}

/**
 * A layout as the editor keeps it: only the allowed elements and attributes,
 * no comments, pictures over https only and emoji pictures as the emoji, and
 * the markup's own spacing collapsed so the plain body reads cleanly and every
 * text node maps to it one character to one.
 */
export function cleanLayout(html: string): string {
  const safe = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false });
  const body = parse(safe);
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  const drop: Node[] = [];
  const texts: Text[] = [];
  const emojis: Element[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 8) drop.push(n);
    else if (n.nodeType === 3) texts.push(n as Text);
    else if ((n as Element).tagName === 'IMG' && emojiOf(n as Element)) emojis.push(n as Element);
    else if ((n as Element).tagName === 'IMG' && !/^https:\/\//i.test((n as Element).getAttribute('src') ?? '')) drop.push(n);
  }
  // Gmail keeps every emoji as a small picture sized by its own stylesheet,
  // which does not come along: on any other screen it showed at full size.
  // As the emoji itself it shows at text size everywhere, needs no outside
  // picture, and reads in the plain text.
  emojis.forEach((img) => img.replaceWith(img.ownerDocument.createTextNode(emojiOf(img))));
  for (const t of texts) {
    let data = t.data.replace(/\s+/g, ' ');
    const parent = t.parentElement;
    const first = t.previousSibling === null || isBlock(t.previousSibling);
    const last = t.nextSibling === null || isBlock(t.nextSibling);
    if (data === ' ' && (!parent || STRUCTURE_TAGS.has(parent.tagName) || first || last)) {
      drop.push(t);
      continue;
    }
    if (parent && BLOCK_TAGS.has(parent.tagName)) {
      if (first) data = data.replace(/^ /, '');
      if (last) data = data.replace(/ $/, '');
    }
    if (data !== t.data) t.data = data;
  }
  drop.forEach((n) => n.parentNode?.removeChild(n));
  return body.innerHTML;
}

/** Whether a layout is an email's, rather than one the bar wrote from lines, lists and marks. */
export function isEmailLayout(html: string | null | undefined): boolean {
  if (!html) return false;
  for (const el of Array.from(parse(html).querySelectorAll('*'))) {
    if (!BAR_TAGS.has(el.tagName)) return true;
    if (el.tagName !== 'IMG' && el.attributes.length > 0) return true;
  }
  return false;
}

/** What a layout holds, for the line under the paste box. */
export function layoutSummary(html: string): { tables: number; pictures: number } {
  const body = parse(html);
  return { tables: body.querySelectorAll('table').length, pictures: body.querySelectorAll('img').length };
}

/** How much room a layout takes in the database. */
export function layoutBytes(html: string): number {
  return new TextEncoder().encode(html).length;
}

// ── The plain body ──────────────────────────────────────────────────────────

/** One stretch of the plain body: a text node's characters, or a field chip's code. */
export interface PlainSpan {
  node: Text | Element;
  start: number;
  length: number;
}

export interface PlainText {
  text: string;
  spans: PlainSpan[];
}

/** Whether a `<br>` only holds an empty line open: the last thing in its line. */
function isPlaceholderBreak(br: Element): boolean {
  let next = br.nextSibling;
  while (next && next.nodeType === 3 && next.textContent === '') next = next.nextSibling;
  if (next) return false;
  const parent = br.parentElement;
  return !!parent && BLOCK_TAGS.has(parent.tagName);
}

function listPrefix(item: Element): string {
  const parent = item.parentElement;
  if (!parent || parent.tagName !== 'OL') return BULLET_PREFIX;
  let n = 1;
  for (let prev = item.previousElementSibling; prev; prev = prev.previousElementSibling) {
    if (prev.tagName === 'LI') n += 1;
  }
  return `${n}. `;
}

/** Whether a cell holds lines of its own, rather than one run of text. */
const BLOCK_SELECTOR = 'div,p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,li,table,hr,center,br';

/**
 * The plain body read off a layout, and where each of its characters comes
 * from. A block or a table row is a line; the cells of a row sit side by side
 * with a space between them, except a cell that holds lines of its own, which
 * keeps them; `<br>` is a line break; a list line carries its "• " or "1. "
 * as the bar's do; pictures are left out. A field chip (`data-token`) reads
 * as its code. Text nodes are read as they are, so a span's characters are
 * the node's own.
 */
export function plainSegments(root: Node): PlainText {
  let out = '';
  const spans: PlainSpan[] = [];
  let needLine = false;
  let needGap = false;
  // Whether the block being read has text yet: a trailing `<br>` is an empty
  // line only when nothing came before it in its block.
  const hasText: boolean[] = [];

  const before = (forBreak = false) => {
    if (needLine) {
      if (out !== '' && !out.endsWith('\n')) out += '\n';
    } else if (needGap && !forBreak) {
      if (out !== '' && !/\s$/.test(out)) out += ' ';
    }
    needLine = false;
    needGap = false;
  };
  const boundary = () => {
    needLine = true;
  };
  const text = (s: string, node: Text | Element) => {
    if (s === '') return;
    before();
    spans.push({ node, start: out.length, length: s.length });
    out += s;
    if (hasText.length > 0) hasText[hasText.length - 1] = true;
  };
  const hardBreak = () => {
    before(true);
    out += '\n';
  };

  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        text((child as Text).data.replace(/[\r\n\t\u00a0]/g, ' '), child as Text);
        return;
      }
      if (child.nodeType !== 1) return;
      const el = child as Element;
      const tag = el.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag) || tag === 'IMG') return;
      const token = el.getAttribute('data-token');
      if (token !== null) {
        text(token, el);
        return;
      }
      if (tag === 'BR') {
        if (!isPlaceholderBreak(el)) hardBreak();
        else if (!hasText[hasText.length - 1]) hardBreak();
        return;
      }
      if ((tag === 'TD' || tag === 'TH') && !el.querySelector(BLOCK_SELECTOR)) {
        needGap = true;
        hasText.push(false);
        walk(el);
        hasText.pop();
        needGap = true;
        return;
      }
      if (tag === 'LI') {
        boundary();
        hasText.push(false);
        before();
        out += listPrefix(el);
        walk(el);
        hasText.pop();
        boundary();
        return;
      }
      if (BLOCK_TAGS.has(tag)) {
        boundary();
        hasText.push(false);
        walk(el);
        hasText.pop();
        boundary();
        return;
      }
      walk(el);
    });
  };

  walk(root);
  return { text: out.replace(/\n+$/, ''), spans };
}

/** The plain body of a saved layout. */
export function layoutToPlain(html: string): string {
  return plainSegments(parse(html)).text;
}

// ── Between plain offsets and the box ───────────────────────────────────────

/** The point just before (0) or just after (1) a node, in its parent. */
export function beside(node: Node, after: 0 | 1): { node: Node; offset: number } {
  const parent = node.parentNode as Node;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) + after };
}

function chipOf(node: Node): Element | null {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return el ? el.closest('[data-token]') : null;
}

/** The plain offset of the first text at or inside `node`, else the end of the last text before it. */
function offsetBeforeNode(spans: PlainSpan[], node: Node): number {
  for (const s of spans) {
    if (s.node === node || node.contains(s.node)) return s.start;
  }
  let end = 0;
  for (const s of spans) {
    if (node.compareDocumentPosition(s.node) & Node.DOCUMENT_POSITION_PRECEDING) end = s.start + s.length;
    else break;
  }
  return end;
}

/** The plain offset of a DOM point, from the spans read off the same tree. */
export function plainOffsetAt(spans: PlainSpan[], container: Node, offset: number): number {
  const chip = chipOf(container);
  if (chip) {
    const span = spans.find((s) => s.node === chip);
    if (span) return span.start + (offset > 0 || container !== chip ? span.length : 0);
  }
  if (container.nodeType === 3) {
    const span = spans.find((s) => s.node === container);
    return span ? span.start + Math.min(offset, span.length) : offsetBeforeNode(spans, container);
  }
  const child = container.childNodes[offset];
  if (child) return offsetBeforeNode(spans, child);
  let end: number | null = null;
  for (const s of spans) {
    if (container.contains(s.node)) end = s.start + s.length;
  }
  return end ?? offsetBeforeNode(spans, container);
}

/** The DOM point of a plain offset: in its text, before or after its chip, else before the next text. */
export function pointAt(spans: PlainSpan[], root: Node, offset: number): { node: Node; offset: number } {
  for (const s of spans) {
    if (offset >= s.start && offset <= s.start + s.length) {
      if (s.node.nodeType === 3) return { node: s.node, offset: offset - s.start };
      return beside(s.node, offset === s.start ? 0 : 1);
    }
  }
  const next = spans.find((s) => s.start > offset);
  if (next) return next.node.nodeType === 3 ? { node: next.node, offset: 0 } : beside(next.node, 0);
  const last = spans[spans.length - 1];
  if (last) return last.node.nodeType === 3 ? { node: last.node, offset: last.length } : beside(last.node, 1);
  return { node: root, offset: root.childNodes.length };
}

/** Plain text as nodes for the box: codes as chips, line breaks as `<br>`. */
export function fragmentFromPlain(doc: Document, text: string, chip: (raw: string) => Element): DocumentFragment {
  const frag = doc.createDocumentFragment();
  text.replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
    if (i > 0) frag.appendChild(doc.createElement('br'));
    for (const seg of segmentTokens(line)) {
      frag.appendChild(seg.kind === 'token' ? chip(seg.raw) : doc.createTextNode(seg.text));
    }
  });
  return frag;
}

/** Turns every code written in the text of a tree into a chip. */
export function chipTokens(root: Node, chip: (raw: string) => Element): void {
  const doc = root.ownerDocument as Document;
  const texts: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    const segs = segmentTokens(t.data);
    if (!segs.some((s) => s.kind === 'token')) continue;
    const frag = doc.createDocumentFragment();
    for (const seg of segs) frag.appendChild(seg.kind === 'token' ? chip(seg.raw) : doc.createTextNode(seg.text));
    t.parentNode?.replaceChild(frag, t);
  }
}

/** The layout as it is saved: the box's tree with every chip back as its code. */
export function serializeLayout(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const doc = clone.ownerDocument;
  clone.querySelectorAll('[data-token]').forEach((chip) => {
    chip.replaceWith(doc.createTextNode(chip.getAttribute('data-token') ?? ''));
  });
  return clone.innerHTML;
}

// ── Make it a field ─────────────────────────────────────────────────────────

function tidyLabel(s: string): string {
  return s
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
    .replace(/[\s:;,.\-|·•]+$/, '')
    .trim();
}

/**
 * The words before a selected value in its cell or line, for the name a field
 * made of it takes: "Customer" before "Mario Rossi". When its own cell has
 * none, the cell before it in the row. At most the last four words.
 */
export function labelBefore(range: Range, root: Node): string {
  let part: Element | null = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
  while (part && part !== root && !PART_TAGS.has(part.tagName)) part = part.parentElement;
  if (!part || part === root) return '';
  const r = range.cloneRange();
  r.setStart(part, 0);
  r.setEnd(range.startContainer, range.startOffset);
  let words = tidyLabel(r.toString());
  if (words === '' && (part.tagName === 'TD' || part.tagName === 'TH')) {
    const prev = part.previousElementSibling;
    words = prev ? tidyLabel(prev.textContent ?? '') : '';
  }
  return words.split(' ').slice(-4).join(' ');
}

const CURRENCY_SIGNS: Record<string, CurrencyCode> = { '€': 'EUR', $: 'USD', '£': 'GBP' };

/**
 * A sample amount as a number field's default: "€326.00" gives 326.00 in
 * euros, "1.234,50" gives 1234.50. An empty value when the sample holds no
 * number.
 */
export function numberFromSample(sample: string): { value: string; currency: CurrencyCode | null } {
  const sign = Object.keys(CURRENCY_SIGNS).find((s) => sample.includes(s));
  let digits = sample.replace(/[^\d.,-]/g, '');
  if (digits.lastIndexOf(',') > digits.lastIndexOf('.')) {
    digits = digits.replace(/\./g, '').replace(/,(?=[^,]*$)/, '.');
  }
  digits = digits.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(digits)) digits = '';
  return { value: digits, currency: sign ? (CURRENCY_SIGNS[sign] ?? null) : null };
}
