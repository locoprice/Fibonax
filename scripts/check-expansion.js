// Trigger-expansion behavior gate (EXPANSION-001).
//
// Pins WHEN a typed trigger expands and HOW MANY characters it removes — the
// two numbers that decide whether the field is left clean.
//
// The bug this gate exists for: a shortcut that is also the opening of a longer
// word fired the instant it matched. Typing "::neobooking" expanded "::neob" at
// the sixth character and stranded "ooking" in the message; "::forms" could
// never be reached because "::form" fired one character earlier. A match now
// settles before it expands (see _armMatch in content.js) and a further letter
// drops it, so the longer trigger gets its turn.
//
// The real content.js runs in a vm context with the DOM surface it touches at
// load time stubbed out. Keystrokes go through the SHIPPING keydown listener,
// and handleMatch is intercepted so each case can assert the snippet that fired
// and the delete span, against a plain-string model of the field.
const path = require('path');
const fs = require('fs');
const vm = require('vm');

function fail(msg) {
  console.error('X ' + msg);
  process.exit(1);
}

const ENGINE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'formula-engine.js'), 'utf8');
const CONTENT_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'content', 'content.js'), 'utf8');
// content.js groups language variants through the shared rule, which the
// manifest loads ahead of it. The gate has to load it in the same order.
const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'shared', 'snippet-stats.js'), 'utf8');
// The same goes for the Interactive Steps setting it reads while loading.
const STEPS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'shared', 'interactive-steps.js'), 'utf8');

// Mirrors the production shapes that collide: a shortcut that opens a longer
// word ("neob"), a shortcut that is the prefix of another ("form"/"forms"), and
// an alternative query that spells the word the user actually types.
const LIBRARY = [
  { id: 'neob',  shortcut: 'neob',  title: 'NEO BOOKING', lang: 'ES',
    alternative_queries: ['booking', 'neobooking'], body: 'NEOB BODY' },
  { id: 'form',  shortcut: 'form',  title: 'JOT FORM',  lang: 'ES', body: 'FORM BODY' },
  { id: 'forms', shortcut: 'forms', title: 'JOT FORMS', lang: 'ES', body: 'FORMS BODY' },
  { id: 'time',  shortcut: 'time',  title: 'TIME',      lang: 'EN', body: 'TIME BODY' },
  // A {{name}} body opens the fill-in box before anything is inserted.
  { id: 'greet', shortcut: 'greet', title: 'GREET',     lang: 'EN', body: 'Hello {{name}}' },
];

// ── minimal host: only what content.js touches while loading ────────
const listeners = {};
// What the page sent to the service worker, and who listens for a change to
// the stored library (runLibraryRefreshCases).
const sent = [];
const storageListeners = [];
const noop = function () {};
const stubEl = {
  id: '', style: {}, dataset: {}, textContent: '',
  appendChild: noop, remove: noop, addEventListener: noop, setAttribute: noop,
  querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null,
};
const RECT = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  innerWidth: 1280, innerHeight: 800,
  document: {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: noop,
    createElement: () => Object.assign({}, stubEl),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    head: Object.assign({}, stubEl),
    body: Object.assign({}, stubEl),
    activeElement: null,
  },
  chrome: {
    storage: {
      local: { get: (k, cb) => cb && cb({ snippets: LIBRARY }), set: (o, cb) => cb && cb() },
      sync:  { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb(), remove: noop },
      onChanged: { addListener: (fn) => { storageListeners.push(fn); } },
    },
    // Messages are recorded and never answered, as before: no callback runs.
    runtime: { id: 'gate', lastError: null, sendMessage: (msg) => { sent.push(msg); }, onMessage: { addListener: noop } },
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(ENGINE_SRC, sandbox);
  vm.runInContext(STATS_SRC, sandbox);
  vm.runInContext(STEPS_SRC, sandbox);
  vm.runInContext(CONTENT_SRC, sandbox);
} catch (e) {
  fail('content.js failed to evaluate in the gate context: ' + e.message);
}
if (typeof sandbox.checkBuf !== 'function') fail('content.js no longer exposes checkBuf');
if (typeof sandbox._armMatch !== 'function') {
  fail('content.js no longer arms a match before expanding.\n' +
    '  Expanding the instant a shortcut matches strands the rest of the word in\n' +
    '  the field (typing "::neobooking" fired "::neob" and left "ooking").');
}
const onKeyDown = (listeners.keydown || [])[0];
if (!onKeyDown) fail('content.js no longer registers a keydown listener');

// ── field model + intercepted expansion ─────────────────────────────
// The field is a live textarea model so the REAL handleMatch runs, including
// the span correction that reads the text in front of the caret. Interception
// sits one level lower, at deleteChars — the call that finally decides how many
// characters leave the field.
let fired = null;   // { id, span, result }

