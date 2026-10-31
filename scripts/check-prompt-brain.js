#!/usr/bin/env node
// A BRAIN INSIDE A PROMPT gate (v3.104.0).
//
// A prompt's Context block can carry a Brain: the prompt keeps a token,
// `{brain: id=<uuid>; name=<name>}`, and every surface swaps it for the
// Brain's items when the prompt is used. The rule lives once, in
// extension/shared/memory-pack.js. This gate runs the real code of each
// surface that hands a prompt out and pins that it goes through that rule:
//
//   1. the in-page """ menu (content.js): the Brains are read in one message
//      when the menu opens and kept a minute, a pick inserts the finished text
//      at once or waits with the menu open, a failed read still inserts the
//      prompt with a visible line, Interactive Steps comes first; the Context
//      panel's Insert and Remove never touch a Brain inside a prompt
//   2. the service worker (background.js): reads the Brain the way the popup
//      and the phone do, answers the menu, and finishes a prompt the Context
//      panel inserts without a block inside its block
//   3. the popup (popup.js) and the phone (mobile/index.html): copy and share
//      finish the prompt from the Brains they hold, and say when a Brain is
//      not there
//   4. the dashboard's Use window reads the Brain before it copies
//
// The dashboard's own twins are held to the module by
// app/src/__tests__/promptBrain.test.ts.
//
// Run: node scripts/check-prompt-brain.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('  ok  ' + name);
  else {
    failed++;
    console.error('  X   ' + name + '\n      expected ' + JSON.stringify(expected) + '\n      got      ' + JSON.stringify(actual));
  }
}

// The source of one top-level function: from its declaration to the next one.
function fnSource(text, decl) {
  const start = text.indexOf(decl);
  if (start === -1) return '';
  const next = text.indexOf('\nfunction ', start + decl.length);
  return text.slice(start, next === -1 ? undefined : next);
}

const PACK_SRC = read('extension', 'shared', 'memory-pack.js');
const STEPS_SRC = read('extension', 'shared', 'interactive-steps.js');
const CONTENT_SRC = read('extension', 'content', 'content.js');
const BACKGROUND_SRC = read('extension', 'background', 'background.js');
const POPUP_SRC = read('extension', 'popup', 'popup.js');
const MOBILE_SRC = read('app', 'public', 'mobile', 'index.html');
const MODAL_SRC = read('app', 'src', 'features', 'prompts', 'PromptPreviewModal.tsx');

const pack = (function () {
  const mod = { exports: {} };
  new Function('module', 'exports', PACK_SRC)(mod, mod.exports);
  return mod.exports;
}());

const ID = '0f3e9c3a-1234-4bcd-9ef0-123456789abc';
const TOKEN = pack.brainToken({ id: ID, name: 'Marketing' });
const PROMPT = '## Objective\nWrite a short note.\n\n## Context\n' + TOKEN + '\n\nKeep it warm.';
const ITEMS = [{ name: 'Tone', body: 'Friendly.' }, { name: 'Hours', body: '9 to 5' }];
const FINISHED = pack.resolvePromptBrains(PROMPT, { [ID]: { name: 'Marketing', items: ITEMS } });
const FAILED = pack.resolvePromptBrains(PROMPT, {}, 'failed');
const MISSING = pack.resolvePromptBrains(PROMPT, {}, 'missing');

check('the finished prompt holds the Brain under a line naming it',
  FINISHED.indexOf('## Context\nSource material from "Marketing". ') !== -1 && FINISHED.indexOf('## Tone\nFriendly.') !== -1, true);
check('the token is gone from the finished prompt', FINISHED.indexOf('{brain:') === -1, true);
check('a read that failed leaves one visible line', FAILED.indexOf('[The Brain "Marketing" could not be loaded]') !== -1, true);

