// Unfinished-text gate.
//
// Right before a snippet leaves Fibonax, every surface reads the finished text
// through unfinished() in extension/shared/fill-form.js and warns when a piece
// looks like it was never filled in: "[xxx]", "{fill this in}", an empty box.
// This pins two things:
//
//   1. What the rules catch, and just as much what they leave alone. A rule
//      that fires on ordinary email ("the form to fill in", "Really???",
//      "[1]") teaches people to click Insert anyway without reading.
//   2. That every surface which hands a snippet out asks the same question,
//      and honours the per-snippet "don't warn me" switch.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const ff = require(path.join(ROOT, 'extension', 'shared', 'fill-form.js'));

function fail(msg) {
  console.error('X ' + msg);
  process.exit(1);
}

for (const fn of ['unfinished', 'unfinishedText', 'checksUnfinished']) {
  if (typeof ff[fn] !== 'function') fail('fill-form.js no longer exports ' + fn);
}

const found = (text, fields) => ff.unfinished(text, fields).map((i) => i.kind + ':' + i.text);

// ── WHAT IT CATCHES ─────────────────────────────────────────────────
const CATCH = [
  ['Hi [xxx], thanks', ['placeholder:[xxx]']],
  ['Hi [], thanks', ['placeholder:[]']],
  ['{compila qua il campo}', ['placeholder:{compila qua il campo}']],
  ['{{TESTO_DELLO_SNIPPET}}', ['placeholder:{{TESTO_DELLO_SNIPPET}}']],
  ['Dear <name>,', ['placeholder:<name>']],
  ['Date: xx/xx/xxxx', ['gap:xx/xx/xxxx']],
  ['Ref XXX', ['gap:XXX']],
  ['Fax xxxxx', ['gap:xxxxx']],
  ['Price: ??? EUR', ['gap:???']],
  ['Price: ?? EUR', ['gap:??']],
  ['Signature: ______', ['gap:______']],
  ['Signature: ........', ['gap:........']],
  ['Time TBD.', ['note:TBD']],
  ['TODO: call back', ['note:TODO']],
  ['FIXME', ['note:FIXME']],
  ['Orario da definire.', ['note:da definire']],
  ['Hora por definir.', ['note:por definir']],
  ['Insert name here.', ['instruction:Insert name here']],
  ['Type here', ['instruction:Type here']],
  ['Your name here', ['instruction:Your name here']],
  ['Inserisci qui il nome.', ['instruction:Inserisci qui']],
  ['compila qua il campo', ['instruction:compila qua']],
  ['Scrivi il nome qui', ['instruction:Scrivi il nome qui']],
  ['Escribe aquí tu nombre.', ['instruction:Escribe aquí']],
  ['Pon la fecha aquí', ['instruction:Pon la fecha aquí']],
  ['placeholder', ['instruction:placeholder']],
  ['segnaposto', ['instruction:segnaposto']],
  ['marcador de posición', ['instruction:marcador de posición']],
  ['Lorem ipsum dolor', ['sample:Lorem ipsum']],
  ['Hello CLIENT_NAME,', ['field:CLIENT_NAME']],
  // One mistake, reported once: the braces, not the field name inside them.
  ['Hello {CLIENT_NAME}', ['placeholder:{CLIENT_NAME}']],
  // The same piece twice is one line in the list.
  ['[xxx] and [xxx]', ['placeholder:[xxx]']],
];
for (const [text, want] of CATCH) {
  assert.deepStrictEqual(found(text), want, 'catches: ' + JSON.stringify(text));
}
console.log('OK Catches ' + CATCH.length + ' kinds of leftover');

// ── WHAT IT LEAVES ALONE ────────────────────────────────────────────
const LEAVE = [
  'Normal email. Thanks! See you soon :) Best regards, Anna',
  'Really?? What???',
  'See note [1] and the list [x] [ ] here.',
  'Read the [guide](https://example.com/guide).',
  'Write to <anna@example.com> or open <https://example.com>.',
  'Line one<br>line two, and A <-> B.',
  'Size XXL or XL, Max.',
  'In allegato il modulo da compilare.',
  'Adjunto el formulario a rellenar.',
  'Please fill in the attached form.',
  'Leave your feedback here: https://example.com',
  'TODO INCLUIDO. Todo bien.',
  'Wait...',
  'ISO 9001 and COVID 19.',
  '',
];
for (const text of LEAVE) {
  assert.deepStrictEqual(found(text), [], 'leaves alone: ' + JSON.stringify(text));
}
console.log('OK Leaves ' + LEAVE.length + ' ordinary texts alone');

// ── EMPTY BOXES AND WHERE A PIECE BELONGS ───────────────────────────
const vm = ff.fillForm('Dear {NAME},\nNote: {NOTE}\nTotal: {TOTAL}', { NAME: 'bob [xxx]', NOTE: '', TOTAL: '' },
  { now: new Date('2026-08-30T09:15:00') });
