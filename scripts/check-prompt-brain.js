#!/usr/bin/env node
// A BRAIN INSIDE A PROMPT gate (v3.103.0).
//
// A prompt's Context block can carry a Brain: the prompt keeps a token,
// `{brain: id=<uuid>; name=<name>}`, and every surface swaps it for the
// Brain's items when the prompt is used. The rule lives once, in
// extension/shared/memory-pack.js. This gate runs the real code of each
// surface that hands a prompt out and pins that it goes through that rule:
//
//   1. the in-page """ menu (content.js): the Brain is read when the menu
//      opens, the pick inserts the finished text at once, a failed read still
//      inserts the prompt with a visible line, Interactive Steps comes first
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

// ── 1. the in-page menu, on the real content.js ───────────────────────
function bootContent(answer, stepsOn) {
  const noop = function () {};
  const stubEl = {
    id: '', style: {}, dataset: {}, textContent: '',
    appendChild: noop, remove: noop, addEventListener: noop, setAttribute: noop,
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null,
  };
  const asked = [];
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
          if (msg && msg.type === 'prompt_text') { asked.push(msg.text); answer(msg, cb); }
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
  sandbox.logEvent = noop;
  const field = { isContentEditable: false, getAttribute: () => null, value: '', selectionStart: 0, selectionEnd: 0 };
  return {
    asked,
    set prompts(list) { sandbox.userPrompts = list; },
    open() { sandbox._prefetchPromptBrains(); },
    pick(item) {
      inserted.length = 0;
      sandbox.triggerPickerMode = 'prompt';
      sandbox.triggerPickerFiltered = [item];
      sandbox.triggerPickerTarget = field;
      sandbox.triggerPickerDeleteLen = 0;
      sandbox.selectTriggerItem(0);
      return inserted.slice();
    },
  };
}

const SAVED = { id: '5b1c2f10-0000-4000-8000-000000000001', title: 'Note', body: PROMPT, shortcut: 'note', _group: 'list' };
const PLAIN = { id: '5b1c2f10-0000-4000-8000-000000000002', title: 'Plain', body: '## Objective\nPlain.', _group: 'list' };
{
  const page = bootContent((msg, cb) => cb({ ok: true, text: FINISHED }));
  page.prompts = [SAVED, PLAIN];
  page.open();
  check('menu: opening it asks once, for the prompt that carries a Brain', page.asked, [PROMPT]);
  check('menu: the pick inserts the finished prompt at once', page.pick(SAVED), [FINISHED]);
  check('menu: the pick asks nothing more', page.asked.length, 1);
  check('menu: a prompt without a Brain goes in as written, asking nothing', page.pick(PLAIN), ['## Objective\nPlain.']);
  page.open();
  check('menu: opening it again reads the Brain afresh', page.asked.length, 2);
}
{
  let pending = null;
  const page = bootContent((msg, cb) => { pending = cb; });
  page.prompts = [SAVED];
  page.open();
  check('menu: a pick before the answer waits for it', page.pick(SAVED), []);
  pending({ ok: true, text: FINISHED });
  check('menu: and asks no second time', page.asked.length, 1);
}
{
  const page = bootContent((msg, cb) => cb({ ok: false }));
  page.prompts = [SAVED];
  page.open();
  check('menu: no answer still inserts the prompt, with a visible line for the Brain', page.pick(SAVED), [FAILED]);
}
{
  const page = bootContent((msg, cb) => cb({ ok: true, text: FINISHED }), true);
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
  vm.runInContext(fnSource(BACKGROUND_SRC, 'function promptText(') + '\n' + fnSource(BACKGROUND_SRC, 'function withPromptBrains('), sandbox);
  return { calls, promptText: sandbox.promptText, withPromptBrains: sandbox.withPromptBrains };
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
  const panel = await bg.withPromptBrains([{ kind: 'prompt', id: 'p', body: PROMPT }, { kind: 'memory', id: 'm', body: TOKEN }]);
  check('worker: the Context panel gets the Brain without a block inside its block',
    panel[0].body, pack.resolvePromptBrains(PROMPT, { [ID]: { name: 'Marketing', items: ITEMS } }, 'missing', true));
  check('worker: only prompt rows are finished', panel[1].body, TOKEN);

  const none = bootBackground(() => Promise.resolve([]));
  check('worker: a Brain the reader cannot see becomes one visible line', await none.promptText(PROMPT), MISSING);
  const down = bootBackground(() => Promise.reject(new Error('offline')));
  check('worker: a read that fails says so in the same place', await down.promptText(PROMPT), FAILED);
  const quiet = bootBackground(() => { throw new Error('must not be asked'); });
  check('worker: a prompt without a Brain asks nothing', await quiet.promptText('## Objective\nPlain.'), '## Objective\nPlain.');
}