// The Context panel's Insert and Remove act on its own block, at the top of the
// draft, and never on a Brain inside a prompt further down.
const PANEL_BLOCK = pack.formatInjectedBlock({ items: [{ name: 'Note', text: 'Panel text.' }] });
check('panel: a finished prompt is not taken for the panel\'s block', pack.hasInjectedBlock(FINISHED), false);
check('panel: Remove leaves a finished prompt exactly as it is', pack.stripInjectedBlock(FINISHED), FINISHED);
check('panel: its own block on top is still found', pack.hasInjectedBlock(PANEL_BLOCK + FINISHED), true);
check('panel: and removed, leaving the prompt and its Brain whole', pack.stripInjectedBlock(PANEL_BLOCK + FINISHED), FINISHED);
check('panel: a block after blank lines at the top still counts', pack.stripInjectedBlock('\n\n' + PANEL_BLOCK + 'Draft'), '\n\nDraft');

// ── 1. the in-page menu, on the real content.js ───────────────────────
function bootContent(answer, stepsOn) {
  const noop = function () {};
  const stubEl = {
    id: '', style: {}, dataset: {}, textContent: '',
    appendChild: noop, remove: noop, addEventListener: noop, setAttribute: noop,
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null,
  };
  const asked = [];
  const logged = [];
  const area = { sb_interactive_steps_enabled: !!stepsOn };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    innerWidth: 1280, innerHeight: 800,
    document: {
      addEventListener: noop, removeEventListener: noop,
      createElement: () => Object.assign({}, stubEl),
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      head: Object.assign({}, stubEl), body: Object.assign({}, stubEl), activeElement: null,
    },
    chrome: {
      storage: {
        local: {
          get: (k, cb) => { const out = {}; [].concat(k).forEach((key) => { if (key in area) out[key] = area[key]; }); if (cb) cb(out); },
          set: (o, cb) => { Object.assign(area, o); if (cb) cb(); },
          remove: noop,
        },
        sync: { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb(), remove: noop },
        onChanged: { addListener: noop },
      },
      runtime: {
        id: 'extension', lastError: null, onMessage: { addListener: noop },
        sendMessage(msg, cb) {
          if (msg && msg.type === 'prompt_texts') { asked.push(msg.texts.slice()); answer(msg, cb); }
          if (msg && msg.type === 'log_prompt_use') logged.push(msg.prompt_id);
        },
      },
    },
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('extension', 'formula-engine.js'), sandbox);
  vm.runInContext(read('extension', 'shared', 'snippet-stats.js'), sandbox);
  vm.runInContext(PACK_SRC, sandbox);
  vm.runInContext(STEPS_SRC, sandbox);
  vm.runInContext(CONTENT_SRC, sandbox);
  const inserted = [];
  sandbox.insertText = function (el, text) { inserted.push(text); };
  // A prompt pick is a prompt use: it must never be logged as a snippet use.
  sandbox.logEvent = function () { logged.push('snippet use'); };
  const field = { isContentEditable: false, getAttribute: () => null, value: '', selectionStart: 0, selectionEnd: 0 };
  const hints = [];
  const menu = { remove() {}, querySelector: (sel) => (sel === '.sb-tp-hint' ? { set textContent(t) { hints.push(t); } } : null) };
  return {
    asked,
    logged,
    hints,
    inserted,
    set prompts(list) { sandbox.userPrompts = list; },
    open() { sandbox._prefetchPromptBrains(); },
    // A pick with the menu open on `item`, as Tab / Enter or an exact shortcut makes it.
    pick(item) {
      inserted.length = 0;
      sandbox.triggerPickerEl = menu;
      sandbox.triggerPickerMode = 'prompt';
      sandbox.triggerPickerFiltered = [item];
      sandbox.triggerPickerTarget = field;
      sandbox.triggerPickerQuery = '';
      sandbox.triggerPickerDeleteLen = 0;
      sandbox.selectTriggerItem(0);
      return inserted.slice();
    },
    typeInMenu(ch) { sandbox.triggerPickerQuery += ch; },
    closeMenu() { sandbox.closeTriggerPicker(); },
    // Ages every kept answer past the minute it is kept for.
    age() { Object.keys(sandbox._promptBrainCache).forEach((t) => { sandbox._promptBrainCache[t].at -= 61000; }); },
  };
}