const target = {
  tagName: 'TEXTAREA', value: '', selectionStart: 0, selectionEnd: 0,
  closest: () => null, getAttribute: () => null,
  getBoundingClientRect: () => RECT,   // the picker anchors to the field's box
  focus: noop, setSelectionRange: noop,
};

function setField(text) {
  target.value = text;
  target.selectionStart = target.selectionEnd = text.length;
}

sandbox.deleteChars = function (el, n, cb) {
  fired = { span: n, result: target.value.slice(0, Math.max(0, target.value.length - n)) };
  if (cb) cb();
};
sandbox._proceedInsert = function (el, snip) {
  if (fired) { fired.id = snip.id; fired.result += '<' + snip.id + '>'; }
  sandbox.processing = false;
};
sandbox.injectLangModal = function () { fail('unexpected language modal in a single-variant fixture'); };

// Whether the last key() was kept from the page. A key the extension consumes
// must not reach the page's own editor: Lexical (WhatsApp Web) acts on Enter
// even when it is prevented, and added a blank line under the snippet.
let stopped = false;

function key(k) {
  let prevented = false;
  stopped = false;
  onKeyDown({ key: k, target: target, ctrlKey: false, metaKey: false,
              preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  if (!prevented && k.length === 1) setField(target.value + k);
  return prevented;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeText(text, gapMs) {
  for (const ch of text) { key(ch); await wait(gapMs); }
}

async function reset() {
  sandbox.closeTriggerPicker();   // a case may leave the suggestion menu open
  sandbox._cancelArmed();
  sandbox.buf = '';
  sandbox.processing = false;
  sandbox.triggerPending = false;
  sandbox.triggerAffix = '';
  fired = null;
  setField('');
  await wait(60);
}

// SETTLE must outlast MATCH_SETTLE_MS in content.js; read it rather than guess.
const SETTLE = sandbox.MATCH_SETTLE_MS + 150;
const FAST = 60;    // a burst well inside the settle window

const cases = [
  { name: 'over-typed trigger ("::neobooking") does not fire mid-word',
    run: async () => { await typeText('::neobooking', FAST); await wait(SETTLE); },
    expect: { id: 'neob', span: 12, result: '<neob>' } },

  { name: 'exact trigger then a pause still expands',
    run: async () => { await typeText('::time', FAST); await wait(SETTLE); },
    expect: { id: 'time', span: 6, result: '<time>' } },

  { name: 'space confirms and is consumed with the trigger',
    run: async () => { setField('hola '); await typeText('::time ', FAST); await wait(200); },
    expect: { id: 'time', span: 7, result: 'hola <time>' } },

  { name: 'longer shortcut reaches its own snippet ("::forms")',
    run: async () => { await typeText('::forms', FAST); await wait(SETTLE); },
    expect: { id: 'forms', span: 7, result: '<forms>' } },

  { name: 'shorter shortcut alone still wins ("::form")',
    run: async () => { await typeText('::form', FAST); await wait(SETTLE); },
    expect: { id: 'form', span: 6, result: '<form>' } },

  { name: 'unknown tail expands nothing and keeps the text',
    run: async () => { await typeText('::timeXYZ', FAST); await wait(SETTLE); },
    expect: null },

  { name: 'Enter confirms instead of sending the raw trigger',
    run: async () => {
      await typeText('::time', FAST);
      if (!key('Enter')) fail('Enter was not consumed while a match was armed: the raw trigger would be sent');
      if (!stopped) fail('Enter confirmed the match but still reached the page\'s editor');
      await wait(120);
    },
    expect: { id: 'time', span: 6, result: '<time>' } },

  { name: 'Tab confirms an armed match',
    run: async () => {
      await typeText('::time', FAST);
      key('Tab');
      if (!stopped) fail('Tab confirmed the match but still reached the page\'s editor');
      await wait(120);
    },
    expect: { id: 'time', span: 6, result: '<time>' } },

  // A prefix that is not a whole shortcut expands nothing on its own. Inserting
  // it is the opt-in "Insert automatically" setting, pinned in runAutoInsertCases.
  { name: 'prefix "::neo" expands nothing by default (the menu opens instead)',
    run: async () => { await typeText('::neo', FAST); await wait(SETTLE); },
    expect: null },

  { name: 'ambiguous prefix "::for" expands nothing (form vs forms)',
    run: async () => { await typeText('::for', FAST); await wait(SETTLE); },
    expect: null },

  { name: 'two letters "::ne" are below the prefix floor',
    run: async () => { await typeText('::ne', FAST); await wait(SETTLE); },
    expect: null },

  { name: 'single letter "::n" is below the prefix floor',
    run: async () => { await typeText('::n', FAST); await wait(SETTLE); },
    expect: null },

  { name: 'the floor also holds when the menu is already open (slow typing)',
    run: async () => { await typeText('::ne', 260); await wait(SETTLE); },
    expect: null },

  { name: 'space after a prefix closes the menu and keeps the text',
    run: async () => { await typeText('::neo ', FAST); await wait(200); },
    expect: null },

  { name: 'a trigger sitting inside a word expands nothing',
    run: async () => { await typeText('ratio::xyz', FAST); await wait(SETTLE); },
    expect: null },
];

// ── span correction (measured from the field, not counted) ──────────
// Every counter that feeds a delete span can drift from the field — a menu that
// swallows a keystroke, an editor that rewrites what it received. When it does,
// the deletion must still start at the trigger: the alternative is a piece of
// the trigger stranded in the message ("::ne" in front of the snippet).
const spanCases = [
  { name: 'count 4 short is corrected back to the trigger',
    value: '::neobooking', span: 8,  expect: 12 },
  { name: 'count reduced to the bare trigger is corrected',
    value: '::neob',       span: 2,  expect: 6 },
  { name: 'text before the trigger is never touched',
    value: 'hola ::neob',  span: 2,  expect: 6 },
  { name: 'a correct count is left alone',
    value: 'hola ::time',  span: 6,  expect: 6 },
  { name: 'a trailing space confirmed the trigger — count stands',
    value: 'hola ::time ', span: 7,  expect: 7 },
  { name: 'no trigger in front of the caret — count stands',
    value: 'plain text',   span: 4,  expect: 4 },
  { name: 'a word break means the trigger was abandoned — count stands',
    value: '::neo hola',   span: 4,  expect: 4 },
];

function runSpanCases() {
  for (const c of spanCases) {
    setField(c.value);
    const got = sandbox._fieldTriggerSpan(target, c.span);
    if (got !== c.expect) {
      fail('span case "' + c.name + '" -> got ' + got + ', expected ' + c.expect +
        '\n  field ' + JSON.stringify(c.value) + ', counted span ' + c.span);
    }
  }
}

// Enter on the open suggestion menu picks the highlighted snippet and, like
// Enter on an armed match, must not reach the page's editor as well.
async function runPickerEnterCase() {
  await reset();
  // The menu path celebrates directly; the card's DOM is not modelled here.
  sandbox.showCelebration = noop;
  await typeText('::ti', 260);   // slow enough for the menu to open
  if (!sandbox.triggerPickerEl) fail('picker case: the suggestion menu did not open for "::ti"');
  if (!key('Enter')) fail('picker case: Enter on the open menu was not consumed');
  if (!stopped) fail('picker case: Enter picked from the menu but still reached the page\'s editor');
  await wait(60);
  if (!fired || fired.span !== 4 || fired.result !== '') {
    fail('picker case: Enter on the menu -> ' + JSON.stringify(fired) + ', expected the 4-character "::ti" removed');
  }
  return 1;
}

// A snippet or a prompt saved a moment ago must be in the menu. The page works
// from a copy of the library, and until v3.137.1 nothing brought that copy up
// to date when a trigger was typed: a new snippet stayed out of the menu until
// the next tab switch or the 5 minute timer, a new prompt until the popup was
// opened. Typing a trigger now asks the worker for a fresh copy, and a menu
// that is open redraws when the copy changes.
async function runLibraryRefreshCases() {
  const refreshes = () => sent.filter((m) => m && m.type === 'SB_LIBRARY_REFRESH').length;
  const stored = (changes) => storageListeners.forEach((fn) => fn(changes, 'local'));
  const ids = () => sandbox.triggerPickerFiltered.map((s) => s.id);
  const NEW = { id: 'airbnb', shortcut: 'airbnb_update', title: 'AIRBNB UPDATE', lang: 'EN', body: 'NEW BODY' };
  let count = 0;

  if (!storageListeners.length) fail('refresh case: content.js no longer listens for a change to the stored library');

  // 1. The snippet trigger asks for a fresh copy, once.
  await reset();
  sent.length = 0;
  await typeText('::', FAST);
  if (refreshes() !== 1) {
    fail('refresh case: typing the snippet trigger asked for a fresh library ' + refreshes() + ' time(s), expected 1.\n' +
      '  Without it a snippet saved a moment ago is missing from the menu for minutes.');
  }
  count++;

  // 2. The menu is open on "No matches"; the new snippet arrives and is listed.
  await typeText('air', 260);
  if (!sandbox.triggerPickerEl) fail('refresh case: the suggestion menu did not open for "::air"');
  if (ids().length !== 0) fail('refresh case: fixture drift, "::air" should match nothing before the refresh');
  stored({ snippets: { newValue: LIBRARY.concat([NEW]) } });
  if (JSON.stringify(ids()) !== '["airbnb"]') {
    fail('refresh case: a snippet that arrived while the menu was open is not in it: ' + JSON.stringify(ids()) +
      '\n  The menu must redraw when the stored library changes.');
  }
  if (refreshes() !== 1) fail('refresh case: letters typed after the trigger asked for the library again');
  count++;

  // 3. The highlighted row stays the highlighted row when the list grows above it.
  await reset();
  stored({ snippets: { newValue: LIBRARY } });
  await typeText('::for', 260);
  key('ArrowDown');
  const heldId = ids()[sandbox.triggerPickerIdx];
  stored({ snippets: { newValue: [{ id: 'fora', shortcut: 'fora', title: 'FORA', lang: 'EN', body: 'B' }].concat(LIBRARY) } });
  if (ids()[sandbox.triggerPickerIdx] !== heldId || ids().indexOf('fora') === -1) {
    fail('refresh case: the highlighted snippet changed when the list was redrawn: was ' + heldId +
      ', now ' + ids()[sandbox.triggerPickerIdx] + ' in ' + JSON.stringify(ids()));
  }
  count++;

  // 4. The same for prompts: the trigger asks, and a new prompt joins the open menu.
  await reset();
  stored({ snippets: { newValue: LIBRARY } });
  sent.length = 0;
  await typeText('"""', FAST);
  if (refreshes() !== 1) fail('refresh case: typing the prompt trigger asked for a fresh library ' + refreshes() + ' time(s), expected 1');
  if (!sandbox.triggerPickerEl || sandbox.triggerPickerMode !== 'prompt') fail('refresh case: the prompt menu did not open for """');
  stored({ sb_prompts: { newValue: [{ id: 'p-new', title: 'NEW PROMPT', body: 'text', shortcut: '' }] } });
  if (ids().indexOf('p-new') === -1) {
    fail('refresh case: a prompt that arrived while the menu was open is not in it: ' + JSON.stringify(ids()));
  }
  count++;

  // 5. A change to snippets leaves an open prompt menu alone, and the reverse.
  const before = JSON.stringify(ids());
  stored({ snippets: { newValue: LIBRARY.concat([NEW]) } });
  if (JSON.stringify(ids()) !== before || sandbox.triggerPickerMode !== 'prompt') {
    fail('refresh case: a snippet change redrew the prompt menu');
  }
  stored({ sb_prompts: { newValue: [] }, snippets: { newValue: LIBRARY } });
  count++;

  await reset();
  return count;
}

// The worker's side of the same fix, read from the shipped files: it answers
// the page's request, keeps a short wait of its own, and fills the prompt list
// through the mapping the popup uses, never emptying it on a read that failed.
function runWorkerRefreshCases() {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  const BG = read('extension', 'background', 'background.js');
  const POPUP = read('extension', 'popup', 'popup.js');
  const POPUP_HTML = read('extension', 'popup', 'popup.html');
  const cache = require(path.join(__dirname, '..', 'extension', 'shared', 'prompt-cache.js'));
  let count = 0;
  const must = (ok, msg) => { if (!ok) fail('worker refresh: ' + msg); count++; };

  must(JSON.stringify(cache.toRows([{ id: 'p1', name: 'Reply', content: 'Text', shortcut: null, review_status: null }])) ===
    '[{"id":"p1","title":"Reply","body":"Text","shortcut":"","review_status":"approved"}]',
    'a prompt row no longer maps to the menu row (name -> title, content -> body)');
  must(JSON.stringify(cache.toRows(null)) === '[]', 'no prompts must map to an empty list, not throw');
  must(cache.KEY === 'sb_prompts', 'the prompt list moved away from sb_prompts, which content.js reads');
  must(/review_status=neq\.archived/.test(cache.QUERY) && /order=updated_at\.desc/.test(cache.QUERY),
    'the worker must leave archived prompts out and keep the popup\'s order');
  ['id', 'name', 'content', 'shortcut', 'review_status'].forEach((col) => {
    must(new RegExp('select=[^&]*\\b' + col + '\\b').test(cache.QUERY), 'the worker no longer asks for the prompt column ' + col);
  });

  must(BG.includes("importScripts('../shared/prompt-cache.js');"), 'background.js no longer loads shared/prompt-cache.js');
  must(POPUP_HTML.includes('<script src="../shared/prompt-cache.js"></script>'), 'popup.html no longer loads shared/prompt-cache.js');
  must(/SBPromptCache\.toRows\(prompts\)/.test(POPUP), 'the popup no longer writes the prompt list through the shared mapping');

  // The worker's refresh, run for real against a stubbed read and store.
  const from = BG.indexOf('function refreshPromptCache(');
  const to = BG.indexOf('\n}\n', from) + 3;
  must(from !== -1 && to > from, 'cannot slice refreshPromptCache out of background.js');
  const run = (answer) => {
    const written = [];
    const box = {
      console: { warn: noop },
      SBPromptCache: cache,
      supaFetchAll: (table, qs) => { box.asked = { table, qs }; return answer; },
      chrome: { runtime: { lastError: null }, storage: { local: { set: (patch, cb) => { written.push(patch); if (cb) cb(); } } } },
    };
    vm.createContext(box);
    vm.runInContext(BG.slice(from, to) + '\nrefreshPromptCache();', box);
    return { box, written };
  };
  const good = run(Promise.resolve([{ id: 'p1', name: 'Reply', content: 'Text', shortcut: 'rep', review_status: 'approved' }]));
  const bad = run(Promise.reject(new Error('prompts answered HTTP 500')));
  return Promise.resolve().then(() => wait(20)).then(() => {
    must(good.box.asked.table === 'prompts' && good.box.asked.qs === cache.QUERY, 'the worker reads prompts with another query than the shared one');
    must(JSON.stringify(good.written) === '[{"sb_prompts":[{"id":"p1","title":"Reply","body":"Text","shortcut":"rep","review_status":"approved"}]}]',
      'the worker did not write the prompt list the menu reads: ' + JSON.stringify(good.written));
    must(bad.written.length === 0, 'a prompt read that failed must leave the stored list as it was, not empty it');

    must(/refreshPromptCache\(\);/.test(BG.slice(BG.indexOf('function initMenus('), BG.indexOf('function refreshPromptCache('))),
      'initMenus no longer refreshes the prompt list beside the snippets');
    must(/msg\.type === 'SB_LIBRARY_REFRESH'\) \{\s*maybeRefreshMenus\(TRIGGER_REFRESH_MIN_MS\);/.test(BG),
      'the worker no longer answers the page\'s request for a fresh library');
    const waitMs = /var TRIGGER_REFRESH_MIN_MS = (\d+);/.exec(BG);
    must(waitMs && Number(waitMs[1]) <= 5000, 'the wait between trigger refreshes must stay short (5 seconds at most)');
    return count;
  });
}

// "Insert automatically" (AUTO-INSERT-001). Off by default. When on, the trigger
// plus letters that leave one snippet standing inserts it after the wait the
// person chose, with the menu open the whole time; Esc, Backspace and the arrow
// keys stop it, Tab inserts at once. The user complaint this pins: "::tim" used
// to insert before the list could be read.
async function runAutoInsertCases() {
  sandbox.showCelebration = noop;   // the menu path celebrates directly
  const cfg = sandbox.triggerCfg;
  let n = 0;
  const WAIT = 1500;   // outlasts the 1 second wait below plus the menu's own delay

  function menuOpen(label) {
    if (!sandbox.triggerPickerEl) fail('auto-insert case "' + label + '": the menu is not open');
  }
  function nothingFired(label) {
    if (fired) fail('auto-insert case "' + label + '" -> inserted (span ' + fired.span + '), expected nothing');
  }
  function inserted(label, span, result) {
    if (!fired) fail('auto-insert case "' + label + '" -> nothing inserted');
    if (fired.span !== span || fired.result !== result) {
      fail('auto-insert case "' + label + '" -> span ' + fired.span + ' / field ' + JSON.stringify(fired.result) +
        ', expected span ' + span + ' / field ' + JSON.stringify(result));
    }
    if (sandbox.triggerPickerEl) fail('auto-insert case "' + label + '": the menu stayed open after inserting');
  }

  try {
    cfg.autoInsert = false;
    cfg.autoInsertSeconds = 1;
    await reset();
    await typeText('::neo', FAST);
    await wait(WAIT + SETTLE);
    nothingFired('off by default');
    menuOpen('off by default');
    n++;

    cfg.autoInsert = true;

    await reset();
    await typeText('::neo', FAST);
    await wait(500);
    nothingFired('menu is readable before the wait ends');
    menuOpen('menu is readable before the wait ends');
    await wait(WAIT);
    inserted('on, one match', 5, '');
    n++;

    await reset();
    setField('hola ');
    await typeText('::neo', FAST);
    await wait(500 + WAIT);
    inserted('text before the trigger stays', 5, 'hola ');
    n++;

    await reset();
    await typeText('::neo', 260);   // letters arrive through the open menu
    await wait(WAIT);
    inserted('slow typing', 5, '');
    n++;

    await reset();
    await typeText('::boo', FAST);   // an alternative query of NEO BOOKING
    await wait(500 + WAIT);
    inserted('alternative query', 5, '');
    n++;

    await reset();
    await typeText('::for', FAST);
    await wait(500 + WAIT);
    nothingFired('ambiguous prefix');
    menuOpen('ambiguous prefix');
    n++;

    await reset();
    await typeText('::ne', FAST);
    await wait(500 + WAIT);
    nothingFired('below the three-letter floor');
    n++;

    await reset();
    await typeText('::neo', FAST);
    await wait(400);
    menuOpen('Tab');
    key('Tab');
    await wait(60);
    inserted('Tab inserts at once', 5, '');
    n++;

    for (const [label, k] of [['Esc', 'Escape'], ['Backspace', 'Backspace'], ['arrow key', 'ArrowDown']]) {
      await reset();
      await typeText('::neo', FAST);
      await wait(400);
      menuOpen(label);
      key(k);
      await wait(WAIT);
      nothingFired(label + ' cancels the wait');
      n++;
    }

    cfg.autoInsertSeconds = 3;
    await reset();
    await typeText('::neo', FAST);
    await wait(2000);
    nothingFired('a 3 second wait is respected');
    menuOpen('a 3 second wait is respected');
    await wait(WAIT);
    inserted('a 3 second wait ends', 5, '');
    n++;

    for (const [value, want] of [[0, 1], [-4, 1], [999, 10], [2.6, 3], ['x', 2], [undefined, 2]]) {
      cfg.autoInsertSeconds = value;
      if (sandbox._autoInsertSeconds() !== want) {
        fail('auto-insert wait ' + JSON.stringify(value) + ' -> ' + sandbox._autoInsertSeconds() + ' seconds, expected ' + want);
      }
      n++;
    }
  } finally {
    cfg.autoInsert = false;
    cfg.autoInsertSeconds = 2;
  }
  return n;
}

// A {{name}} body opens the fill-in box first. The box takes focus, and on a
// contenteditable the selection over the trigger goes with it, so the trigger
// must stay put until the box closes: removed with the insert on confirm, left
// alone on cancel. Removing it before the box opened left the snippet nowhere
// to land and the trigger in the message.
async function runPlaceholderCases() {
  let box = null;
  sandbox.injectDynamicModal = function (vars, onConfirm, onCancel) {
    box = { vars: vars, onConfirm: onConfirm, onCancel: onCancel };
  };

  await reset();
  await typeText('::greet', FAST);
  await wait(SETTLE);
  if (!box) fail('placeholder case: the fill-in box did not open for "::greet"');
  if (fired) fail('placeholder case: the trigger was removed before the fill-in box closed');
  box.onConfirm({ name: 'Sam' });
  await wait(60);
  if (!fired || fired.id !== 'greet' || fired.span !== 7 || fired.result !== '<greet>') {
    fail('placeholder case: after the box closed -> ' + JSON.stringify(fired) +
      ', expected greet with the 7-character trigger removed');
  }

  box = null;
  await reset();
  await typeText('::greet', FAST);
  await wait(SETTLE);
  if (!box) fail('placeholder case: the fill-in box did not open for "::greet" (cancel)');
  box.onCancel();
  if (fired) fail('placeholder case: cancelling the fill-in box removed the trigger');
  if (sandbox.processing) fail('placeholder case: cancelling left the expansion locked');
  return 2;
}

// WhatsApp Web's editor (Lexical) claims a delete request and removes nothing
// when it is asked before its own focus handling has caught up: right after a
// chooser, a fill-in form or the Undo card closed, because the request runs
// inside that button's click. The snippet was then pasted in front of a trigger
// that never left. So the delete is checked and sent again once the editor has
// settled, and the paste only goes in after that.
//
// The editor is modelled by a one-text-node stand-in that claims every delete
// and applies it a few ms later, but only once it is "settled": at once for a
// healthy editor, only after a refocus for one that just lost focus.
async function runLexicalDeleteCases() {
  const TRIG = '::followup';
  const doc = sandbox.document;
  let selection = null;
  const makeRange = (node) => ({
    startContainer: node, startOffset: 0, endContainer: node, endOffset: 0,
    get collapsed() { return this.startContainer === this.endContainer && this.startOffset === this.endOffset; },
    setStart(n, o) { this.startContainer = n; this.startOffset = o; },
    setEnd(n, o) { this.endContainer = n; this.endOffset = o; },
    selectNodeContents(h) { this.startContainer = h.textNode; this.startOffset = 0; this.endContainer = h.textNode; this.endOffset = h.textNode.nodeValue.length; },
    toString() { return String(this.startContainer.nodeValue || '').slice(this.startOffset, this.endOffset); },
    // a plain contenteditable's trigger start is held across the delete
    cloneRange() {
      const c = makeRange(this.startContainer);
      c.setStart(this.startContainer, this.startOffset);
      c.setEnd(this.endContainer, this.endOffset);
      return c;
    },
    collapse(toStart) {
      if (toStart) { this.endContainer = this.startContainer; this.endOffset = this.startOffset; }
      else { this.startContainer = this.endContainer; this.startOffset = this.endOffset; }
    },
  });
  const saved = { createRange: doc.createRange, createTreeWalker: doc.createTreeWalker, execCommand: doc.execCommand };
  const savedGlobals = ['NodeFilter', 'StaticRange', 'InputEvent', 'ClipboardEvent', 'DataTransfer', 'getSelection', 'console']
    .map((k) => [k, sandbox[k]]);
  let errors = 0, execCalls = 0;
  sandbox.NodeFilter = { SHOW_TEXT: 4 };
  sandbox.StaticRange = function (init) { Object.assign(this, init); };
  sandbox.InputEvent = function (type, init) { this.type = type; Object.assign(this, init); };
  sandbox.ClipboardEvent = function (type, init) { this.type = type; Object.assign(this, init); };
  sandbox.DataTransfer = function () { const d = {}; this.setData = (k, v) => { d[k] = v; }; this.getData = (k) => d[k]; };
  sandbox.getSelection = () => selection;
  sandbox.console = Object.assign({}, console, { error: () => { errors++; } });
  doc.createRange = () => makeRange(selection && selection.owner);
  doc.createTreeWalker = (h) => { let done = false; return { nextNode: () => (done ? null : ((done = true), h.textNode)) }; };
  doc.execCommand = () => { execCalls++; return false; };

  // behaviour: 'healthy' honours every delete; 'afterFocusLoss' ignores them
  // until the editor has been refocused and left to settle; 'never' ignores all.
  function field(behaviour, lexical) {
    const textNode = { nodeType: 3, nodeValue: 'Hi ' + TRIG };
    // The editor's model changes at once; the DOM follows a few ms later. A paste
    // therefore sees the deletion even though textContent has not changed yet.
    const s = { settled: behaviour === 'healthy', focusCalls: 0, deletes: 0, pastedOver: null, pastes: 0, model: 'Hi ' + TRIG };
    const reconcile = () => setTimeout(() => { textNode.nodeValue = s.model; }, 5);
    const host = {
      nodeType: 1, textNode,
      get textContent() { return textNode.nodeValue; },
      getAttribute: (n) => (n === 'contenteditable' || (lexical && n === 'data-lexical-editor') ? 'true' : null),
      contains: () => true,
      focus() { s.focusCalls++; if (behaviour === 'afterFocusLoss') setTimeout(() => { s.settled = true; }, 60); },
      dispatchEvent(ev) {
        if (ev.type === 'beforeinput') {
          s.deletes++;
          const tr = ev.targetRanges[0];
          if (s.settled) {
            s.model = s.model.slice(0, tr.startOffset) + s.model.slice(tr.endOffset);
            reconcile();
          }
          return false;   // claimed, applied or not
        }
        if (ev.type === 'paste') {
          s.pastes++;
          s.pastedOver = s.model;   // what the field held when the body went in
          s.model += ev.clipboardData.getData('text/plain');
          reconcile();
          return false;
        }
        return true;
      },
    };
    // The trigger is selected, as deleteChars leaves it.
    selection = {
      owner: textNode, rangeCount: 1,
      getRangeAt() { return this.range; },
      removeAllRanges() { this.rangeCount = 0; }, addRange(r) { this.range = r; this.rangeCount = 1; },
    };
    selection.range = makeRange(textNode);
    selection.range.setStart(textNode, 3);
    selection.range.setEnd(textNode, 3 + TRIG.length);
    return { host, s, textNode };
  }

  try {
    let n = 0;

    let f = field('healthy', true);
    sandbox._cePasteInsert(f.host, 'BODY');
    await wait(250);
    if (f.s.pastedOver !== 'Hi ' || f.s.model !== 'Hi BODY') {
      fail('lexical case: a healthy editor -> pasted over ' + JSON.stringify(f.s.pastedOver) +
        ', field ' + JSON.stringify(f.s.model) + ', expected the trigger gone before the body and "Hi BODY"');
    }
    if (f.s.deletes !== 1 || f.s.focusCalls !== 0) {
      fail('lexical case: a healthy editor was asked ' + f.s.deletes + ' times and refocused ' + f.s.focusCalls +
        ' times, expected one delete and no refocus');
    }
    n++;

    f = field('afterFocusLoss', true);
    sandbox._cePasteInsert(f.host, 'BODY');
    await wait(450);
    if (f.s.pastedOver !== 'Hi ') {
      fail('lexical case: the editor ignored the first delete -> the body was pasted over ' + JSON.stringify(f.s.pastedOver) +
        ', expected the trigger gone first.\n' +
        '  A claimed delete is not a delete: the snippet lands in front of a trigger that never left.');
    }
    if (f.s.model !== 'Hi BODY' || f.s.deletes !== 2 || f.s.focusCalls !== 1) {
      fail('lexical case: after a focus loss -> field ' + JSON.stringify(f.s.model) + ', ' + f.s.deletes +
        ' deletes, ' + f.s.focusCalls + ' refocuses; expected "Hi BODY", 2 deletes, 1 refocus');
    }
    n++;

    f = field('never', true);
    sandbox._cePasteInsert(f.host, 'BODY');
    await wait(700);
    if (f.s.pastes !== 1 || f.s.deletes !== 2) {
      fail('lexical case: an editor that never deletes -> ' + f.s.pastes + ' pastes, ' + f.s.deletes +
        ' deletes; expected the body still to go in once after one retry, never hung');
    }
    if (errors < 1) fail('lexical case: an editor that ignored the delete twice was not reported');
    n++;

    // Every other editor keeps the browser edit and a synchronous paste.
    execCalls = 0;
    f = field('healthy', false);
    sandbox._cePasteInsert(f.host, 'BODY');
    if (f.s.pastes !== 1 || execCalls !== 1 || f.s.deletes !== 0) {
      fail('lexical case: a plain contenteditable -> ' + f.s.pastes + ' pastes, ' + execCalls + ' execCommand edits, ' +
        f.s.deletes + ' editor deletes; expected the browser edit and a paste, all before it returns');
    }
    n++;
    return n;
  } finally {
    Object.assign(doc, saved);
    savedGlobals.forEach(([k, v]) => { sandbox[k] = v; });
  }
}

// Filling a form moves focus away from its destination. All entry points
// must restore the original rich-editor selection before the edit, while an
// invalid form must leave the destination and the modal untouched.
function runFormInsertionCases() {
  const names = ['overlayForm','getVals','closeOverlay','_ceRestoreTriggerRange',
    '_ceMeasureBefore','insertText','captureFieldState','_markSyncInserted',
    'showCelebration','overlayEl','SBFillFormUI','overlayCaretCO',
    'overlaySelectionStartCO','overlayTriggerLen'];
  const saved = names.map(k => [k, sandbox[k]]);
  try {
    const events = [];
    const host = {isContentEditable:true};
    sandbox.overlayForm = () => ({preview:'Filled message', errors:[]});
    sandbox.getVals = () => ({ANSWER:'yes'});
    sandbox.closeOverlay = () => events.push('close');
    sandbox._ceRestoreTriggerRange = (el,end,length) => {events.push(['restore',end,length]);return true;};
    sandbox._ceMeasureBefore = () => ({});
    sandbox.insertText = (el,text) => events.push(['insert',text]);
    sandbox.captureFieldState = () => ({});
    sandbox._markSyncInserted = () => {};
    sandbox.showCelebration = () => {};
    let count = 0;
    for (const [start,end,trigger,length] of [[0,0,0,0],[5,5,0,0],[5,9,0,4],[0,7,7,7]]) {
      events.length=0;
      sandbox.overlaySelectionStartCO=start; sandbox.overlayCaretCO=end; sandbox.overlayTriggerLen=trigger;
      sandbox.doInsert(host,{body:'',review_status:'approved'});
      const want = ['close',['restore',end,length],['insert','Filled message']];
      if (JSON.stringify(events)!==JSON.stringify(want)) fail('filled form did not restore its destination: '+JSON.stringify(events));
      count++;
    }
    events.length=0;
    sandbox.overlayForm=()=>({preview:'Incomplete',errors:[{key:'AMOUNT'}]});
    sandbox.overlayEl={dataset:{},querySelectorAll:()=>[],querySelector:()=>({})};
    sandbox.SBFillFormUI={validate:()=>events.push('validate')};
    sandbox.doInsert(host,{body:''});
    if (JSON.stringify(events)!=='["validate"]') fail('invalid filled form reached insertion');
    return count+1;
  } finally { saved.forEach(([k,v])=>{sandbox[k]=v;}); }
}

(async () => {
  for (const c of cases) {
    await reset();
    await c.run();
    if (!c.expect) {
      if (fired) {
        fail('case "' + c.name + '" -> expanded ' + fired.id + ' (span ' + fired.span + '), expected nothing');
      }
      continue;
    }
    if (!fired) fail('case "' + c.name + '" -> nothing expanded, expected ' + c.expect.id);
    if (fired.id !== c.expect.id) {
      fail('case "' + c.name + '" -> expanded ' + fired.id + ', expected ' + c.expect.id);
    }
    if (fired.span !== c.expect.span) {
      fail('case "' + c.name + '" -> delete span ' + fired.span + ', expected ' + c.expect.span +
        '\n  A wrong span leaves part of the trigger in the field, or eats the message before it.');
    }
    if (fired.result !== c.expect.result) {
      fail('case "' + c.name + '" -> field ' + JSON.stringify(fired.result) +
        ', expected ' + JSON.stringify(c.expect.result));
    }
  }
  runSpanCases();
  // selectTriggerItem feeds the picker's own tally into the same deletion, so it
  // must correct it too — an untested call site is how the residue came back.
  const pickerFn = CONTENT_SRC.slice(CONTENT_SRC.indexOf('function selectTriggerItem('));
  if (!pickerFn.slice(0, pickerFn.indexOf('\nfunction ')).includes('_fieldTriggerSpan(el, dLen)')) {
    fail('selectTriggerItem no longer corrects the picker delete span against the field.\n' +
      '  Confirming from the suggestion menu would clip the wrong characters and\n' +
      '  leave part of the trigger in the message.');
  }
  const extra = runFormInsertionCases() + (await runPickerEnterCase()) + (await runAutoInsertCases()) + (await runPlaceholderCases()) + (await runLexicalDeleteCases()) +
    (await runLibraryRefreshCases()) + (await runWorkerRefreshCases());
  console.log('OK Trigger expansion passed all ' + (cases.length + spanCases.length + 1 + extra) + ' cases');
})();
