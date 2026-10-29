// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Undo after an email layout lands in a rich editor (extension/content/content.js).
// The Undo card measures the inserted text and deletes it as a range, which
// leaves a card's table, rows and cells standing as empty shells, with their
// borders and colours. _ceRemoveFormatted then takes out every block the
// insert added once it holds nothing, the card's own pictures, and the line
// break an email copied from Gmail ends with. The shipping functions are
// sliced out of the source and run against a real document (jsdom), with the
// insert done the way a browser does it: the trigger's range replaced by the
// layout's nodes.

function sliceFunction(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`"${signature}" not found in content.js`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced braces while slicing');
}

const source = readFileSync(resolve(process.cwd(), '..', 'extension', 'content', 'content.js'), 'utf8');

const SLICES = [
  (source.match(/^var EMOJI_IN_ALT_RE = .*;$/m) ?? [''])[0],
  (source.match(/^var _CE_BLOCKS = .*;$/m) ?? [''])[0],
  ...[
    'function _ceEmojiPictureText(node) {',
    'function _ceUnitText(node) {',
    'function _ceUnitWalker(host) {',
    'function _ceVisibleText(host) {',
    'function _ceRangeLength(range, host) {',
    'function _ceCaretCharOffset(host, fromStart) {',
    'function _cePointBeside(node, after) {',
    'function _ceCharOffsetToPoint(host, target, atStart) {',
    'function _ceHost(el) {',
    'function _isLexicalHost(host) {',
    'function _ceHoldSpace(at) {',
    'function captureFieldState(el, triggerLen) {',
    'function _ceMeasureBefore(el) {',
    'function _formattedPictures(vm) {',
    'function _markSyncInserted(snapshot, el, before, text, vm) {',
    'function _ceRemoveFormatted(host, snapshot) {',
    'function restoreFieldState(snapshot) {',
  ].map((sig) => sliceFunction(source, sig)),
].join('\n');

interface Shipping {
  captureFieldState: (el: Element, triggerLen: number) => Record<string, unknown>;
  _ceMeasureBefore: (el: Element) => Record<string, unknown>;
  _markSyncInserted: (
    snapshot: Record<string, unknown>,
    el: Element,
    before: Record<string, unknown>,
    text: string,
    vm: { formatted: string; parts: null } | null,
  ) => void;
  restoreFieldState: (snapshot: Record<string, unknown>) => void;
}

const shipping = new Function(
  SLICES + '\nreturn { captureFieldState, _ceMeasureBefore, _markSyncInserted, restoreFieldState };',
)() as Shipping;

const LOGO = 'https://lh3.googleusercontent.com/d/logo';
const CARD =
  '<table style="width:600px;background:#f4f4f4" cellpadding="0"><tbody><tr><td align="center">' +
  '<table style="background:#fff;border:1px solid #ddd" width="600"><tbody>' +
  '<tr><td style="padding:30px 40px"><div style="font-size:24px">Laura Bianchi x3</div></td></tr>' +
  '<tr><td><table width="100%"><tbody><tr><td>👥 Adultos: <b>2</b></td><td>🧒 Niños: <b>1</b></td></tr></tbody></table></td></tr>' +
  '<tr><td><blockquote><ul><li><b>Apartamento</b></li></ul></blockquote></td></tr>' +
  '<tr><td><img alt="LEIBTOUR LOGO" src="' + LOGO + '" width="53" height="53"></td></tr>' +
  '</tbody></table></td></tr></tbody></table><br>';
const PLAIN = 'Laura Bianchi x3\n👥 Adultos: 2 🧒 Niños: 1\n• Apartamento';

// A field holding `beforeHtml` with the trigger selected, the layout put in
// over it as a browser's paste does (nodes replacing the range), the caret
// left after it, the Undo snapshot taken as the three insert paths take it,
// and Undo clicked.
function undoLeaves(
  beforeHtml: string,
  trigger: string,
  layout = CARD,
  editor: { eatsBreak?: boolean; splitsLine?: boolean } = {},
): string {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  host.setAttribute('contenteditable', 'true');
  host.innerHTML = beforeHtml;
  document.body.appendChild(host);

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node && node.data.indexOf(trigger) === -1) node = walker.nextNode() as Text | null;
  if (!node) throw new Error('trigger not in the field');
  const range = document.createRange();
  range.setStart(node, node.data.indexOf(trigger));
  range.setEnd(node, node.data.indexOf(trigger) + trigger.length);
  const sel = window.getSelection();
  if (!sel) throw new Error('no selection');
  sel.removeAllRanges();
  sel.addRange(range);

  const before = shipping._ceMeasureBefore(host);
  range.deleteContents();
  const tpl = document.createElement('template');
  tpl.innerHTML = layout;
  const last = tpl.content.lastChild;
  if (editor.splitsLine) {
    // A block pasted into the middle of a line: the browser puts the rest of
    // the line in a new block of the same kind after the block.
    const line = node.parentElement as HTMLElement;
    const rest = document.createElement(line.tagName);
    rest.textContent = node.data.slice(range.startOffset);
    node.data = node.data.slice(0, range.startOffset);
    line.after(rest);
    rest.before(tpl.content);
  } else {
    range.insertNode(tpl.content);
  }
  if (editor.eatsBreak) {
    // The browser takes the line break right after the pasted block as the
    // block's own and drops it.
    const eaten = (last as Node).nextSibling;
    if (eaten && eaten.nodeName === 'BR') eaten.parentNode?.removeChild(eaten);
  }
  const after = document.createRange();
  after.setStartAfter(last as Node);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);

  const snapshot = shipping.captureFieldState(host, trigger.length);
  shipping._markSyncInserted(snapshot, host, before, PLAIN, { formatted: layout, parts: null });
  shipping.restoreFieldState(snapshot);
  return host.innerHTML;
}

describe('Undo after an email layout lands', () => {
  it('takes the whole card out of a line, tables, picture and trailing break included', () => {
    const left = undoLeaves('<div>Hola ::conf</div><div>Saludos</div>', '::conf');
    expect(left).not.toMatch(/<(table|tr|td|img|blockquote|ul|li|b|br)\b/);
    expect(left.replace(/\u00a0/g, ' ')).toBe('<div>Hola </div><div>Saludos</div>');
  });

  it('takes it out of a field it opened', () => {
    expect(undoLeaves('::conf', '::conf')).toBe('');
  });

  it('leaves the words and breaks that were there before', () => {
    const left = undoLeaves('Hola<br>::conf<br>Saludos', '::conf');
    expect(left).toBe('Hola<br><br>Saludos');
  });

  it("leaves the editor's own table alone", () => {
    const own = '<table id="own"><tbody><tr><td>Mine</td></tr></tbody></table>';
    const left = undoLeaves(own + '<div>::conf</div>', '::conf');
    expect(left).toBe(own + '<div></div>');
  });

  it('lets the trailing break stand in for one the editor took', () => {
    const left = undoLeaves('Hola<br>::conf<br>Saludos', '::conf', CARD, { eatsBreak: true });
    expect(left).toBe('Hola<br><br>Saludos');
  });

  it('puts the rest of a split line back on its line', () => {
    const left = undoLeaves('<div>Hola ::conf resto</div><div>B</div>', '::conf', CARD, { splitsLine: true });
    expect(left).toBe('<div>Hola  resto</div><div>B</div>');
  });

  it('keeps a layout that ends without a break from eating the next line break', () => {
    const left = undoLeaves('<div>::conf</div><br>after', '::conf', CARD.replace(/<br>$/, ''));
    expect(left).toBe('<div></div><br>after');
  });
});