const SAVED = { id: '5b1c2f10-0000-4000-8000-000000000001', title: 'Note', body: PROMPT, shortcut: 'note', _group: 'list' };
const OTHER_PROMPT = PROMPT.replace('Write a short note.', 'Write a reply.');
const SAVED2 = { id: '5b1c2f10-0000-4000-8000-000000000003', title: 'Reply', body: OTHER_PROMPT, _group: 'list' };
const PLAIN = { id: '5b1c2f10-0000-4000-8000-000000000002', title: 'Plain', body: '## Objective\nPlain.', _group: 'list' };
const finish = (t) => pack.resolvePromptBrains(t, { [ID]: { name: 'Marketing', items: ITEMS } });
const answerAll = (msg, cb) => cb({ ok: true, texts: msg.texts.map(finish) });
{
  const page = bootContent(answerAll);
  page.prompts = [SAVED, PLAIN, SAVED2];
  page.open();
  check('menu: opening it asks once, in one message, for every prompt that carries a Brain', page.asked, [[PROMPT, OTHER_PROMPT]]);
  check('menu: the pick inserts the finished prompt at once', page.pick(SAVED), [FINISHED]);
  check('menu: the pick asks nothing more', page.asked.length, 1);
  check('menu: a prompt without a Brain goes in as written, asking nothing', page.pick(PLAIN), ['## Objective\nPlain.']);
  check('menu: each pick is logged as a use of that prompt, never as a snippet use', page.logged, [SAVED.id, PLAIN.id]);
  page.pick({ id: 'formal', title: 'Formal tone', body: 'Please rewrite in a formal, professional tone:\n' });
  check('menu: a built-in Base Prompt has no row to count, so nothing is logged', page.logged, [SAVED.id, PLAIN.id]);
  page.open();
  check('menu: opening it again within the minute asks nothing', page.asked.length, 1);
  page.age();
  page.open();
  check('menu: after the minute it reads the Brains afresh', page.asked.length, 2);
}
{
  let pending = null;
  const page = bootContent((msg, cb) => { pending = () => answerAll(msg, cb); });
  page.prompts = [SAVED];
  page.open();
  check('menu: a pick before the answer inserts nothing yet', page.pick(SAVED), []);
  check('menu: and the menu says the Brain is on its way', page.hints[page.hints.length - 1], 'Adding your Brain\u2026');
  pending();
  check('menu: the answer then inserts the pick', page.inserted.slice(), [FINISHED]);
  check('menu: having asked once', page.asked.length, 1);
}
{
  let pending = null;
  const page = bootContent((msg, cb) => { pending = () => answerAll(msg, cb); });
  page.prompts = [SAVED];
  page.open();
  page.pick(SAVED);
  page.typeInMenu('x');
  pending();
  check('menu: typing during the wait drops the held pick, so nothing lands after the new words', page.inserted.slice(), []);
}
{
  let pending = null;
  const page = bootContent((msg, cb) => { pending = () => answerAll(msg, cb); });
  page.prompts = [SAVED];
  page.open();
  page.pick(SAVED);
  page.closeMenu();
  pending();
  check('menu: closing it during the wait drops the held pick', page.inserted.slice(), []);
}
{
  const page = bootContent((msg, cb) => cb({ ok: false }));
  page.prompts = [SAVED];
  page.open();
  check('menu: no answer still inserts the prompt, with a visible line for the Brain', page.pick(SAVED), [FAILED]);
  page.open();
  check('menu: a failed answer is not kept, so the next menu asks again', page.asked.length, 2);
}
{
  const page = bootContent(answerAll, true);
  page.prompts = [SAVED];
  page.open();
  const got = page.pick(SAVED);
  check('menu: Interactive Steps goes in front of the finished prompt',
    got.length === 1 && got[0].indexOf('<INTERACTIVE_STEPS>') === 0 && got[0].slice(-FINISHED.length) === FINISHED, true);
}
check('menu: opening the prompt menu reads the Brains',
  fnSource(CONTENT_SRC, 'function showTriggerPicker(').indexOf("if (mode === 'prompt') _prefetchPromptBrains();") !== -1, true);

// ── 2. the service worker ─────────────────────────────────────────────
function bootBackground(fetchAll) {
  const calls = [];
  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    SBMemoryPack: pack,
    supaFetchAll(table, qs) { calls.push(table + '?' + qs); return fetchAll(table, qs); },
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSource(BACKGROUND_SRC, 'function promptTexts(') + '\n' + fnSource(BACKGROUND_SRC, 'function withPromptBrains('), sandbox);
  const promptText = (t) => sandbox.promptTexts([t]).then((out) => out[0].text);
  return { calls, promptText, promptTexts: sandbox.promptTexts, withPromptBrains: sandbox.withPromptBrains };
}