const items = ff.unfinished(vm.preview, vm.fields);
assert.deepStrictEqual(items.map((i) => [i.kind, i.key]),
  [['empty', 'NOTE'], ['empty', 'TOTAL'], ['placeholder', 'NAME']],
  'empty boxes come first, and a piece typed into a box belongs to that box');
assert.strictEqual(items[0].start, -1, 'an empty box has no place in the text');
assert.strictEqual(vm.preview.slice(items[2].start, items[2].start + items[2].text.length), items[2].text,
  'start points at the piece in the text');
assert.deepStrictEqual(ff.unfinished('Hi [xxx]', []).map((i) => i.key), [''],
  'a piece written in the snippet itself belongs to no box');
assert.deepStrictEqual(ff.unfinished('ok', [{ key: 'A', value: '', visible: false }]), [],
  'a box the form does not show is not reported');
// A box in a Show or hide section that is closed prints nothing, so it is not
// called empty; once its section opens, it is.
const SECTION = 'Plan: {formmenu: A,B; name=PLAN}\n{if: PLAN = "A"}Ref: {formtext: name=REF}{endif}\nBye';
const keysOf = (values) => {
  const view = ff.fillForm(SECTION, values, { now: new Date('2026-08-30T09:15:00') });
  return ff.unfinished(view.preview, view.fields).map((i) => i.key);
};
assert.deepStrictEqual(keysOf({ PLAN: 'B' }), [], 'a box in a closed section is not empty');
assert.deepStrictEqual(keysOf({ PLAN: 'A' }), ['REF'], 'the same box, its section open, is');
// The trial answers never make a box required: the real answers decide that.
const calc = ff.fillForm('Total {=QTY*2}. {if: PLAN = "A"}{=EXTRA*2}{endif} {formmenu: A,B; name=PLAN; default=B} ' +
  '{formtext: name=QTY; type=number} {formtext: name=EXTRA; type=number}', {}, {});
assert.deepStrictEqual(calc.fields.filter((f) => f.required).map((f) => f.key), ['QTY'],
  'only the calculation the form shows asks for an answer');
console.log('OK Empty boxes listed first; each piece knows its box; closed sections are left out');

// ── THE SWITCH ──────────────────────────────────────────────────────
assert.strictEqual(ff.checksUnfinished({}), true, 'a snippet saved before the switch existed is checked');
assert.strictEqual(ff.checksUnfinished({ check_unfinished: true }), true);
assert.strictEqual(ff.checksUnfinished({ check_unfinished: false }), false);
assert.strictEqual(ff.checksUnfinished(null), true);
assert.strictEqual(ff.unfinishedText('more', { n: 3 }), 'and 3 more');
assert.strictEqual(ff.unfinishedText('in-field', { title: 'Phone' }), 'In the box “Phone”');
assert.strictEqual(ff.unfinishedText('nope'), '');
for (const kind of ['empty', 'placeholder', 'gap', 'note', 'instruction', 'field', 'sample']) {
  if (!ff.UNFINISHED_TEXT[kind]) fail('no reason worded for ' + kind);
}
console.log('OK Switch and wording');

// ── EVERY SURFACE ASKS ──────────────────────────────────────────────
// Each place a snippet leaves Fibonax reads the text through unfinished() and
// honours the switch. A surface that stops asking lets the mistake through on
// that surface only, which nobody notices until a customer does.
const SURFACES = [
  ['extension/content/content.js', ['.unfinished(', '.checksUnfinished(', 'unfinishedDialog(']],
  ['extension/popup/popup.js', ['.unfinished(', '.checksUnfinished(', 'unfinishedDialog(']],
  ['app/src/features/snippets/SnippetPreview.tsx', ['unfinishedItems(']],
  ['app/public/mobile/index.html', ['.unfinished(', '.checksUnfinished(', 'unfinishedDialog(']],
];
// The phone carries generated copies of the shared modules, which define these
// names; only its own code counts, so the copies are left out of the search.
const ownCode = (src) => src.replace(/<!-- (SB_[A-Z_]+):BEGIN -->[\s\S]*?<!-- \1:END -->/g, '');
for (const [file, needles] of SURFACES) {
  const src = ownCode(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  for (const needle of needles) {
    if (src.indexOf(needle) === -1) fail(file + ' no longer calls ' + needle);
  }
}
// The switch travels with the snippet everywhere it is cached or read.
const CARRIERS = [
  'extension/background/background.js',
  'extension/popup/popup.js',
  'app/src/lib/api/snippetsApi.ts',
  'app/public/mobile/index.html',
];
for (const file of CARRIERS) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (src.indexOf('check_unfinished') === -1) fail(file + ' drops check_unfinished');
}
console.log('OK ' + SURFACES.length + ' surfaces ask before a snippet goes out');