check('worker: loads the module', BACKGROUND_SRC.indexOf("importScripts('../shared/memory-pack.js');") !== -1, true);
check('worker: answers the menu', /msg\.type === 'prompt_text'[\s\S]{0,80}promptText\(/.test(BACKGROUND_SRC), true);
check('worker: finishes what the Context panel inserts', /memoryBodies\(msg\.items\)\.then\(withPromptBrains\)/.test(BACKGROUND_SRC), true);

// ── 3. the popup and the phone ────────────────────────────────────────
{
  const sandbox = {
    SBMemoryPack: pack,
    brains: [{ id: ID, name: 'Marketing' }],
    brainsFailed: false,
    brainItemsOf: (id) => (id === ID ? ITEMS : []),
    ensureBrains: (cb) => cb(),
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSource(POPUP_SRC, 'function promptBrainText('), sandbox);
  const out = (p) => { let got = null; sandbox.promptBrainText(p, (t) => { got = t; }); return got; };
  check('popup: copies the finished prompt', out({ content: PROMPT }), FINISHED);
  sandbox.brains = [];
  check('popup: a Brain it does not hold becomes one visible line', out({ content: PROMPT }), MISSING);
  sandbox.brainsFailed = true;
  check('popup: a load that failed says so', out({ content: PROMPT }), FAILED);
  check('popup: a prompt without a Brain is handed over as it is', out({ content: 'Plain.' }), 'Plain.');
}
check('popup: Copy goes through the Brain', fnSource(POPUP_SRC, 'function copyPrompt(').indexOf('promptBrainText(p,') !== -1, true);

{
  const sandbox = {
    SBMemoryPack: pack,
    allBrains: [{ id: ID, name: 'Marketing' }],
    memFailed: false,
    memItemsOf: (id) => (id === ID ? ITEMS : []),
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSource(MOBILE_SRC, 'function promptBrainText('), sandbox);
  check('phone: copies the finished prompt', sandbox.promptBrainText({ content: PROMPT }), FINISHED);
  sandbox.allBrains = [];
  check('phone: a Brain it does not hold becomes one visible line', sandbox.promptBrainText({ content: PROMPT }), MISSING);
  sandbox.memFailed = true;
  check('phone: a load that failed says so', sandbox.promptBrainText({ content: PROMPT }), FAILED);
}
['function promptCopy(', 'function sharePrompt('].forEach((decl) => {
  const src = fnSource(MOBILE_SRC, decl);
  check('phone: ' + decl.slice(9, -1) + ' waits for the Brains, then goes through them',
    src.indexOf('promptBrainsReady(p)') !== -1 && src.indexOf('promptBrainText(p)') !== -1, true);
});
check('phone: the Brains load as soon as a prompt needs them',
  /promptBrainRefs\(p\.content\|\|''\)\.length>0;\}\)\)loadMemory\(\);/.test(MOBILE_SRC), true);

// ── 4. the dashboard's Use window ─────────────────────────────────────
check('dashboard: the Use window reads the Brain before it copies',
  MODAL_SRC.indexOf('resolvePromptBrains(built)') !== -1 && MODAL_SRC.indexOf('if (!canCopy) return;') !== -1, true);

backgroundChecks().then(() => {
  if (failed) {
    console.error('\nX Brain inside a prompt: ' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('OK Brain inside a prompt gate');
}, (err) => {
  console.error('X Brain inside a prompt gate crashed:', err);
  process.exit(1);
});