async function backgroundChecks() {
  const rows = {
    memory_spaces: [{ id: ID, name: 'Marketing' }],
    memory_shards: [{ space_id: ID, name: 'Tone', body: 'Friendly.' }, { space_id: ID, name: 'Hours', body: '9 to 5' }],
  };
  const bg = bootBackground((table) => Promise.resolve(rows[table]));
  check('worker: finishes the prompt the menu asks for', await bg.promptText(PROMPT), FINISHED);
  check('worker: reads live Brains and live, unarchived items, in the popup\'s order', bg.calls, [
    'memory_spaces?select=id,name&deleted_at=is.null&id=in.(' + ID + ')',
    'memory_shards?select=space_id,name,body&deleted_at=is.null&review_status=neq.archived&space_id=in.(' + ID + ')&order=pinned.desc,updated_at.desc,id.asc',
  ]);
  const many = bootBackground((table) => Promise.resolve(rows[table]));
  const two = await many.promptTexts([PROMPT, OTHER_PROMPT, 'Plain.']);
  check('worker: several prompts are finished from one read', [two.map((d) => d.text), many.calls.length], [[FINISHED, finish(OTHER_PROMPT), 'Plain.'], 2]);
  check('worker: with no note when every Brain went in', two.map((d) => d.note), ['', '', '']);
  const panel = await bg.withPromptBrains([{ kind: 'prompt', id: 'p', body: PROMPT }, { kind: 'memory', id: 'm', body: TOKEN }]);
  const plainText = pack.resolvePromptBrains(PROMPT, { [ID]: { name: 'Marketing', items: ITEMS } }, 'missing', true);
  check('worker: the Context panel gets the Brain without a block inside its block', panel[0].body, plainText);
  check('worker: and counts the finished prompt, not the reference', panel[0].tokens, pack.estimateTokens(plainText));
  check('worker: only prompt rows are finished', [panel[1].body, panel[1].tokens], [TOKEN, undefined]);

  const none = bootBackground(() => Promise.resolve([]));
  check('worker: a Brain the reader cannot see becomes one visible line', await none.promptText(PROMPT), MISSING);
  check('worker: and comes with the sentence that says so', (await none.promptTexts([PROMPT]))[0].note, 'The Brain "Marketing" is not available here.');
  const down = bootBackground(() => Promise.reject(new Error('offline')));
  check('worker: a read that fails says so in the same place', await down.promptText(PROMPT), FAILED);
  check('worker: and in its sentence', (await down.promptTexts([PROMPT]))[0].note, 'The Brain "Marketing" could not be loaded.');
  const quiet = bootBackground(() => { throw new Error('must not be asked'); });
  check('worker: a prompt without a Brain asks nothing', await quiet.promptText('## Objective\nPlain.'), '## Objective\nPlain.');
}

check('worker: loads the module', BACKGROUND_SRC.indexOf("importScripts('../shared/memory-pack.js');") !== -1, true);
check('worker: answers the menu and the popup', /msg\.type === 'prompt_texts'[\s\S]{0,200}promptTexts\(texts\)/.test(BACKGROUND_SRC), true);
check('panel: budgets on the finished prompt\'s size', /tokens: \(row && typeof row\.tokens === 'number'\) \? row\.tokens : c\.tokens/.test(read('extension', 'content', 'memory-picker.js')), true);
check('worker: finishes what the Context panel inserts', /memoryBodies\(msg\.items\)\.then\(withPromptBrains\)/.test(BACKGROUND_SRC), true);

// ── 3. the popup and the phone ────────────────────────────────────────
// The popup copies through the worker, the reader the """ menu uses.
function popupCopy(answer) {
  const asked = [];
  const sandbox = {
    SBMemoryPack: pack,
    chrome: { runtime: { lastError: null, sendMessage(msg, cb) { asked.push(msg); answer(msg, cb); } } },
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSource(POPUP_SRC, 'function promptBrainText('), sandbox);
  return (content) => { let got = null; sandbox.promptBrainText({ content }, (t, note) => { got = [t, note]; }); return { got, asked }; };
}
{
  const copy = popupCopy((msg, cb) => cb({ ok: true, texts: msg.texts.map(finish), notes: msg.texts.map(() => '') }));
  const r = copy(PROMPT);
  check('popup: copies the prompt the worker finished', r.got, [FINISHED, '']);
  check('popup: asks the worker, as the menu does', r.asked, [{ type: 'prompt_texts', texts: [PROMPT] }]);
  const plain = copy('Plain.');
  check('popup: a prompt without a Brain is handed over at once, asking nothing', [plain.got, plain.asked.length], [['Plain.', ''], 1]);
  const gone = popupCopy((msg, cb) => cb({ ok: true, texts: [MISSING], notes: ['The Brain "Marketing" is not available here.'] }))(PROMPT);
  check('popup: says when a Brain was left out', gone.got, [MISSING, 'The Brain "Marketing" is not available here.']);
  const down = popupCopy((msg, cb) => cb(undefined))(PROMPT);
  check('popup: a worker that does not answer leaves a visible line, and says so', down.got, [FAILED, 'The Brain "Marketing" could not be loaded.']);
}
check('popup: Copy goes through the Brain and its note', /promptBrainText\(p, function\(content, note\)/.test(fnSource(POPUP_SRC, 'function copyPrompt(')), true);
check('popup: the Brains tab keeps its own order', /order=pinned\.desc,updated_at\.desc,id\.asc/.test(POPUP_SRC), true);

// The phone reads only the Brains its prompts name, into its own lookup. It
// runs on its own generated copy of the module, so a copy left behind fails here.
const PHONE_PACK_SRC = (function () {
  const begin = MOBILE_SRC.indexOf('<!-- SB_MEMORY_PACK:BEGIN');
  const end = MOBILE_SRC.indexOf('<!-- SB_MEMORY_PACK:END -->');
  if (begin === -1 || end === -1) return '';
  return MOBILE_SRC.slice(MOBILE_SRC.indexOf('<script>', begin) + '<script>'.length, MOBILE_SRC.lastIndexOf('</script>', end));
}());
check('phone: carries its copy of the module', PHONE_PACK_SRC.indexOf('function resolvePromptBrains(') !== -1, true);
function bootPhone(fetchAll) {
  const calls = [];
  const sandbox = {
    console: { error() {} },
    allPrompts: [{ content: PROMPT }, { content: 'Plain.' }],
    memFetchAll(table, select, order, filter) { calls.push([table, select, order, filter]); return fetchAll(table); },
    toasts: [], showToast(t) { sandbox.toasts.push(t); },
    MEM_LONG_TOKENS: 4000,
  };
  vm.createContext(sandbox);
  vm.runInContext(PHONE_PACK_SRC, sandbox);
  vm.runInContext('var promptBrainLookup=null, promptBrainLoading=false, promptBrainFailed=false, promptBrainQueued=false;\n' +
    ['function promptBrainIds(', 'function loadPromptBrains(', 'function promptBrainText(', 'function promptBrainNote(',
      'function promptBrainsReady(', 'function promptCopyNote('].map((d) => fnSource(MOBILE_SRC, d)).join('\n'), sandbox);
  return { sandbox, calls, settle: () => new Promise((r) => setTimeout(r, 0)) };
}
async function phoneChecks() {
  const rows = { memory_spaces: [{ id: ID, name: 'Marketing' }], memory_shards: [{ space_id: ID, name: 'Tone', body: 'Friendly.' }, { space_id: ID, name: 'Hours', body: '9 to 5' }] };
  const phone = bootPhone((t) => Promise.resolve(rows[t]));
  const p = { content: PROMPT };
  check('phone: a tap before the first read asks for another tap', phone.sandbox.promptBrainsReady(p), false);
  check('phone: and says why', phone.sandbox.toasts, ['Your Brains are still loading. Tap again in a moment']);
  await phone.settle(); await phone.settle();
  check('phone: reads only the Brains its prompts name, items in the extension\'s order', phone.calls, [
    ['memory_spaces', 'id,name', 'name.asc,id.asc', '&id=in.(' + ID + ')'],
    ['memory_shards', 'id,space_id,name,body', 'pinned.desc,updated_at.desc,id.asc', '&review_status=neq.archived&space_id=in.(' + ID + ')'],
  ]);
  check('phone: then the tap is ready', phone.sandbox.promptBrainsReady(p), true);
  check('phone: copies the finished prompt', phone.sandbox.promptBrainText(p), FINISHED);
  check('phone: with no note', phone.sandbox.promptBrainNote(p), '');
  check('phone: a prompt without a Brain is returned as it is', phone.sandbox.promptBrainText({ content: 'Plain.' }), 'Plain.');

  const theirs = bootPhone((t) => Promise.resolve(t === 'memory_spaces' ? [] : rows[t]));
  theirs.sandbox.loadPromptBrains(); await theirs.settle(); await theirs.settle();
  check('phone: none of the Brains is this person\'s: no item read at all', theirs.calls.length, 1);
  check('phone: a Brain it cannot see becomes one visible line', theirs.sandbox.promptBrainText(p), MISSING);
  check('phone: and the copy says so', theirs.sandbox.promptCopyNote(p, MISSING), ' The Brain "Marketing" is not available here.');

  const down = bootPhone(() => Promise.reject(new Error('offline')));
  down.sandbox.loadPromptBrains(); await down.settle(); await down.settle();
  check('phone: after a failed first read the tap goes ahead', down.sandbox.promptBrainsReady(p), true);
  check('phone: with a visible line for the Brain', down.sandbox.promptBrainText(p), FAILED);
  check('phone: and asks again for the next tap', down.calls.length, 2);

  let fail = false;
  const refresh = bootPhone((t) => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(rows[t])));
  refresh.sandbox.loadPromptBrains(); await refresh.settle(); await refresh.settle();
  fail = true;
  refresh.sandbox.loadPromptBrains(); await refresh.settle(); await refresh.settle();
  check('phone: a refresh that failed keeps the Brains in hand', refresh.sandbox.promptBrainText(p), FINISHED);
}
['function promptCopy(', 'function sharePrompt('].forEach((decl) => {
  const src = fnSource(MOBILE_SRC, decl);
  check('phone: ' + decl.slice(9, -1) + ' waits for the Brains, then goes through them',
    src.indexOf('promptBrainsReady(p)') !== -1 && src.indexOf('promptBrainText(p)') !== -1, true);
});
check('phone: the prompts\' Brains are read when the prompts arrive', fnSource(MOBILE_SRC, 'function loadPrompts(').indexOf('loadPromptBrains();') !== -1, true);
check('phone: and again when the prompts or the page come back into view',
  fnSource(MOBILE_SRC, 'function showPrompts(').indexOf('loadPromptBrains();') !== -1 && /visibilityState==='visible'\)\{[^}]*loadPromptBrains\(\)/.test(MOBILE_SRC), true);
check('phone: the Brains page orders tied items by id, as the extension does',
  MOBILE_SRC.indexOf("'pinned.desc,updated_at.desc,id.asc')") !== -1 && fnSource(MOBILE_SRC, 'function memByItemOrder(').indexOf("localeCompare(String(b.id||''))") !== -1, true);

// ── 4. the dashboard's Use window ─────────────────────────────────────
check('dashboard: reads a prompt\'s Brains in the extension\'s order and filter, every page',
  /listPromptBrainItems[\s\S]{0,900}\.neq\('review_status', 'archived'\)[\s\S]{0,200}\.order\('pinned', \{ ascending: false \}\)[\s\S]{0,80}\.order\('updated_at', \{ ascending: false \}\)[\s\S]{0,80}\.order\('id', \{ ascending: true \}\)/.test(read('app', 'src', 'lib', 'api', 'memoryApi.ts')), true);
check('dashboard: the Use window reads the Brain before it copies',
  MODAL_SRC.indexOf('resolvePromptBrains(built)') !== -1 && MODAL_SRC.indexOf('if (!canCopy) return;') !== -1, true);

backgroundChecks().then(phoneChecks).then(() => {
  if (failed) {
    console.error('\nX Brain inside a prompt: ' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('OK Brain inside a prompt gate');
}, (err) => {
  console.error('X Brain inside a prompt gate crashed:', err);
  process.exit(1);
});
