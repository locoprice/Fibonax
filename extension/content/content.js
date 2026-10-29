// ── FIBONAX CONTENT SCRIPT v2.62.12 ───────────────────────────
// Configurable dual triggers + expansion summary + analytics event log
// v2.29.0: lang-modal expansion fix — defer trigger deletion until after
//          language pick (modal focus was wiping the CE selection set by
//          deleteChars, leaving the literal ::shortcut in the field)
// v2.57.0: """ prompt picker merges built-in Base Prompts with the dashboard
//          Prompt List (storage.local.sb_prompts), separated by a "My prompt
//          base" divider; checkBuf no longer gated on snippets.length.

// ── ANALYTICS-001: fire-and-forget per-trigger event ──────────────
function logEvent(snip, fieldsFilled) {
  if (!snip) return;
  try {
    chrome.runtime.sendMessage({
      type: 'log_event',
      payload: {
        snippet_id: snip.id || null,
        user_id: snip.user_id || null,
        shortcut: snip.shortcut || '',
        lang: snip.lang || null,
        fields_filled: fieldsFilled || 0
      }
    });
  } catch(e) { /* extension context lost during reload, silent */ }
  touchLastUsed(snip);
}

// ── INACTIVE-001: local mirror of "when was this last used" ───────
//
// The server log above is the source of truth, and it is also fire and forget:
// it can fail offline, and snippet_last_used() is only re-read when the popup
// loads. So every expansion also stamps a local copy, which is what stops the
// notice claiming a snippet is unused seconds after it was expanded.
//
// Language variants share one notice, so the stamp lands on the whole group.
// Expanding the Spanish body is using the snippet, and the popup lists the
// group under its master id. Without this, three of four variants would look
// abandoned for ever.
//
// chrome.storage.local only, and the shared module owns the shape. Silent on
// failure by design: a storage write must never cost the user their expansion.
function touchLastUsed(snip) {
  var SBI = window.SBInactivity;
  if (!SBI || !snip || !snip.id) return;
  var ids = [String(snip.id)];
  if (snip.lang_group_id) ids.push(String(snip.lang_group_id));
  try {
    chrome.storage.local.get(SBI.STORAGE_KEY, function(d) {
      if (chrome.runtime.lastError) return;
      var state = SBI.normalizeState(d && d[SBI.STORAGE_KEY]);
      var now = Date.now();
      ids.forEach(function(id) { state = SBI.recordUse(state, id, now); });
      var patch = {};
      patch[SBI.STORAGE_KEY] = state;
      try { chrome.storage.local.set(patch); } catch(e) {}
    });
  } catch(e) { /* extension context lost during reload — silent */ }
}

// ── FORMULA ENGINE ────────────────────────────────────────────────
// Canonical engine lives in extension/formula-engine.js, loaded by
// manifest.json's content_scripts BEFORE this file. Both run in the same
// content-script isolated world, so the UMD module's window.SBFormulaEngine
// global is available here. These aliases bind the call sites below to that
// single source of truth — no more hand-synced inline copy (v2.63.10).
var _SBFE = window.SBFormulaEngine;
var resolveBody        = _SBFE.resolveBody;
var extractFields      = _SBFE.extractFields;
var applyButtonCode    = _SBFE.applyButtonCode;
var parsePlaceholders  = _SBFE.parsePlaceholders;
var interpolateSnippet = _SBFE.interpolateSnippet;

// What the fill form IS — which fields, of what kind, the prose around each,
// its starting value — is decided by extension/shared/fill-form.js, loaded by
// manifest.json before this file and shared with the popup, the composer and
// the phone. The aliases that used to build that here (fieldContext,
// buildFormFieldCfg, formMenuPicks, extractButtons, sbFormatDate) went with it.
var _SBFF = window.SBFillForm;

// ── DEFAULT SNIPPETS ──────────────────────────────────
// Intentionally empty, and it must stay that way. Anything listed here ships
// inside the extension bundle, so a signed-out install renders it in the
// picker and every installer can read it. Snippet content arrives from
// Supabase after sign-in: popup.js writes the chrome.storage.local cache that
// this file reads. An empty library is the correct signed-out state.
var DEFAULT_SNIPPETS = [];

// ── STATE ──────────────────────────────────────────────────────────
var snippets = DEFAULT_SNIPPETS.slice();
// Mirrors chrome.storage.local 'sb_session' so the picker can tell an empty
// library apart from a signed-out one and say which it is.
var hasSession = false;
var trigger  = '::';
var triggerCfg = { snippetTrigger: '::', promptTrigger: '"""', snippetActivationKey: 'Tab', promptActivationKey: 'Tab', autoCapitalize: true, autoInsert: false, autoInsertSeconds: 2 };
var lastInputTime = 0; // debounce: prevents keydown + input event double-fire on desktop
var isPasting = false; // guards against paste events feeding the trigger buffer

// ── PROMPT TEMPLATES ──────────────────────────────────────────────
// The """ picker draws from two merged sources:
//   - BASE_PROMPTS: built-in defaults ("Base Prompts"), always available even
//     offline / before sign-in. Future Notion "Base Prompts" sync target.
//   - userPrompts: the user's dashboard "Prompt List", synced from
//     public.prompts -> chrome.storage.local.sb_prompts by the popup
//     (mirrors how snippets reach the content script).
// promptTemplates() lists Base Prompts first, then the dashboard Prompt List; a
// dashboard prompt whose title matches a base one overrides it in place.
var BASE_PROMPTS = [
  { id: 'formal', title: 'Formal tone', body: 'Please rewrite in a formal, professional tone:\n' },
  { id: 'casual', title: 'Casual tone', body: 'Rewrite this in a friendly, casual tone:\n' },
  { id: 'translate', title: 'Translate', body: 'Translate the following text to {language}:\n' },
  { id: 'summarize', title: 'Summarize', body: 'Summarize the following in 2-3 sentences:\n' },
  { id: 'expand', title: 'Expand / elaborate', body: 'Expand on the following with more detail:\n' },
  { id: 'bullet', title: 'Convert to bullets', body: '\u2022 ' }
];
var userPrompts = []; // dashboard Prompt List (chrome.storage.local.sb_prompts)

// Each item is tagged with _group ('base' | 'list') so the picker can draw a
// single divider at the base->dashboard boundary. Items are shallow copies so
// BASE_PROMPTS / userPrompts are never mutated.
function promptTemplates() {
  var merged = BASE_PROMPTS.map(function(p) { return Object.assign({}, p, { _group: 'base' }); });
  if (!userPrompts.length) return merged;
  var idxByTitle = {};
  for (var i = 0; i < merged.length; i++) {
    idxByTitle[(merged[i].title || '').toLowerCase()] = i;
  }
  for (var j = 0; j < userPrompts.length; j++) {
    var p = userPrompts[j];
    var key = (p.title || '').toLowerCase();
    if (key && idxByTitle[key] !== undefined) {
      merged[idxByTitle[key]] = Object.assign({}, p, { _group: 'base' }); // override keeps the base slot
    } else {
      merged.push(Object.assign({}, p, { _group: 'list' }));
    }
  }
  return merged;
}

// ── INTERACTIVE STEPS ─────────────────────────────────────────────
// The popup's Prompts tab switch, kept current by the storage listener below so
// an insert never waits on a storage read. shared/interactive-steps.js, loaded
// by manifest.json before this file, owns the key and the block.
var interactiveStepsOn = false;

// What a picked prompt inserts. A saved prompt gets the Interactive Steps block
// when the switch is on. A built-in Base Prompt is a one-line opener such as
// "Summarize the following in 2-3 sentences:" and always goes in as written.
function _promptInsertText(item) {
  var body = item.body || '';
  for (var i = 0; i < BASE_PROMPTS.length; i++) {
    if (BASE_PROMPTS[i].id === item.id) return body;
  }
  return SBInteractiveSteps.apply(body, interactiveStepsOn);
}

// ── A BRAIN INSIDE A PROMPT ───────────────────────────────────────
// A prompt whose Context block holds a `{brain: …}` token (shared/memory-pack.js)
// is finished by the service worker, which reads the Brain and puts its items
// where the token sits, so the prompt carries the Brain as it is now. All the
// prompts that carry one are asked for in one message the moment the prompt
// menu opens, and the answers are kept for a minute, so typing """ again and
// again (a code docstring) reads the Brains once. A pick made before its
// answer waits with the menu open (selectTriggerItem, _holdPromptPick) and
// inserts once it arrives, while the field's selection is still live. When the
// worker cannot answer (no session, no connection), the prompt still goes in,
// with one visible line in place of each Brain rather than a hole nobody
// noticed; a failed answer is kept only until the menu opens again, which asks
// afresh.
var PROMPT_BRAIN_FRESH_MS = 60000;
var _promptBrainCache = {};    // prompt text -> { text: finished text, at: time, failed: bool }
var _promptBrainWaiting = {};  // prompt text -> callbacks waiting for it
var _promptBrainInFlight = {}; // prompt text -> true while asked

function _promptHasBrain(item) {
  return typeof SBMemoryPack !== 'undefined' && SBMemoryPack.promptBrainRefs(item.body || '').length > 0;
}

function _promptBrainCached(text) {
  return Object.prototype.hasOwnProperty.call(_promptBrainCache, text);
}

// Asks the worker, in one message, for every text not kept and not already asked.
function _askPromptBrains(texts) {
  var todo = [];
  for (var i = 0; i < texts.length; i++) {
    var t = texts[i];
    if (!_promptBrainCached(t) && !_promptBrainInFlight[t] && todo.indexOf(t) === -1) todo.push(t);
  }
  if (!todo.length) return;
  todo.forEach(function(t) { _promptBrainInFlight[t] = true; });
  var done = false;
  function settle(results, failed) {
    if (done) return;
    done = true;
    var now = Date.now();
    todo.forEach(function(t, j) {
      delete _promptBrainInFlight[t];
      _promptBrainCache[t] = { text: results[j], at: now, failed: failed };
      var waiting = _promptBrainWaiting[t] || [];
      delete _promptBrainWaiting[t];
      for (var k = 0; k < waiting.length; k++) waiting[k](results[j]);
    });
  }
  function withoutBrains() {
    settle(todo.map(function(t) { return SBMemoryPack.resolvePromptBrains(t, {}, 'failed'); }), true);
  }
  try {
    chrome.runtime.sendMessage({ type: 'prompt_texts', texts: todo }, function(res) {
      var ok = !chrome.runtime.lastError && res && res.ok && Array.isArray(res.texts) && res.texts.length === todo.length;
      if (!ok) { withoutBrains(); return; }
      settle(res.texts, false);
    });
  } catch(e) {
    withoutBrains();
  }
}

// The finished text of `item`, handed to `cb`: at once when it is kept,
// otherwise when the worker answers.
function _whenPromptBrains(item, cb) {
  var t = item.body || '';
  if (_promptBrainCached(t)) { cb(_promptBrainCache[t].text); return; }
  (_promptBrainWaiting[t] = _promptBrainWaiting[t] || []).push(cb);
  _askPromptBrains([t]);
}

// Asked when the prompt menu opens. Answers older than a minute, and failed
// ones, are dropped, so a Brain changed since, or unreachable last time, is
// read again.
function _prefetchPromptBrains() {
  var now = Date.now();
  Object.keys(_promptBrainCache).forEach(function(t) {
    var kept = _promptBrainCache[t];
    if (kept.failed || now - kept.at > PROMPT_BRAIN_FRESH_MS) delete _promptBrainCache[t];
  });
  var texts = [];
  var list = promptTemplates();
  for (var i = 0; i < list.length; i++) {
    if (_promptHasBrain(list[i])) texts.push(list[i].body || '');
  }
  _askPromptBrains(texts);
}

// The text to insert, handed to `cb`: a prompt without a Brain at once, as
// before; one with a Brain as the worker finished it, then the Interactive
// Steps block in front when the switch is on.
function _promptText(item, cb) {
  if (!_promptHasBrain(item)) { cb(_promptInsertText(item)); return; }
  _whenPromptBrains(item, function(text) {
    cb(SBInteractiveSteps.apply(text, interactiveStepsOn));
  });
}

// A pick of a prompt whose Brain has not arrived yet. The menu stays open and
// says so; the pick goes through once the answer is in, if the person has not
// typed, moved on or closed the menu meanwhile. Nothing is deleted or inserted
// until then, so the prompt can never land after words typed in the gap.
var _heldPromptPick = null;

function _holdPromptPick(item) {
  var held = { id: item.id, query: triggerPickerQuery, target: triggerPickerTarget };
  _heldPromptPick = held;
  _setPickerHint('Adding your Brain\u2026');
  _whenPromptBrains(item, function() {
    if (_heldPromptPick !== held) return;
    _heldPromptPick = null;
    if (!triggerPickerEl || triggerPickerTarget !== held.target || triggerPickerQuery !== held.query) return;
    for (var i = 0; i < triggerPickerFiltered.length; i++) {
      if (triggerPickerFiltered[i].id === held.id) { selectTriggerItem(i); return; }
    }
  });
}

// ── DEFAULT LANGUAGE PREFERENCE ────────────────────────────────────
var defaultLang = 'EN';

// Resolve which variant to use for an insertion, with fallback chain.
// variants: { EN: snip, ES: snip, ... }, preferred: 'IT', etc.
function resolveVariant(variants, preferred) {
  if (!variants) return null;
  var order = [preferred, 'EN', 'ES', 'IT', 'FR'];
  for (var i = 0; i < order.length; i++) {
    var v = variants[order[i]];
    if (v && v.body && v.body.trim()) return v;
  }
  return null;
}

// ── LOAD FROM STORAGE ──────────────────────────────────────────────
// Everything lives in chrome.storage.local. Snippets because the array exceeds
// chrome.storage.sync's 8KB per-item limit (silent failure otherwise); the small
// settings because storage.sync roams to every Chrome signed into the same
// Google account and nothing here needs to. Cross-device sync of both the
// library and the trigger settings goes through Supabase.
try {
  chrome.storage.local.get(['trigger','triggerCfg','sb_default_lang'], function(data) {
    try {
      if (data && data.trigger) trigger = data.trigger;
      if (data && data.sb_default_lang) defaultLang = data.sb_default_lang;
      if (data && data.triggerCfg) {
        if (data.triggerCfg.snippetTrigger) triggerCfg.snippetTrigger = data.triggerCfg.snippetTrigger;
        if (data.triggerCfg.promptTrigger) triggerCfg.promptTrigger = data.triggerCfg.promptTrigger;
        if (data.triggerCfg.snippetActivationKey) triggerCfg.snippetActivationKey = data.triggerCfg.snippetActivationKey;
        if (data.triggerCfg.promptActivationKey) triggerCfg.promptActivationKey = data.triggerCfg.promptActivationKey;
        if (typeof data.triggerCfg.autoCapitalize === 'boolean') {
          triggerCfg.autoCapitalize = data.triggerCfg.autoCapitalize;
        }
        _readAutoInsertCfg(data.triggerCfg);
      }
    } catch(e) {}
  });

  chrome.storage.local.get('snippets', function(data) {
    try {
      // The local cache is the only snippet source. A chrome.storage.sync copy
      // is never adopted: sync roams across every Chrome signed into the same
      // Google account, so it carried one account's snippets to another.
      // background.js drops the legacy key on update.
      snippets = (data && Array.isArray(data.snippets)) ? data.snippets : [];
    } catch(e) {}
  });

  chrome.storage.local.get('sb_session', function(data) {
    try { hasSession = !!(data && data.sb_session && data.sb_session.user_id); } catch(e) {}
  });

  chrome.storage.local.get('sb_prompts', function(data) {
    try {
      if (data && Array.isArray(data.sb_prompts)) userPrompts = data.sb_prompts;
    } catch(e) {}
  });

  chrome.storage.onChanged.addListener(function(changes, areaName) {
    try {
      // Every key this listener cares about now fires from local.
      // A cleared cache (sign-out) arrives with no newValue and must empty the
      // in-memory list, otherwise the picker keeps serving the signed-out user
      // the library from the session that just ended.
      if (changes.snippets) snippets = Array.isArray(changes.snippets.newValue) ? changes.snippets.newValue : [];
      if (changes.sb_session) hasSession = !!(changes.sb_session.newValue && changes.sb_session.newValue.user_id);
      if (changes.sb_prompts && Array.isArray(changes.sb_prompts.newValue)) userPrompts = changes.sb_prompts.newValue;
      if (changes.trigger  && changes.trigger.newValue)  trigger  = changes.trigger.newValue;
      if (changes.sb_default_lang && changes.sb_default_lang.newValue) defaultLang = changes.sb_default_lang.newValue;
      if (changes.triggerCfg && changes.triggerCfg.newValue) {
        var nc = changes.triggerCfg.newValue;
        if (nc.snippetTrigger) triggerCfg.snippetTrigger = nc.snippetTrigger;
        if (nc.promptTrigger) triggerCfg.promptTrigger = nc.promptTrigger;
        if (nc.snippetActivationKey) triggerCfg.snippetActivationKey = nc.snippetActivationKey;
        if (nc.promptActivationKey) triggerCfg.promptActivationKey = nc.promptActivationKey;
        if (typeof nc.autoCapitalize === 'boolean') {
          triggerCfg.autoCapitalize = nc.autoCapitalize;
        }
        _readAutoInsertCfg(nc);
        if (!triggerCfg.autoInsert) _cancelPickerAuto();
      }
      if (changes[SBInteractiveSteps.KEY]) interactiveStepsOn = SBInteractiveSteps.isOn(changes[SBInteractiveSteps.KEY].newValue);
    } catch(e) {}
  });

  SBInteractiveSteps.load(function(on) { interactiveStepsOn = on; });
} catch(e) {
  console.error('[Fibonax] Storage unavailable, using defaults');
}

// ── KEYSTROKE BUFFER ───────────────────────────────────────────────
var buf     = '';
var MAX_BUF = 40;
var activeEl = null;
var processing = false;
var triggerPending = false;
var triggerPendingMode = null;   // 'snippet' | 'prompt'
var triggerAffix = '';
var triggerDebounceTimer = null;
var TRIGGER_MIN_CHARS = 1;     // show suggestions after ::x (non-destructive, so safe)
var TRIGGER_DEBOUNCE_MS = 120; // short — the picker never touches the field anymore

// ── MATCH SETTLE WINDOW (v2.148.1) ────────────────────────────────
// A shortcut that is also the start of a longer word used to fire the instant
// it matched: typing "::neobooking" expanded "::neob" at the sixth character
// and left "ooking" stranded in the field — and on contenteditable hosts those
// stray characters landed inside the selection the expansion had set, so the
// delete span slid onto the message the user had already written.
//
// A match is now ARMED rather than expanded. It fires when typing settles, and
// one more letter drops it so a longer trigger gets its turn ("::forms" now
// reaches ::forms instead of ::form). Whitespace, Tab and Enter end the word,
// so they expand straight away — nobody waits who does not want to.
var armedMatch = null;   // { snip, expectedLen, el, bufLen }
var armedTimer = null;
var MATCH_SETTLE_MS = 350;

function _cancelArmed() {
  if (armedTimer) { clearTimeout(armedTimer); armedTimer = null; }
  armedMatch = null;
}

function _armMatch(snip, expectedLen, el) {
  _cancelArmed();
  // The matched character never reached the pending-picker bookkeeping — the
  // match branch returns before it. Count it here, so that if the match is
  // dropped a moment later the picker's delete span still covers every
  // character the user typed (one short leaves a stray ":" behind).
  if (triggerPending) triggerAffix += buf.slice(-1);
  // The picker must not open over an armed match: its key handler swallows
  // keystrokes, and those are exactly what decides whether the match survives.
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
  armedMatch = { snip: snip, expectedLen: expectedLen, el: el, bufLen: buf.length };
  armedTimer = setTimeout(function() { _fireArmed(0); }, MATCH_SETTLE_MS);
}

// trailing: characters typed after the trigger that the expansion must remove
// along with it — the space that confirmed the match. 0 for the settle timer
// and for Tab/Enter, which never reach the field.
function _fireArmed(trailing) {
  var a = armedMatch;
  _cancelArmed();
  if (!a || processing) return;
  buf = '';
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
  var span = a.expectedLen + (trailing || 0);
  var variantsMap = _findLangVariants(a.snip);
  if (Object.keys(variantsMap).length > 1) {
    // Do NOT pre-delete the trigger here. For contenteditable hosts,
    // deleteChars only SETS a non-collapsed selection (it relies on the
    // immediate next insertText to consume it). Opening the modal steals
    // focus and destroys that selection — so the trigger text survives.
    // Instead, defer deletion to handleMatch (called when the user picks
    // a language) where deleteChars + insertText fire atomically.
    processing = true;
    injectLangModal(variantsMap, a.el, span);
  } else {
    handleMatch(a.el, a.snip, span);
  }
}

function addKey(k) {
  if (k.length !== 1) return;
  buf += k;
  if (buf.length > MAX_BUF) buf = buf.slice(buf.length - MAX_BUF);
}

function checkBuf() {
  // Not gated on snippets.length: the """ prompt picker (Base Prompts +
  // dashboard Prompt List) must open even when the user has no snippets. The
  // snippet-matching loop below simply no-ops on an empty list.
  if (processing) return;

  // Strip invisible artifacts that Gmail's rich-text contenteditable can
  // splice into the keystroke stream (smart-compose, autocorrect, paste
  // normalization). ZWSP/ZWNJ/ZWJ/BOM/soft-hyphen are removed; NBSP is folded
  // to a regular space so the trigger sequence isn't broken by an invisible
  // char between the two colons. \uXXXX escapes — invisible literal chars in
  // regex are fragile across editors and diffs. Curly "smart quotes" are
  // folded to straight quotes so the prompt trigger (""") still matches in
  // editors that auto-substitute quotes (Word, macOS smart-quotes, etc.).
  var sanitized = buf.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').replace(/\u00A0/g, ' ').replace(/[\u201C\u201D]/g, '"');
  if (sanitized !== buf) buf = sanitized;

  // A match is armed and waiting out the settle window. Another letter means
  // the user is still typing a longer word, so drop it and let the buffer keep
  // growing. Whitespace ends the word: expand now, and take the terminator with
  // the trigger: leaving it behind would shift the delete span by one and
  // strand a ":" in the field.
  if (armedMatch) {
    var extra = buf.length - armedMatch.bufLen;
    if (extra > 0) {
      if (/^\s+$/.test(buf.slice(armedMatch.bufLen))) { _fireArmed(extra); return; }
      _cancelArmed();
    }
  }

  // Snippet matching contract (v2.24.0):
  //   Every snippet expansion REQUIRES the user to type the configured
  //   snippet trigger (default "::") immediately before the shortcut.
  //   Bare-keyword (implicit) matching was removed in v2.23.2 — typing a
  //   shortcut as part of normal prose ("the price is...") MUST NOT fire.
  //   Two storage shapes are tolerated:
  //
  //     - sc stored with the prefix already baked in ("::time")  -> the
  //       expected typed sequence is just sc itself ("::time").
  //     - sc stored bare ("time")                                -> the
  //       expected typed sequence is trigger + sc ("::time").
  //
  //   In both cases the matched length is exactly what was typed, so we
  //   never delete more or fewer characters than the user produced.
  //
  //   A match does not expand on the spot — it is armed and settles first
  //   (see _armMatch), because a shortcut can be the opening of a longer word
  //   the user is still typing.
  //
  //   Multi-language (v2.26.0): _findLangVariants() detects sibling
  //   translations via lang_group_id (when set) or shortcut-base heuristic
  //   (strips trailing EN/ES/IT/FR/MULTI). Applied in BOTH checkBuf() and
  //   selectTriggerItem() so the modal fires regardless of how the user
  //   selects the snippet.
  var snippetTrigger = (triggerCfg && triggerCfg.snippetTrigger) || '::';
  for (var i = 0; i < snippets.length; i++) {
    var sc = snippets[i].shortcut || '';
    if (!sc) continue;
    var expected = sc.indexOf(snippetTrigger) === 0 ? sc : snippetTrigger + sc;
    if (expected.length <= buf.length && buf.slice(-expected.length).toLowerCase() === expected.toLowerCase()) {
      _armMatch(snippets[i], expected.length, activeEl);
      return;
    }
    // Also match against alternative_queries (ALTERNATIVE-QUERIES-001).
    // Normalization: each query is lowercased and trimmed at save time; the
    // comparison is case-insensitive to handle legacy values.
    var altQueries = Array.isArray(snippets[i].alternative_queries) ? snippets[i].alternative_queries : [];
    for (var j = 0; j < altQueries.length; j++) {
      var aq = (altQueries[j] || '').trim();
      if (!aq) continue;
      var aqExpected = aq.indexOf(snippetTrigger) === 0 ? aq : snippetTrigger + aq;
      if (aqExpected.length <= buf.length && buf.slice(-aqExpected.length).toLowerCase() === aqExpected.toLowerCase()) {
        _armMatch(snippets[i], aqExpected.length, activeEl);
        return;
      }
    }
  }

  // A prefix that is not a whole shortcut ("::neo") never expands from here: it
  // opens the suggestion menu like any other partial trigger. Inserting it on
  // its own is the opt-in "Insert automatically" setting, and it runs from the
  // menu (see _armPickerAuto) so the list is on screen for the whole wait. Until
  // v3.76.0 this branch armed the unique match and inserted it 350ms later,
  // before anyone could read the menu.

  // Check configurable snippet trigger (e.g. ::) — debounced pending state
  var snippetSeq = triggerCfg.snippetTrigger || '::';
  if (!triggerPending) {
    // Detect trigger sequence — enter pending state instead of showing picker
    if (buf.length >= snippetSeq.length && buf.slice(-snippetSeq.length) === snippetSeq) {
      if (buf.length > snippetSeq.length && buf[buf.length - snippetSeq.length - 1] === snippetSeq[0]) return;
      triggerPending = true;
      triggerPendingMode = 'snippet';
      triggerAffix = '';
      if (triggerDebounceTimer) clearTimeout(triggerDebounceTimer);
      return;
    }
    // Prompt trigger (e.g. """): unlike snippets there is no shortcut to type,
    // so the bare trigger opens the picker immediately (slash-command style)
    // showing all prompts; the picker's own key handler filters as the user
    // types. The snippet trigger keeps its debounced pending behaviour because
    // snippets expand via a full ::shortcut, not a menu.
    var promptSeq = triggerCfg.promptTrigger || '"""';
    if (buf.length >= promptSeq.length && buf.slice(-promptSeq.length) === promptSeq) {
      if (buf.length > promptSeq.length && buf[buf.length - promptSeq.length - 1] === promptSeq[0]) return;
      if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
      buf = '';
      showTriggerPicker(activeEl, 'prompt', promptSeq.length, '');
      return;
    }
  } else {
    // We are in pending state — accumulate chars after the trigger
    var lastChar = buf.slice(-1);
    // If user types space or newline, cancel pending trigger
    if (lastChar === ' ' || lastChar === '\n') {
      triggerPending = false;
      triggerPendingMode = null;
      triggerAffix = '';
      if (triggerDebounceTimer) clearTimeout(triggerDebounceTimer);
      return;
    }
    triggerAffix += lastChar;
    if (triggerDebounceTimer) clearTimeout(triggerDebounceTimer);
    // Only show picker after minimum chars AND a pause in typing
    if (triggerAffix.length >= TRIGGER_MIN_CHARS) {
      var _pendingMode = triggerPendingMode;
      var _pendingSeq = _pendingMode === 'snippet' ? snippetSeq : (triggerCfg.promptTrigger || '"""');
      triggerDebounceTimer = setTimeout(function() {
        if (!triggerPending) return;
        var totalLen = _pendingSeq.length + triggerAffix.length;
        var filterStr = triggerAffix;
        triggerPending = false;
        triggerPendingMode = null;
        triggerAffix = '';
        buf = '';
        showTriggerPicker(activeEl, _pendingMode, totalLen, filterStr);
      }, TRIGGER_DEBOUNCE_MS);
    }
    return;
  }
}

// ── UNIQUE-PREFIX MATCHING ───────────────────────────────────────────
// With "Insert automatically" on (Settings, AUTO-INSERT-001), typing the whole
// shortcut is not required: the trigger plus enough letters to leave one
// candidate standing is inserted after the wait the person chose. Three letters
// is the floor — two is short enough to fire while the user is still deciding
// what to type, and in a growing library a two-letter opening rarely stays
// unambiguous for long. Off by default: the menu waits for Tab or Enter.
var MIN_PREFIX_CHARS = 3;
var AUTO_INSERT_MIN_SECONDS = 1;
var AUTO_INSERT_MAX_SECONDS = 10;
var AUTO_INSERT_DEFAULT_SECONDS = 2;

// Copy the automatic-insert fields of a stored triggerCfg onto the live one.
function _readAutoInsertCfg(src) {
  if (!src) return;
  if (typeof src.autoInsert === 'boolean') triggerCfg.autoInsert = src.autoInsert;
  if (typeof src.autoInsertSeconds === 'number') triggerCfg.autoInsertSeconds = src.autoInsertSeconds;
}

// The wait in ms, kept inside 1-10 seconds whatever the cache holds. Mirrors
// clampAutoInsertSeconds in app/src/lib/triggerUtils.ts.
function _autoInsertSeconds() {
  var n = Math.round(Number(triggerCfg.autoInsertSeconds));
  if (!isFinite(n)) n = AUTO_INSERT_DEFAULT_SECONDS;
  return Math.min(AUTO_INSERT_MAX_SECONDS, Math.max(AUTO_INSERT_MIN_SECONDS, n));
}

// Strip the trigger sequence from a stored shortcut / alternative query, which
// may or may not carry it baked in ("::air" and "air" are the same trigger).
function _bareTrigger(s, seq) {
  var v = String(s == null ? '' : s).trim();
  return v.indexOf(seq) === 0 ? v.slice(seq.length) : v;
}

// Which snippet group a row belongs to. The rule lives in
// shared/snippet-stats.js (loaded ahead of this file by the manifest) so the
// content script, the popup, Sprintbrain.html and the mobile companion collapse
// variants identically. The copy that used to live here merged rows across
// owners and stripped a trailing language code that was not the row's own
// language, so "wait" (FR) shed an "IT" it never had and became a variant of
// "WA". Two different people's snippets, one of which then expanded in place
// of the other.
//
// `snippets` is only ever reassigned, never mutated, so its identity is a safe
// cache key for the index.
var _grpIdxSrc = null, _grpIdx = null;
function _snipIndex() {
  if (_grpIdx && _grpIdxSrc === snippets) return _grpIdx;
  _grpIdxSrc = snippets;
  _grpIdx = SBSnippetStats.index(snippets);
  return _grpIdx;
}
function _groupKeyOf(s) {
  if (!s) return '';
  var idx = _snipIndex();
  return idx.keyOf[String(s.id)] || ('row:' + s.id);
}

// The single snippet a prefix can still mean, or null when it is ambiguous (or
// matches nothing). Language variants of the same snippet count as ONE
// candidate — they are one entry in the picker too, and _findLangVariants opens
// the language modal after the match, exactly as it does for a full shortcut.
function _uniquePrefixSnippet(typed, seq) {
  var q = typed.toLowerCase();
  var families = {};
  var order = [];
  for (var i = 0; i < snippets.length; i++) {
    var s = snippets[i];
    var hit = _bareTrigger(s.shortcut, seq).toLowerCase().indexOf(q) === 0;
    if (!hit) {
      var aqs = Array.isArray(s.alternative_queries) ? s.alternative_queries : [];
      for (var j = 0; j < aqs.length && !hit; j++) {
        if (_bareTrigger(aqs[j], seq).toLowerCase().indexOf(q) === 0) hit = true;
      }
    }
    if (!hit) continue;
    var key = _groupKeyOf(s);
    if (families[key] === undefined) { families[key] = s; order.push(key); }
    if (order.length > 1) return null;   // ambiguous, let the picker decide
  }
  return order.length === 1 ? families[order[0]] : null;
}

// ── LANGUAGE VARIANT DETECTION ───────────────────────────────────────
// A language shows as its two-letter pill in the shared language palette, never
// as a flag. Flags were emoji, and Windows ships no country glyphs in its emoji
// font, so Chrome drew the regional-indicator letters ("GB", "ES") in place of
// every flag; the pill renders the same on every OS. A flag also has to pick a
// country for a language (GB or US for English), which the code avoids.
// Palette: docs/DESIGN_SYSTEM.md · ruling: design_handoff_design_system/docs/ICONOGRAPHY.md
var LANG_NAMES = { EN: 'English', IT: 'Italiano', ES: 'Español', FR: 'Français', MULTI: 'Multi' };
var LANG_SUFFIX_RE = /(?:EN|ES|IT|FR|MULTI)$/i;

// Expand one row's `bodies` map (dashboard single-row model) into language-keyed
// views that share the row but carry each language's own body, so the picker can
// offer every translation and handleMatch inserts the right one.
function _bodiesViews(row) {
  var out = {};
  var b = row && row.bodies;
  if (!b || typeof b !== 'object') return out;
  Object.keys(b).forEach(function (l) {
    var txt = b[l];
    if (typeof txt !== 'string' || !txt.trim()) return;
    var view = {};
    for (var k in row) view[k] = row[k];
    view.lang = l;
    view.body = txt;
    view.bodyHtml = (row.bodiesHtml && row.bodiesHtml[l]) || '';
    out[l] = view;
  });
  return out;
}

function _findLangVariants(item) {
  // The group's sibling rows, then reduced to one entry per language. Group
  // membership comes from the shared rule (see _groupKeyOf), which joins
  // lang_group_id and trigger-base transitively and never crosses owners.
  var idx = _snipIndex();
  var g = idx.byKey[idx.keyOf[String(item.id)]];
  var rows = (g && g.rows && g.rows.length) ? g.rows : [item];

  // FIRST row per language wins, not the last. Duplicate same-language siblings
  // exist in real data (a re-import created a second row per language), and
  // letting the last one win made the visible variant depend on row order.
  var map = {};
  rows.forEach(function (r) {
    if (r.body && r.body.trim() && !map[r.lang]) map[r.lang] = r;
  });
  // Then fill the gaps from every row's `bodies` map. This runs whatever the
  // group size is: a group can hold sibling rows for ES/IT while EN exists only
  // inside a row's bodies, and gating this on a single-row group dropped that
  // language from the picker entirely.
  rows.forEach(function (r) {
    var views = _bodiesViews(r);
    Object.keys(views).forEach(function (l) {
      if (!map[l]) map[l] = views[l];
    });
  });
  return map;
}

// ── LANGUAGE PICKER MODAL (Shadow DOM) ──────────────────────────────

function injectLangModal(variantsMap, el, scLen) {
  var host = document.createElement('div');
  host.id = 'sb-lang-modal-host';
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.45);font-family:sans-serif;';
  var shadow = host.attachShadow({ mode: 'closed' });

  var style = document.createElement('style');
  style.textContent =
    '.sb-modal{background:#fff;border-radius:12px;padding:28px 32px;width:400px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:16px;}' +
    '.sb-modal h2{margin:0;font-size:16px;font-weight:600;color:#1a1a1a;letter-spacing:-0.2px;}' +
    '.sb-modal p.sb-sub{margin:-8px 0 0;font-size:13px;color:#666;}' +
    '.sb-lang-grid{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;}' +
    '.sb-lang-btn{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 18px;border-radius:10px;border:1.5px solid #e0e0e0;background:#fafafa;cursor:pointer;font-size:13px;font-weight:500;color:#333;transition:border-color 0.15s,background 0.15s;min-width:80px;flex:1;}' +
    '.sb-lang-btn:hover{border-color:#5c6bc0;background:#eef0fb;color:#5c6bc0;}' +
    '.sb-lang-pill{font-size:11px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;padding:3px 9px;border-radius:5px;background:#f1f1f4;color:#555;}' +
    '.sb-lang-pill.sb-lEN{background:#EEF2FF;color:#1B4FD8;}' +
    '.sb-lang-pill.sb-lES{background:#FFF7ED;color:#C2410C;}' +
    '.sb-lang-pill.sb-lIT{background:#F0FDF4;color:#15803D;}' +
    '.sb-lang-pill.sb-lFR{background:#F0FDFA;color:#0D9488;}' +
    '.sb-lang-pill.sb-lMULTI{background:#F5F3FF;color:#7C3AED;}' +
    '.sb-cancel-row{display:flex;justify-content:flex-end;}' +
    '.sb-btn-cancel{padding:8px 18px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;border:none;background:#f0f0f0;color:#555;transition:opacity 0.15s;}' +
    '.sb-btn-cancel:hover{opacity:0.75;}';

  var modal = document.createElement('div');
  modal.className = 'sb-modal';

  var h2 = document.createElement('h2');
  h2.textContent = '🌐 Available in multiple languages';
  modal.appendChild(h2);

  var sub = document.createElement('p');
  sub.className = 'sb-sub';
  sub.textContent = 'Choose a language to insert';
  modal.appendChild(sub);

  var grid = document.createElement('div');
  grid.className = 'sb-lang-grid';

  var langs = Object.keys(variantsMap);
  langs.forEach(function(langCode) {
    var btn = document.createElement('button');
    btn.className = 'sb-lang-btn';
    // An unknown code still reads: the pill falls back to the neutral tint and
    // prints the code itself, and the line under it repeats the code as its name.
    var pill = document.createElement('span');
    pill.className = 'sb-lang-pill sb-l' + langCode;
    pill.textContent = langCode;
    var name = document.createElement('span');
    name.textContent = LANG_NAMES[langCode] || langCode;
    btn.appendChild(pill);
    btn.appendChild(name);
    btn.addEventListener('click', function() {
      cleanup();
      processing = false;
      handleMatch(el, variantsMap[langCode], scLen);
    });
    grid.appendChild(btn);
  });
  modal.appendChild(grid);

  var cancelRow = document.createElement('div');
  cancelRow.className = 'sb-cancel-row';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'sb-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelRow.appendChild(cancelBtn);
  modal.appendChild(cancelRow);

  shadow.appendChild(style);
  shadow.appendChild(modal);
  document.body.appendChild(host);

  function cleanup() {
    host.remove();
    document.removeEventListener('keydown', escHandler);
  }

  function cancelFn() {
    cleanup();
    processing = false;
  }

  cancelBtn.addEventListener('click', cancelFn);
  host.addEventListener('click', function(e) { if (e.target === host) cancelFn(); });

  var escHandler = function(e) { if (e.key === 'Escape') cancelFn(); };
  document.addEventListener('keydown', escHandler);

  setTimeout(function() {
    var firstBtn = grid.querySelector('.sb-lang-btn');
    if (firstBtn) firstBtn.focus();
  }, 50);
}

// Shared presentation for snippet headings, matching the landing and app icon.
function snippetIcon(size) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="flex-shrink:0"><path d="M7 3H5a2 2 0 0 0-2 2v2m14-4h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6"/></svg>';
}

function promptIcon(size) {
  return '<svg width="' + size + '" height="' + size + '" style="flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/></svg>';
}

// ── DYNAMIC SNIPPET MODAL (Shadow DOM) ───────────────────────────
/**
 * Renders a centered modal inside a Shadow DOM to collect
 * user input for each {{placeholder}} variable.
 * @param {string[]} variables
 * @param {Function} onConfirm  receives varMap Object
 * @param {Function} onCancel   no arguments
 */
function injectDynamicModal(variables, onConfirm, onCancel) {
  var host = document.createElement('div');
  host.id = 'sb-modal-host';
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.45);font-family:sans-serif;';
  var shadow = host.attachShadow({ mode: 'closed' });

  var style = document.createElement('style');
  style.textContent =
    '.sb-modal{background:#fff;border-radius:12px;padding:28px 32px;width:420px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:16px;}' +
    '.sb-modal h2{margin:0;font-size:16px;font-weight:600;color:#1a1a1a;letter-spacing:-0.2px;display:flex;align-items:center;gap:8px;}' +
    '.sb-modal p.sb-sub{margin:-8px 0 0;font-size:13px;color:#666;}' +
    '.sb-field{display:flex;flex-direction:column;gap:6px;}' +
    '.sb-field label{font-size:12px;font-weight:500;color:#444;text-transform:uppercase;letter-spacing:0.4px;}' +
    '.sb-field input{border:1.5px solid #e0e0e0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;transition:border-color 0.15s;}' +
    '.sb-field input:focus{border-color:#5c6bc0;}' +
    // What the person types is bold and in full ink; the hint stays regular,
    // so an empty box never looks filled. Same on all four fill surfaces.
    '.sb-field input{font-weight:700;color:#1a1a1a;}' +
    '.sb-field input::placeholder{font-weight:400;}' +
    '.sb-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:4px;}' +
    '.sb-btn{padding:9px 20px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;border:none;transition:opacity 0.15s;}' +
    '.sb-btn:hover{opacity:0.85;}' +
    '.sb-btn-cancel{background:#f0f0f0;color:#333;}' +
    '.sb-btn-insert{background:#5c6bc0;color:#fff;}';

  var modal = document.createElement('div');
  modal.className = 'sb-modal';

  var h2 = document.createElement('h2');
  h2.innerHTML = snippetIcon(18) + 'Fill in your snippet';
  modal.appendChild(h2);

  var sub = document.createElement('p');
  sub.className = 'sb-sub';
  sub.textContent = variables.length + ' variable' + (variables.length > 1 ? 's' : '') + ' detected';
  modal.appendChild(sub);

  var fieldsContainer = document.createElement('div');
  var inputs = {};
  for (var i = 0; i < variables.length; i++) {
    var varName = variables[i];
    var field = document.createElement('div');
    field.className = 'sb-field';
    var label = document.createElement('label');
    label.textContent = varName.replace(/_/g, ' ');
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter ' + varName.replace(/_/g, ' ') + '\u2026';
    input.dataset.var = varName;
    inputs[varName] = input;
    field.appendChild(label);
    field.appendChild(input);
    fieldsContainer.appendChild(field);
  }
  modal.appendChild(fieldsContainer);

  var actions = document.createElement('div');
  actions.className = 'sb-actions';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'sb-btn sb-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  var insertBtn = document.createElement('button');
  insertBtn.className = 'sb-btn sb-btn-insert';
  insertBtn.textContent = 'Insert \u21B5';
  actions.appendChild(cancelBtn);
  actions.appendChild(insertBtn);
  modal.appendChild(actions);

  shadow.appendChild(style);
  shadow.appendChild(modal);
  document.body.appendChild(host);

  setTimeout(function() {
    var keys = Object.keys(inputs);
    if (keys.length) inputs[keys[0]].focus();
  }, 50);

  var cancelFn = function() {
    host.remove();
    document.removeEventListener('keydown', escHandler);
    onCancel();
  };

  cancelBtn.addEventListener('click', cancelFn);
  host.addEventListener('click', function(e) { if (e.target === host) cancelFn(); });

  var escHandler = function(e) {
    if (e.key === 'Escape') cancelFn();
  };
  document.addEventListener('keydown', escHandler);

  insertBtn.addEventListener('click', function() {
    var varMap = {};
    for (var j = 0; j < variables.length; j++) {
      varMap[variables[j]] = inputs[variables[j]].value.trim();
    }
    document.removeEventListener('keydown', escHandler);
    host.remove();
    onConfirm(varMap);
  });

  modal.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      insertBtn.click();
    }
  });
}

// ── MATCH HANDLER ──────────────────────────────────────────────────
// ── TRIGGER SPAN, MEASURED FROM THE FIELD (v2.148.2) ──────────────
// How many characters an expansion removes used to be a running count of
// keystrokes: the matched trigger's length, or the picker's tally of what was
// typed since it opened. Those counters can drift from the field — a menu that
// swallows a keystroke, an editor that rewrites what it received, focus moving
// mid-word — and every drift shows up the same way: part of the trigger is left
// stranded in the message ("::ne" in front of the snippet).
//
// The field is the truth. Read the text in front of the caret, and if the
// counted span does not start exactly at the trigger sequence, delete back to
// where the trigger actually begins instead. A whitespace anywhere in that run
// means the trigger was abandoned mid-message, so the count is left alone.

// Text between the start of the field and the caret, or null when it cannot be
// read (no selection, selection outside the field, cross-origin, etc.).
function _textBeforeCaret(el) {
  try {
    if (!el) return null;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      if (typeof el.selectionStart !== 'number') return null;
      return String(el.value == null ? '' : el.value).slice(0, el.selectionStart);
    }
    if (!_isCEEl(el)) return null;
    var host = _ceHost(el);
    var sel = window.getSelection();
    if (!host || !sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if (host !== r.endContainer && !host.contains(r.endContainer)) return null;
    var pre = document.createRange();
    pre.selectNodeContents(host);
    pre.setEnd(r.endContainer, r.endOffset);
    return pre.toString();
  } catch(_) { return null; }
}

// ── AUTO-CAPITALIZATION ────────────────────────────────────────────
// A snippet is authored once and expanded everywhere, so its body cannot know
// whether it will land at the start of a message or halfway through a sentence.
// The field knows. Read what sits in front of the caret and lift the first
// letter when the snippet is opening a sentence, and only then.
//
// This lives inside insertText because insertText is the one funnel every
// insertion passes through — trigger, picker, context menu, overlay, prompts.
// Deciding it anywhere else would give one entry point a behaviour the others
// do not have, which is exactly how the overlay entry points drifted before.
//
// Toggle: triggerCfg.autoCapitalize (default on).

// The caret sits at the start of a line — or of an empty field.
var AUTOCAP_LINE_RE = /(?:^|[\r\n])[ \t]*$/;
// The caret follows a finished sentence: . ! or ?, any closing quote or
// bracket, then whitespace. The non-digit in front of the stop is what keeps a
// decimal ("3.14 ") from reading as a sentence break.
var AUTOCAP_SENT_RE = /(?:[^0-9][.!?]|^[.!?])["'”’)\]]*\s+$/;

// Text in front of the caret with the trigger the user typed removed. On a
// textarea the trigger is already gone by the time we insert; on a
// contenteditable it is still there, held inside the live selection that the
// insertion is about to replace. Stripping a trailing whitespace-free run that
// opens with a trigger sequence covers both, and the whitespace test is what
// stops a "::" typed earlier in the message from being mistaken for it.
function _autoCapContext(el) {
  var before = _textBeforeCaret(el);
  if (before == null) return null;
  var seqs = [
    (triggerCfg && triggerCfg.snippetTrigger) || '::',
    (triggerCfg && triggerCfg.promptTrigger) || '"""'
  ];
  for (var i = 0; i < seqs.length; i++) {
    if (!seqs[i]) continue;
    var tail = before.slice(-MAX_BUF);
    var idx = tail.lastIndexOf(seqs[i]);
    if (idx === -1) continue;
    var run = tail.slice(idx);
    if (/\s/.test(run)) continue;
    return before.slice(0, before.length - run.length);
  }
  return before;
}

function _shouldAutoCap(el) {
  if (!triggerCfg || triggerCfg.autoCapitalize === false) return false;
  var ctx = _autoCapContext(el);
  if (ctx == null) return false;              // caret unreadable — change nothing
  if (!/\S/.test(ctx)) return true;           // start of the field
  if (AUTOCAP_LINE_RE.test(ctx)) return true; // start of a line
  return AUTOCAP_SENT_RE.test(ctx);           // after . ! ?
}

// Lifts the opening letter, and nothing else. Only a lowercase letter in the
// first non-whitespace position is touched, so "5 items" keeps its lowercase
// "items", a URL or an email is left exactly as written, and text that already
// opens with a capital is returned untouched.
function _autoCapitalize(text) {
  var s = String(text == null ? '' : text);
  if (!s || /^\s*(?:https?:\/\/|www\.|[^\s@]+@[^\s@]+\.)/i.test(s)) return s;
  var lead = /^\s*/.exec(s)[0].length;
  var ch = s.charAt(lead);
  if (!/[a-zà-öø-ÿ]/.test(ch)) return s;
  return s.slice(0, lead) + ch.toUpperCase() + s.slice(lead + 1);
}

function _fieldTriggerSpan(el, span) {
  try {
    var seq = (triggerCfg && triggerCfg.snippetTrigger) || '::';
    var before = _textBeforeCaret(el);
    if (before == null || !seq) return span;
    // Already reaching the trigger — the count is right, leave it.
    var start = before.length - span;
    if (span > 0 && start >= 0 && before.substring(start, start + seq.length) === seq) return span;
    var tail = before.slice(-MAX_BUF);
    var idx = tail.lastIndexOf(seq);
    if (idx === -1) return span;
    var run = tail.slice(idx);
    // Never shrink the span, and never reach across a word break: only a
    // continuous run from the trigger to the caret is the trigger the user typed.
    if (run.length <= span || /\s/.test(run)) return span;
    return run.length;
  } catch(_) { return span; }
}

function handleMatch(el, snip, scLen) {
  if (processing) return;
  processing = true;
  scLen = _fieldTriggerSpan(el, scLen);
  var fieldSnapshot = captureFieldState(el, scLen);
  var vars = parsePlaceholders(snip.body);
  if (vars.length > 0) {
    // The fill-in box takes focus, and with it the selection deleteChars sets
    // over the trigger: the snippet then had nowhere to land and the trigger
    // stayed in the field. Leave the trigger alone until the box closes, then
    // select it again from the caret offset read here, as the field overlay does.
    var caretCO = _isCEEl(el) ? _ceCaretCharOffset(_ceHost(el)) : -1;
    injectDynamicModal(vars, function(varMap) {
      var modSnip = {};
      for (var k in snip) modSnip[k] = snip[k];
      modSnip.body = interpolateSnippet(snip.body, varMap);
      modSnip.blankPlaceholders = vars.filter(function(v) { return varMap[v] === ''; });
      var proceed = function() { _proceedInsert(el, modSnip, fieldSnapshot, scLen); };
      if (_ceRestoreTriggerRange(el, caretCO, scLen)) proceed();
      else deleteChars(el, scLen, proceed);
    }, function() {
      processing = false;
    });
    return;
  }
  deleteChars(el, scLen, function() {
    _proceedInsert(el, snip, fieldSnapshot, scLen);
  });
}

function _proceedInsert(el, snip, fieldSnapshot, scLen) {
  var fields = extractFields(snip.body);
  if (!fields.length) {
    var text = resolveBody(snip.body, {}, { lang: snip.lang });
    var _isCE = el && (el.isContentEditable || (el.getAttribute &&
      (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')));
    var pics = _pictureForm(snip);
    var html = pics && _takesFormatting(el) ? pics.formatted : null;
    // Going back from the warning is the summary card's Cancel: the trigger
    // comes out and nothing goes in.
    _checkThenInsert(el, snip, text, function(note) {
      note = _pictureNote(note, pics, html);
      if (_isCE) {
        // For CE: deleteChars only SET the selection spanning the trigger.
        // Insert synchronously NOW while that selection is still live — execCommand
        // atomically replaces the trigger with the snippet. The celebration is then
        // purely informational; onConfirm only logs. onUndo deletes the inserted
        // region (see restoreFieldState) so the field returns to its pre-trigger state.
        var before = _ceMeasureBefore(el);
        insertText(el, text, html);
        _markSyncInserted(fieldSnapshot, el, before, text, html ? pics : null);
        showCelebration(
          text,
          function onConfirm() {           // timer expired or user clicked OK
            logEvent(snip, 0);
            processing = false;
          },
          function onUndo() {              // user clicked Undo
            restoreFieldState(fieldSnapshot);
            processing = false;
          },
          { inserted: true, target: el, warning: reviewWarning(snip), note: note }
        );
      } else {
        // Non-CE (textarea / input): deleteChars already stripped the trigger.
        // Defer insertion to onConfirm, as before.
        showCelebration(
          text,
          function onConfirm() {           // timer expired or user clicked OK
            insertText(el, text);
            logEvent(snip, 0);
            processing = false;
          },
          function onUndo() {              // user clicked Undo — never insert
            restoreFieldState(fieldSnapshot);
            processing = false;
          },
          { inserted: false, target: el, warning: reviewWarning(snip), note: note }
        );
      }
    }, function() {
      restoreFieldState(fieldSnapshot);
      processing = false;
    });
  } else {
    // showOverlay merges the body-declared field config itself.
    showOverlay(el, snip, scLen || 0, function() { processing = false; });
  }
}

// ── DELETE N CHARS ─────────────────────────────────────────────────
// On contenteditable hosts that intercept beforeinput (WhatsApp Web's Lexical
// editor, Gmail compose, Slack, etc.), calling execCommand('delete') N times
// in a tight loop is unreliable — the editor batches/normalizes events and
// often only the first delete lands. Selecting the N chars first and then
// issuing a single delete works around that, because the editor sees one
// deleteContentBackward over a non-collapsed range.
//
// We build the selection Range by walking backward through text nodes in
// document order rather than calling Selection.modify N times. Modify-based
// extension fails in WhatsApp Web's "first message" state (empty editor freshly
// populated): Lexical re-normalizes the selection on every modify call and
// the extend goes nowhere, so 0 chars get selected and the trigger survives.
// Walking text nodes builds the final range in one shot, which Lexical
// accepts as a single deleteContentBackward.
function _ceWalkBackChars(rootEl, endNode, endOffset, n) {
  // Returns {node, offset} of the position N characters before (endNode, endOffset),
  // walking only text nodes that are descendants of rootEl. Falls back to
  // (rootEl, 0) if we run out of text before reaching N.
  var remaining = n;
  var node = endNode;
  var offset = endOffset;

  // If we start in an element node (e.g. cursor right after a <br>), descend
  // to the deepest text node at the offset position.
  if (node && node.nodeType === Node.ELEMENT_NODE) {
    var children = node.childNodes;
    if (children.length === 0) {
      // empty element — nothing to consume here, walk to previous text node
    } else {
      var idx = Math.min(offset, children.length) - 1;
      while (idx >= 0) {
        var c = children[idx];
        if (c.nodeType === Node.TEXT_NODE) {
          node = c; offset = c.nodeValue.length; break;
        } else if (c.nodeType === Node.ELEMENT_NODE) {
          // dive to the last text node inside
          var tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
          var last = null, t;
          while ((t = tw.nextNode())) last = t;
          if (last) { node = last; offset = last.nodeValue.length; break; }
        }
        idx--;
      }
    }
  }

  while (remaining > 0 && node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (offset >= remaining) {
        offset -= remaining; remaining = 0; break;
      }
      remaining -= offset;
      // move to previous text node within rootEl
      var prev = _prevTextNode(node, rootEl);
      if (!prev) { node = rootEl; offset = 0; break; }
      node = prev; offset = node.nodeValue.length;
    } else {
      var prev2 = _prevTextNode(node, rootEl);
      if (!prev2) { node = rootEl; offset = 0; break; }
      node = prev2; offset = node.nodeValue.length;
    }
  }
  return { node: node, offset: offset };
}

function _prevTextNode(node, rootEl) {
  // Document-order previous text node, bounded by rootEl.
  var tw = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  var prev = null, t;
  while ((t = tw.nextNode())) {
    if (t === node) return prev;
    prev = t;
  }
  return prev;
}

// Find the actual contenteditable host. `el` may be the inner span/<p> that
// received the keydown — Lexical (WhatsApp Web) routes events through inner
// nodes, and a TreeWalker rooted there only sees one fragment of the typed
// text. We need the element whose `contenteditable` attribute is "true" (the
// root of the editor instance) so the walker can see all text nodes.
function _ceHost(el) {
  var n = el;
  while (n && n.getAttribute) {
    var a = n.getAttribute('contenteditable');
    if (a === 'true' || a === '') return n;
    n = n.parentElement;
  }
  return el;
}

function _isCEEl(el) {
  return !!(el && (el.isContentEditable || (el.getAttribute &&
    (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''))));
}

function _selectionInside(sel, el) {
  if (!sel || !sel.rangeCount || !el) return false;
  var n = sel.getRangeAt(0).endContainer;
  while (n) {
    if (n === el) return true;
    n = n.parentNode;
  }
  return false;
}

function deleteChars(el, n, cb) {
  if (!el || n <= 0) { if (cb) cb(); return; }
  var isCE = el.isContentEditable || el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '');
  try {
    if (isCE) {
      // Lexical (WhatsApp Web) does NOT honor execCommand('delete') over a
      // non-collapsed range — its beforeinput handler treats deleteContent-
      // Backward as a single-char delete regardless of selection length.
      // Strategy: don't actually delete here. Just SET the selection to span
      // the N chars to remove. The next call (insertText) will fire
      // execCommand('insertText') which Chrome dispatches as one beforeinput
      // {inputType:'insertText'} over the live (non-collapsed) selection.
      // Lexical handles that as an atomic replacement — clean delete + insert
      // in one operation. Run synchronously (no setTimeout) so the selection
      // we just set is still live when insertText executes.
      var sel = window.getSelection();
      if ((!sel || !sel.rangeCount) || !_selectionInside(sel, el)) {
        try { el.focus(); } catch(_) {}
        sel = window.getSelection();
      }
      var host = _ceHost((sel && sel.rangeCount && sel.getRangeAt(0).endContainer.nodeType === 1)
        ? sel.getRangeAt(0).endContainer
        : (sel && sel.rangeCount ? sel.getRangeAt(0).endContainer.parentElement : el));
      if (!host || (host.nodeType !== 1)) host = _ceHost(el);

      if (sel && sel.rangeCount) {
        try {
          var r = sel.getRangeAt(0);
          var start = _ceWalkBackChars(host, r.endContainer, r.endOffset, n);
          var sr = document.createRange();
          sr.setStart(start.node, start.offset);
          sr.setEnd(r.endContainer, r.endOffset);
          sel.removeAllRanges();
          sel.addRange(sr);
          if (cb) cb();
          return;
        } catch(eRange) {}
      }
      // Selection unrecoverable — fall through to the legacy delete loop.
      try { el.focus(); for (var i = 0; i < n; i++) document.execCommand('delete', false, null); } catch(_) {}
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.focus();
      var s = (el.selectionStart != null) ? el.selectionStart : (el.value || '').length;
      var np = Math.max(0, s - n);
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      var nv = el.value.substring(0, np) + el.value.substring(s);
      if (desc && desc.set) desc.set.call(el, nv); else el.value = nv;
      el.setSelectionRange(np, np);
      el.dispatchEvent(new Event('input', {bubbles:true}));
    } else {
      for (var i = 0; i < n; i++) document.execCommand('delete', false, null);
    }
  } catch(e) {
    try {
      var s2 = el.selectionStart || 0;
      el.value = el.value.substring(0, Math.max(0, s2 - n)) + el.value.substring(s2);
      var np2 = Math.max(0, s2 - n);
      el.setSelectionRange(np2, np2);
      el.dispatchEvent(new Event('input', {bubbles:true}));
    } catch(e2) {}
  }
  setTimeout(function() { if (cb) cb(); }, 20);
}

// ── INSERT TEXT ────────────────────────────────────────────────────
// Multi-line text via execCommand('insertText', '...\n...') is mangled by
// rich-text editors (WhatsApp Web/Lexical drops or reorders the segments).
// Insert one line at a time and emit a real line break between them.

// Per-line insertion: one execCommand per line, a real line break between them.
// Works in plain contenteditables, Gmail, Slack. Editors that own their input
// model (Lexical) accept the break commands and drop them — _cePasteInsert
// handles those; this stays the fallback for everything else.
function _ceLineInsert(text) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (i > 0) {
      var ok = false;
      try { ok = document.execCommand('insertLineBreak', false, null); } catch(e) {}
      if (!ok) {
        try { ok = document.execCommand('insertParagraph', false, null); } catch(e) {}
      }
      if (!ok) {
        try { document.execCommand('insertText', false, '\n'); } catch(e) {}
      }
    }
    // Always emit execCommand on the first line (even when empty) so that
    // the non-collapsed selection set by deleteChars is atomically replaced.
    // Without this, an empty body leaves the trigger text selected in the
    // field — producing the "outputs ::shortcut" symptom.
    if (i === 0 || lines[i]) {
      try { document.execCommand('insertText', false, lines[i]); } catch(e) {}
    }
  }
}

// Lexical (WhatsApp Web) marks its root with data-lexical-editor="true". The
// attribute is readable from a content script, unlike the editor instance the
// page keeps on the element.
function _isLexicalHost(host) {
  return !!(host && host.getAttribute && host.getAttribute('data-lexical-editor') === 'true');
}

// Deletes the selected text, the trigger deleteChars selected, ahead of a paste.
//
// execCommand does it through the browser's own editing, and Lexical keeps that
// edit only when it changes a text node it already has. When the trigger is a
// whole text node (the start of a message, a new line, right after bold text)
// the browser removes the node and Lexical puts the trigger back: a one-line
// snippet then did not expand at all, and a longer one was pasted after the
// trigger ("::multiLine one"). So Lexical is handed the deletion through its
// own input model, a beforeinput carrying the selection as its target range,
// which it claims and applies itself. An editor that does not claim it gets
// the execCommand as before.
//
// "Claimed" does not mean "deleted". WhatsApp's editor claims the event and
// removes nothing when it is asked while its own focus handling has not caught
// up, which is exactly when a chooser, a fill-in form or the Undo card has just
// closed: focus sat on that button, and this runs inside its click. The snippet
// was then pasted in front of a trigger that never left ("::followupCiao!..."),
// or Undo did nothing. So the text is checked a moment later, and a delete that
// was ignored is sent again once the editor has settled (_ceRetryDelete).
// `done` runs once the field has been dealt with, and only then may a paste go in.
var LEXICAL_VERIFY_MS = 60;   // an applied delete reaches the DOM in about 20ms
var LEXICAL_SETTLE_MS = 80;   // what the editor needs after a refocus before it honours one

// cb(true) as soon as test() holds, cb(false) if it still does not after `ms`.
function _ceWaitFor(test, ms, cb) {
  var t0 = Date.now();
  (function poll() {
    if (test()) { cb(true); return; }
    if (Date.now() - t0 >= ms) { cb(false); return; }
    setTimeout(poll, 4);
  })();
}

function _ceSendDelete(host, range) {
  return !host.dispatchEvent(new InputEvent('beforeinput', {
    inputType: 'insertText', data: '', bubbles: true, cancelable: true, composed: true,
    targetRanges: [new StaticRange({
      startContainer: range.startContainer, startOffset: range.startOffset,
      endContainer: range.endContainer, endOffset: range.endOffset
    })]
  }));
}

// The editor claimed the delete and did nothing. Refocus it, give it time to
// settle, put the selection back from its character offsets (a refocus resets
// the DOM selection) and ask again, once.
function _ceRetryDelete(host, startCO, endCO, gone, end) {
  try { host.focus(); } catch(e) { console.error('[Fibonax] could not refocus the editor', e); }
  setTimeout(function() {
    try {
      var sp = _ceCharOffsetToPoint(host, startCO, true);
      var ep = _ceCharOffsetToPoint(host, endCO);
      var rr = document.createRange();
      rr.setStart(sp.node, sp.offset);
      rr.setEnd(ep.node, ep.offset);
      // The field changed while the editor settled: do not delete what is there now.
      if (rr.toString() !== gone) { end(); return; }
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(rr);
      var before = host.textContent;
      _ceSendDelete(host, rr);
      _ceWaitFor(function() { return host.textContent !== before; }, LEXICAL_VERIFY_MS * 2, function(applied) {
        if (!applied) console.error('[Fibonax] the editor ignored the delete twice; the trigger may still be in the field');
        end();
      });
    } catch(e) {
      console.error('[Fibonax] retrying the delete failed', e);
      end();
    }
  }, LEXICAL_SETTLE_MS);
}

function _ceDeleteSelection(host, done) {
  var ended = false;
  var end = function() { if (!ended) { ended = true; if (done) done(); } };
  if (_isLexicalHost(host)) {
    try {
      var sel = window.getSelection();
      var r = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
      if (r && !r.collapsed) {
        var gone = r.toString();
        var before = host.textContent;
        var startCO = _ceCaretCharOffset(host, true);
        var endCO = _ceCaretCharOffset(host);
        if (_ceSendDelete(host, r)) {
          // No text in the range (only line breaks), or no offsets to put it
          // back from: there is nothing to check the delete against.
          if (!gone || startCO < 0 || endCO < 0) { end(); return; }
          _ceWaitFor(function() { return host.textContent !== before; }, LEXICAL_VERIFY_MS, function(applied) {
            if (applied) { end(); return; }
            _ceRetryDelete(host, startCO, endCO, gone, end);
          });
          return;
        }
      }
    } catch(e) { console.error('[Fibonax] the editor delete failed, using the browser edit', e); }
  }
  try { document.execCommand('insertText', false, ''); } catch(e) {}
  end();
}

// What the selection holds, and where it starts. The start is held as a collapsed
// range, which follows the DOM through an edit; a character offset cannot do
// that, since it does not tell the two sides of a line break apart.
function _ceHoldSelection() {
  try {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    var start = r.cloneRange();
    start.collapse(true);
    return { start: start, text: r.toString() };
  } catch(e) {
    console.error('[Fibonax] could not note where the trigger began', e);
    return null;
  }
}

// Gives a removed trigger back to the field, selected, when removing it has moved
// the caret to another line: a line break or a block lies between the caret and
// where the trigger began. A caret that only moved past a formatting tag, or past
// the space the browser keeps at a line end, is where the browser put it and the
// trigger stays out.
function _ceBringBackTrigger(held) {
  if (!held || !held.text) return;
  try {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var caret = sel.getRangeAt(0);
    var start = held.start;
    var between = document.createRange();
    if (start.comparePoint(caret.startContainer, caret.startOffset) < 0) {
      between.setStart(caret.startContainer, caret.startOffset);
      between.setEnd(start.startContainer, start.startOffset);
    } else {
      between.setStart(start.startContainer, start.startOffset);
      between.setEnd(caret.startContainer, caret.startOffset);
    }
    var passed = between.cloneContents();
    // A field styled white-space: pre-wrap writes its line breaks as "\n".
    if (!passed.querySelector('br,div,p,li') && passed.textContent.indexOf('\n') < 0) return;
    var back = document.createTextNode(held.text);
    start.insertNode(back);
    var again = document.createRange();
    again.selectNodeContents(back);
    sel.removeAllRanges();
    sel.addRange(again);
  } catch(e) { console.error('[Fibonax] could not put the trigger back before the body', e); }
}

// Lexical (WhatsApp Web) keeps its own input model. It accepts
// execCommand('insertLineBreak') — returning true — and then inserts nothing,
// so the fallbacks above never fire and a multi-paragraph snippet lands as one
// dense block. It does honour a text/plain paste, which it converts into real
// line breaks. Returns true when the paste is taken: on Lexical it goes in once
// the trigger delete is confirmed, so the return only says it is on its way.
//
// The trigger is removed first (_ceDeleteSelection). A paste event carries no
// target ranges: Lexical pastes at its own cached caret and would leave the
// trigger text in the field ("...reserva ♡::neob").
//
// Where the page ignores the paste, the body goes in line by line, and the first
// line replaces the selected trigger in one step. That is how a one-line body
// lands, and it lands right in every field. Here the trigger is already gone, and
// removing a trigger that was the whole of its line makes the line disappear: the
// browser moves the caret to a neighbouring line (the end of the line above, the
// start of the next one, the start of the field) and the body was written there,
// joined to another line's text, with the line it was typed on left empty. So the
// trigger is put back, selected (_ceBringBackTrigger), and the body replaces it
// as a one-line body does.
// `html`, when given, is the text with its pictures (see _takesFormatting): it
// goes in the same paste as text/html, and the editor picks the richer one.
function _cePasteInsert(el, text, html) {
  var host = _ceHost(el);
  if (!host || typeof DataTransfer !== 'function' || typeof ClipboardEvent !== 'function') return false;

  var dt;
  try {
    dt = new DataTransfer();
    dt.setData('text/plain', text);
    if (html) dt.setData('text/html', html);
  } catch(e) { return false; }

  if (_isLexicalHost(host)) {
    // The paste waits for the delete to be confirmed (see _ceDeleteSelection),
    // which can take a moment. Lexical takes every body as a paste, so there is
    // no other route to report back: an unclaimed paste falls to the per-line path.
    _ceDeleteSelection(host, function() {
      if (!_cePasteLand(el, host, dt, text)) _ceLineInsert(text);
    });
    return true;
  }
  var held = _ceHoldSelection();
  _ceDeleteSelection(host);
  if (_cePasteLand(el, host, dt, text)) return true;
  _ceBringBackTrigger(held);
  return false;
}

// Sends the paste and checks that the body landed. Returns false when the editor
// did not claim it.
function _cePasteLand(el, host, dt, text) {
  var claimed;
  try {
    claimed = !host.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true
    }));
  } catch(e) { return false; }
  if (!claimed) return false;

  // preventDefault alone does not prove the editor inserted anything — it may
  // reject untrusted events, or read the system clipboard instead of ours.
  // Confirm the body actually landed once the editor has had time to reconcile
  // (Lexical writes to the DOM a microtask later), and fall back to the
  // per-line path if it did not. Probe on the first non-empty line so the check
  // means "the snippet is in the field", not "the field grew". Spaces are
  // compared loosely: formatted text lands with runs of spaces joined or kept
  // as non-breaking ones, and a strict compare would insert the body twice.
  // The field is read as it shows (innerText), not as its nodes run together:
  // an email layout's cells and rows land side by side with nothing between
  // them in textContent, and the plain line would never be found in it. Case
  // is ignored too: a layout may show its first line in capitals
  // (text-transform), and innerText reads it so.
  var probe = '';
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i]) { probe = lines[i].slice(0, 24); break; }
  }
  if (probe) {
    var loose = function(s) { return String(s).replace(/[\s\u00a0]+/g, ' ').toLowerCase(); };
    setTimeout(function() {
      var landed = _ceHost(el);
      var shown = landed && typeof landed.innerText === 'string' ? landed.innerText : (landed ? landed.textContent : '');
      if (loose(shown).indexOf(loose(probe)) === -1) _ceLineInsert(text);
    }, 120);
  }
  return true;
}

// Whether a field takes formatted text, and with it a snippet's pictures: a
// contenteditable editor (Gmail, Outlook web). Inputs, textareas and WhatsApp's
// editor (Lexical) take the text only, and the pictures are left out.
function _takesFormatting(el) {
  return _isCEEl(el) && !_isLexicalHost(_ceHost(el));
}

// The fill form of a formatted snippet (a layout, or pictures), or null for
// plain text. A snippet with no fields expands without the overlay, so this is
// where its formatted copy, and the count of pictures a plain box leaves out,
// come from.
function _pictureForm(snip) {
  if (!_SBFF || (!snip.bodyHtml && !/\{\s*picture:/i.test(snip.body || ''))) return null;
  var vm = _SBFF.fillForm(snip.body, {}, { fieldCfg: snip.fieldCfg || {}, lang: snip.lang, formatted: snip.bodyHtml || null });
  return vm.formatted ? vm : null;
}

// The pictures a formatted insert carries, { src, alt }: from the text's parts,
// or read off its layout's <img> tags.
function _formattedPictures(vm) {
  if (vm.parts) {
    return vm.parts.filter(function(p) { return !!p.picture; }).map(function(p) { return p.picture; });
  }
  return (String(vm.formatted || '').match(/<img\b[^>]*>/gi) || []).map(function(tag) {
    var attr = function(name) {
      var m = new RegExp('\\s' + name + '="([^"]*)"', 'i').exec(tag);
      return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
    };
    return { src: attr('src'), alt: attr('alt') };
  });
}

// The Undo card's note, with a line added when a plain box left an email
// layout or pictures out.
function _pictureNote(note, vm, html) {
  var line = vm && vm.formatted && !html && _SBFF ? _SBFF.formattedNote(vm, 'left-out-done') : '';
  if (!line) return note;
  return note ? note + ' ' + line : line;
}

// `html` is the formatted copy of a text with pictures, for a field that takes
// formatting (_takesFormatting); null everywhere else.
function insertText(el, text, html) {
  if (!el) return;
  // Normalize CRLF/CR to LF first. A body carrying Windows line endings (JSON
  // import, text pasted from a desktop editor) otherwise splits into lines that
  // each keep a trailing CR: the CR survives into the message as an invisible
  // character, and a blank line — the lone "\r" segment — loses its break
  // entirely, collapsing paragraphs into one block.
  text = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  // Read the caret's surroundings BEFORE anything below focuses or moves it.
  // Not for formatted text: its copy would keep the small letter, and the
  // landing check would read the body as missing and insert it again.
  if (!html && _shouldAutoCap(el)) text = _autoCapitalize(text);
  var isCE = el.isContentEditable || el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '');
  try {
    if (isCE) {
      // CRITICAL: do NOT call el.focus() on the CE path. Lexical (WhatsApp Web)
      // resets the DOM selection on focus events, which would wipe the
      // non-collapsed range that deleteChars just set to span the trigger —
      // causing execCommand('insertText') to insert at start-of-field while
      // the trigger text survives. deleteChars already focused the editable
      // when needed; trust it.
      // Lexical takes every body as a paste, one line or many: its editor undoes
      // a native insert over a trigger that is a whole text node (see
      // _ceDeleteSelection). Elsewhere a multi-line body tries the paste first,
      // and the line-by-line path's first execCommand('insertText') replaces the
      // selection deleteChars set over the trigger.
      // Use !activeElement.contains(el) rather than !el.contains(activeElement):
      // el may be an inner span while activeElement is the outer contenteditable
      // div (WhatsApp Web / Lexical). The old check had the containment test
      // backwards, causing an unnecessary el.focus() on the inner span, which
      // makes Lexical reset the non-collapsed range set by deleteChars — leaving
      // a fragment of the trigger text in the field.
      if (document.activeElement !== el && !document.activeElement.contains(el)) {
        try { el.focus(); } catch(_) {}
      }
      if (html && !_isLexicalHost(_ceHost(el)) && _cePasteInsert(el, text, html)) return;
      if ((text.indexOf('\n') > -1 || _isLexicalHost(_ceHost(el))) && _cePasteInsert(el, text)) return;
      _ceLineInsert(text);
      return;
    }
    el.focus();
    if (document.execCommand('insertText', false, text)) return;
  } catch(e) {}
  try {
    var s = el.selectionStart || 0;
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    var nv = el.value.substring(0, s) + text + el.value.substring(s);
    if (desc && desc.set) desc.set.call(el, nv); else el.value = nv;
    el.setSelectionRange(s + text.length, s + text.length);
    el.dispatchEvent(new Event('input', {bubbles:true}));
  } catch(e) {}
}

// ── OVERLAY ────────────────────────────────────────────────────────
var overlayEl  = null;
var overlayDone = null;
// Trigger/filter length the field overlay must strip from the target field at
// insert time. On contenteditable hosts deleteChars only SETS a selection over
// the trigger (it never deletes), and opening the overlay steals focus and wipes
// that selection — so the trigger survives until doInsert removes it here. 0 for
// textarea/input (trigger already stripped) and for the selection-suggest path.
var overlayTriggerLen = 0;
// Caret position (character offset within the contenteditable host) at the
// moment the overlay opened — the end of the trigger. Recovering the trigger
// from the LIVE selection at insert time is not enough: the overlay took focus,
// and focusing a contenteditable again drops the caret at the start of the
// editor, so the walk backwards found nothing. The snippet then landed at the
// top of the field and the whole trigger survived at the end. -1 when unknown.
var overlayCaretCO = -1;
var overlaySelectionStartCO = -1;

// ── ADJUST PANEL ───────────────────────────────────────────────────
// The Date/Time builder's three decisions — which format, which day, what time
// on it — offered again while the form is open, so a date that is nearly right
// does not have to be typed out by hand.
//
// What each control MEANS is decided in shared/fill-form.js; this only draws
// it. Same closed lists, same words, same order as the builder in the dashboard
// rail.
//
// Collapsed behind one link on purpose. Almost every expansion wants the day
// the field already opens on, and three rows under every date would push a
// two-field form past the fold for a choice most people never make.
function _sbAdjustHtml(cfg) {
  var a = cfg.adjust;
  if (!a) return '';
  var k = xesc(cfg.key), rows = '';
  var fieldName = xesc(cfg.label || cfg.key.replace(/_/g, ' '));

  function optList(items, sel) {
    return items.map(function(o) {
      var v = o.value === undefined ? o : o.value;
      var text = o.label === undefined ? o : o.label;
      if (o.sample !== undefined) text += ' · ' + o.sample;
      return '<option value="' + xesc(v) + '"' + (v === sel ? ' selected' : '') + '>' +
             xesc(text) + '</option>';
    }).join('');
  }

  if (a.formats.length) {
    rows += '<div class="sb-adjrow"><span class="sb-adjlbl">Format</span>' +
            '<select class="sb-fmt" aria-label="Format for ' + fieldName + '" data-key="' + k + '">' + optList(a.formats, cfg.format) +
            '</select></div>';
  }

  if (a.modes.length) {
    rows += '<div class="sb-adjrow"><span class="sb-adjlbl">Day</span>' +
            '<select class="sb-daymode" aria-label="Day adjustment for ' + fieldName + '" data-key="' + k + '">' + optList(a.modes, 'none') + '</select>' +
            '<span class="sb-dayfixed" data-key="' + k + '" hidden>' +
              '<input type="number" class="sb-dayn" aria-label="Offset amount for ' + fieldName + '" data-key="' + k + '" min="1" step="1" value="1">' +
              '<select class="sb-dayu" aria-label="Offset unit for ' + fieldName + '" data-key="' + k + '">' + optList(a.units, 'D') + '</select>' +
              '<label class="sb-adjchk"><input type="checkbox" class="sb-dayback" data-key="' + k + '">backwards</label>' +
            '</span>' +
            '<select class="sb-daynamed" aria-label="Named day for ' + fieldName + '" data-key="' + k + '" hidden>' + optList(a.days, '') + '</select>' +
            '</div>';
  }

  if (a.hours.length) {
    rows += '<div class="sb-adjrow"><span class="sb-adjlbl">Clock</span>' +
            '<select class="sb-hh" aria-label="Hour for ' + fieldName + '" data-key="' + k + '">' + optList(a.hours, a.hour) + '</select>' +
            '<span class="sb-adjsep">:</span>' +
            '<select class="sb-mm" aria-label="Minute for ' + fieldName + '" data-key="' + k + '">' + optList(a.minutes, a.minute) + '</select>' +
            '</div>';
  }

  if (!rows) return '';
  return '<button type="button" class="sb-adj" data-adj="' + k + '" aria-expanded="false">' +
         'Options ▾</button>' +
         '<div class="sb-adjbox" data-adjbox="' + k + '" hidden>' + rows + '</div>';
}

// A closing date may not open before its opening one. The rule and the value
// come from extension/shared/fill-form.js; only the markup and the live rebind
// are local, which is the split that keeps four surfaces agreeing.
function _sbOrderAttrs(cfg) {
  var out = '';
  if (cfg.notBefore) out += ' data-after="' + xesc(cfg.notBefore) + '"';
  if (cfg.min) out += ' min="' + xesc(cfg.min) + '"';
  return out;
}

// Re-applies every ordering limit after any value changes. Cheap enough to run
// on each keystroke: a fill form is a handful of inputs, not a table.
// `edited` is the box the operator is typing in, if any. It is never emptied:
// a date picker reports a whole date after every keystroke, so typing the
// year 2027 passes through 0002, and clearing it there wiped the box under
// the operator's fingers. A closing date typed earlier than its opening one
// stays as typed, flagged by `min`; moving the opening date past it still
// clears it.
function _sbReorder(root, edited) {
  var deps = root.querySelectorAll('.sb-inp[data-after]');
  for (var i = 0; i < deps.length; i++) {
    var dst = deps[i];
    var src = root.querySelector('.sb-inp[data-key="' + dst.getAttribute('data-after') + '"]');
    if (!src) continue;
    var min = window.SBFillForm.orderedMin(dst.type === 'datetime-local' ? 'datetime' : 'date', src.value);
    // Written only when it changes. Chrome resets a date box's typing when its
    // min is set again, even to the same value, so the year 2027 typed digit
    // by digit came out blank.
    if (min) { if (dst.getAttribute('min') !== min) dst.setAttribute('min', min); }
    else if (dst.hasAttribute('min')) dst.removeAttribute('min');
    // A closing date the new opening one has just invalidated is no longer an
    // answer. Clearing beats leaving an impossible pair sitting in the form.
    if (min && dst !== edited && dst.value && dst.value < min) dst.value = '';
  }
}

// ── FILL FROM LINK ─────────────────────────────────────────────────
// The operator pastes a link to a page (an order, a confirmation) and the form
// fills itself from what the page says. Which piece of the page answers which
// field, and every word the box shows, is decided in shared/fill-form.js. The
// page itself is read by Fibonax's server, asked through the background
// worker: a content script runs in the page's world and never holds the
// session. Only the markup and the writing into the inputs are local.
//
// The Link box is not a field. It carries no .sb-inp and no data-key, so
// getVals, the focus flow and the insert can never read it as an answer.
function _sbLinkHtml() {
  var t = _SBFF.linkText;
  return '<div class="sb-link" aria-busy="false">' +
      '<label class="sb-linklbl" for="sb-linkinp">' + xesc(t('box-label')) + '</label>' +
      '<div class="sb-linkrow">' +
        '<input id="sb-linkinp" class="sb-linkinp" type="url" inputmode="url" autocomplete="off"' +
          ' spellcheck="false" placeholder="' + xesc(t('box-placeholder')) + '">' +
        '<button type="button" class="sb-linkbtn">' + xesc(t('box-button')) + '</button>' +
      '</div>' +
      '<div class="sb-linkmsg" role="status" aria-live="polite"></div>' +
    '</div>';
}

// Wires one overlay's Link box. Returns { input, fill } for the overlay's own
// Enter handler, or null when the form has no Link box.
function _sbBindLink(el, snip) {
  var box = el.querySelector('.sb-link');
  if (!box || !_SBFF) return null;
  var inp = box.querySelector('.sb-linkinp');
  var btn = box.querySelector('.sb-linkbtn');
  var msg = box.querySelector('.sb-linkmsg');
  // Bumped by every read, so only the newest one may write into the form.
  var seq = 0;
  // What the last read found for each field it looked for, and what that field
  // held right after it. A field that holds anything else since is no longer
  // the page's answer, whoever changed it — a keystroke, the Adjust panel, an
  // action button — so its mark goes.
  var marks = {};

  function say(text, isError) {
    msg.textContent = text;
    msg.classList.toggle('sb-linkerr', !!isError);
  }

  function setBusy(on) {
    btn.disabled = on;
    box.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function paint(key) {
    var slot = el.querySelector('.sb-linkmark[data-linkmark="' + key + '"]');
    if (!slot) return;
    var m = marks[key];
    var note = m ? _SBFF.linkNote(m.result) : '';
    // A note on a field the page filled is only ever "None on the page", which
    // is an answer; the other two ask for the operator, so they carry the
    // warning tone.
    var html = (m && m.linked ? '<span class="sb-linkbadge">' + xesc(_SBFF.linkText('from-link')) + '</span>' : '') +
      (note ? '<span class="sb-linknote' + (m.result.status === 'filled' ? '' : ' sb-linkwarn') + '">' +
        xesc(note) + '</span>' : '');
    slot.innerHTML = html;
    slot.hidden = html === '';
  }

  function sweep() {
    var keys = Object.keys(marks);
    if (!keys.length || overlayEl !== el) return;
    var now = getVals();
    for (var i = 0; i < keys.length; i++) {
      if (now[keys[i]] !== marks[keys[i]].value) {
        delete marks[keys[i]];
        paint(keys[i]);
      }
    }
  }
  // Bubbling, so each field's own listener has already run and the value read
  // here is the one the operator just left. Clicks are caught on the way down
  // and swept once the click is over, because the action buttons stop theirs
  // from bubbling and write their values while it runs.
  el.addEventListener('input', sweep);
  el.addEventListener('change', sweep);
  el.addEventListener('click', function() { setTimeout(sweep, 0); }, true);

  // Writes a value the way the operator could have: the picker gets its ISO
  // value, a menu gets its options ticked. Never .value on a radio, which would
  // rewrite one of the choices on offer (see the {button} code in showOverlay).
  function write(key, value) {
    var ctrls = el.querySelectorAll('.sb-inp[data-key="' + key + '"]');
    if (!ctrls.length) return;
    var kind = ctrls[0].type;
    if (kind === 'radio' || kind === 'checkbox') {
      var want = kind === 'checkbox' ? String(value).split(', ') : [String(value)];
      for (var i = 0; i < ctrls.length; i++) ctrls[i].checked = want.indexOf(ctrls[i].value) !== -1;
    } else {
      ctrls[0].value = String(value);
    }
  }

  function apply(read) {
    for (var key in read.values) {
      if (Object.prototype.hasOwnProperty.call(read.values, key)) write(key, read.values[key]);
    }
    _sbSyncOther(el);
    // The same two steps a hand edit runs: the date ordering, then the preview.
    _sbReorder(el);
    updatePrev(snip);
    var held = getVals();
    marks = {};
    for (var r = 0; r < read.results.length; r++) {
      var res = read.results[r];
      marks[res.key] = {
        result: res,
        value: held[res.key],
        // An empty box is never the page's answer, whatever emptied it. The
        // reader refuses a closing date before the opening one the form holds,
        // so the ordering above no longer clears a date the page wrote.
        linked: Object.prototype.hasOwnProperty.call(read.values, res.key) && held[res.key] !== ''
      };
    }
    var slots = el.querySelectorAll('.sb-linkmark[data-linkmark]');
    for (var s = 0; s < slots.length; s++) paint(slots[s].getAttribute('data-linkmark'));
    say(_SBFF.linkSummary(read), false);
  }

  // Where the caret goes once a read is over. Left alone when the operator has
  // already moved on to a field; otherwise the first field still waiting for an
  // answer after a fill, so Enter goes back to inserting, and the Link box
  // after a failure, so the link can be corrected.
  function settle(filled) {
    var ae = document.activeElement;
    if (ae && ae !== document.body && ae !== inp && ae !== btn) return;
    _sbFocus(filled ? _sbFirstEmpty(el) : inp);
  }

  function fail(code) {
    say(_SBFF.linkText(code), true);
    settle(false);
  }

  function fill() {
    var link = _SBFF.linkUrl(inp.value);
    if (link.problem) { say(_SBFF.linkText(link.problem), true); return; }
    var mine = ++seq;
    // Disabling the focused button would drop the focus out of the overlay,
    // and Esc with it.
    if (document.activeElement === btn) inp.focus();
    setBusy(true);
    say(_SBFF.linkText('reading'), false);
    try {
      chrome.runtime.sendMessage({ type: 'read_link', url: link.url, lang: navigator.language || '' }, function(res) {
        var lost = chrome.runtime.lastError;
        // Too late: the overlay closed or opened on another snippet, or a newer
        // read started. Its answer belongs to a form that is no longer there.
        if (overlayEl !== el || mine !== seq) return;
        setBusy(false);
        if (lost || !res) {
          console.error('[Fibonax] Fill from link got no answer from the extension', lost ? lost.message : '');
          fail('failed');
          return;
        }
        if (!res.ok) { fail(res.error); return; }
        // Read against the form as it is now, not as it opened: a closing date
        // is checked against the opening date the form holds now, which the
        // operator may have changed since.
        var now = _SBFF.fillForm(snip.body, getVals(), { fieldCfg: snip.fieldCfg || {}, lang: snip.lang, formatted: snip.bodyHtml || null });
        apply(_SBFF.readFromPage(now.fields, res.pieces));
        settle(true);
      });
    } catch (e) {
      // The extension was reloaded under this page, so this script can no
      // longer reach it.
      console.error('[Fibonax] Fill from link could not reach the extension', e);
      setBusy(false);
      fail('failed');
    }
  }

  btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); fill(); });
  return { input: inp, fill: fill };
}

function showOverlay(targetEl, snip, scLen, done) {
  overlayTriggerLen = scLen || 0;
  // Read the caret BEFORE the overlay exists: deleteChars has just selected the
  // trigger, so the selection end is exactly where the user was typing.
  overlayCaretCO = (targetEl && _isCEEl(targetEl))
    ? _ceCaretCharOffset(_ceHost(targetEl))
    : -1;
  overlaySelectionStartCO = (targetEl && _isCEEl(targetEl))
    ? _ceCaretCharOffset(_ceHost(targetEl), true)
    : -1;
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
  removeOverlay();
  overlayDone = done;
  // What the form IS — which fields, of what kind, the prose around each, its
  // starting value, the action buttons — is decided by
  // extension/shared/fill-form.js, the one module all four fill surfaces read.
  //
  // Built HERE, not at the call sites: three paths open this overlay, the
  // trigger, the picker, and the right-click context menu, and only the trigger
  // used to merge the body-declared config. Via the other two a {formmenu:}
  // arrived as a bare field name and rendered as a plain text box, so the
  // choices could not be picked at all. Keeping it inside means no future entry
  // point can forget.
  var vm = _SBFF
    ? _SBFF.fillForm(snip.body, {}, { fieldCfg: snip.fieldCfg || {}, lang: snip.lang, formatted: snip.bodyHtml || null })
    : { fields: [], buttons: [] };

  var fhtml = '';
  for (var i = 0; i < vm.fields.length; i++) {
    var cfg = vm.fields[i];
    var key = cfg.key;
    var opts = cfg.options;
    var inp;
    // A checkbox group is block-level, so it cannot sit inside an inline
    // sentence — its context goes above and below instead.
    var blockControl = false;
    if (cfg.type === 'dd' && opts.length) {
      // {formmenu: …; cols=N} sizes the field in characters; capped at the
      // overlay width so a long value can never push the panel out of view.
      var wide = cfg.cols ? ' style="width:'+cfg.cols+'ch;max-width:100%"' : '';
      var picked = cfg.picks;
      // Every option is on screen, for both kinds of menu. A <select> hid the
      // choices behind a control most people did not read as a menu at all:
      // they saw one word sitting in a box and typed over it. Checkboxes for a
      // multiple menu, radios for a single one, so the shape of the control is
      // what says how many you may pick, and nothing has to be opened to find
      // out what is on offer. Both are block-level, so the prose around the
      // token goes above and below rather than beside it.
      blockControl = true;
      var oType = cfg.multiple ? 'checkbox' : 'radio';
      // Radios need a group name, or every single-choice menu in one form would
      // share a group and picking in either would clear the other.
      var oName = cfg.multiple ? '' : ' name="sb-'+xesc(key)+'"';
      inp = '<div class="sb-multi"'+wide+'>' + opts.map(function(o){
        return '<label class="sb-opt"><input type="'+oType+'" class="sb-inp"'+oName+' data-key="'+key+'" value="'+xesc(o)+'"'+
               (picked.indexOf(o) >= 0 ? ' checked' : '')+'><span>'+xesc(o)+'</span></label>';
      }).join('') + _sbOtherHtml(cfg, oType, oName) + '</div>';
    } else if (cfg.type === 'date') {
      inp = '<input type="date" class="sb-inp" data-key="'+key+'"'+_sbOrderAttrs(cfg)+' value="'+xesc(cfg.value)+'">';
    } else if (cfg.type === 'time') {
      inp = '<input type="time" class="sb-inp" data-key="'+key+'" value="'+xesc(cfg.value)+'">';
    } else if (cfg.type === 'datetime' || cfg.type === 'datetime-local') {
      inp = '<input type="datetime-local" class="sb-inp" data-key="'+key+'"'+_sbOrderAttrs(cfg)+' value="'+xesc(cfg.value)+'">';
    } else {
      // A number is a text box with the number keypad. type="number" lets the
      // browser drop a comma or a second dot as it is typed ("1,5" became 15),
      // so the engine never saw what was written.
      inp = '<input type="text"'+(cfg.type==='number'?' inputmode="decimal"':'')+' class="sb-inp" data-key="'+key+'" placeholder="'+key.replace(/_/g,' ')+'" value="'+xesc(cfg.value)+'">';
    }
    // Presentation-only naming: answer keys, defaults and handlers stay intact.
    var fieldId = 'sb-fill-' + i;
    var fieldLabel = cfg.label || cfg.before || key.replace(/_/g, ' ');
    if (blockControl) {
      inp = inp.replace('class="sb-multi"', 'class="sb-multi" role="group" aria-label="'+xesc(fieldLabel)+'"');
    } else {
      inp = inp.replace('class="sb-inp"', 'class="sb-inp" id="'+fieldId+'" aria-label="'+xesc(fieldLabel)+'"');
    }
    // The row reads like the snippet — "Rate Plan: [ Refundable ] per night".
    // Only a field with no prose around it falls back to its key, which is
    // otherwise noise: an unnamed menu's key is a hash like MENU_1yvog3p.
    var pre  = cfg.before ? '<span class="sb-ctx">'+xesc(cfg.before)+'</span>' : '';
    var post = cfg.after  ? '<span class="sb-ctx">'+xesc(cfg.after)+'</span>'  : '';
    // A caption the author gave the box wins; otherwise only a box with no prose
    // around it falls back to its key.
    var lbl  = cfg.label ? '<label class="sb-lbl"'+(blockControl ? '' : ' for="'+fieldId+'"')+'>'+xesc(cfg.label)+'</label>'
      : ((pre || post) ? '' : '<label class="sb-lbl"'+(blockControl ? '' : ' for="'+fieldId+'"')+'>'+xesc(key.replace(/_/g,' '))+'</label>');
    // Where a field that reads its value off a page says what the last read
    // found ("From link", "Not on the page"). Empty and hidden until a read,
    // and absent from every field the author never pointed at a page.
    var mark = cfg.link ? '<div class="sb-linkmark" data-linkmark="'+xesc(key)+'" hidden></div>' : '';
    // Only presentation changes: keep field and keyboard order, and leave
    // choices or longer sentences room to read across the whole form.
    var wideField = blockControl || cfg.type === 'datetime' || cfg.type === 'datetime-local' || ((cfg.before || '').length + (cfg.after || '').length > 72) || (cfg.label || '').length > 64;
    var fieldWidth = wideField ? ' sb-field--wide' : (cfg.type === 'number' ? ' sb-field--compact' : '');
    fhtml += '<div class="sb-field'+fieldWidth+'">' + lbl + (blockControl
      ? (pre ? '<div class="sb-ctxline">'+pre+'</div>' : '') + inp +
        (post ? '<div class="sb-ctxline">'+post+'</div>' : '')
      : '<div class="sb-row">'+pre+inp+post+'</div>') + mark + _sbAdjustHtml(cfg) + '</div>';
  }

  // {button} controls: they set field values, they never print. Rendered after
  // the inputs they act on, so the cause sits above the effect.
  var buttons = vm.buttons;
  if (buttons.length) {
    fhtml += '<div class="sb-btnrow">' + buttons.map(function(b){
      return '<button type="button" class="sb-actbtn" data-btn="'+xesc(b.id)+'">'+xesc(b.label)+'</button>';
    }).join('') + '</div><div class="sb-btnerr" hidden></div>';
  }

  var el = document.createElement('div');
  el.id = 'sb-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'sb-fill-title');
  el.setAttribute('aria-describedby', 'sb-fill-description');
  el.innerHTML =
    '<div class="sb-hdr">' +
      '<h2 class="sb-function-name" id="sb-fill-title">Fill in your snippet: '+xesc(snip.title)+'</h2>' +
      '<button type="button" class="sb-close" aria-label="Cancel insertion"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>' +
    '</div>' +
    '<nav class="sb-view-switch" aria-label="Snippet view"><button type="button" data-pane="fields" aria-pressed="true">Fill in</button><button type="button" data-pane="preview" aria-pressed="false">Preview</button></nav>' +
    '<div class="sb-form-content"><div class="sb-input-pane">' +
      '<div class="sb-heading">' +
        '<p id="sb-fill-description">Fill in the fields, then insert your message.</p></div>' +
      (reviewWarning(snip) ? '<div class="sb-revwarn" role="alert">' + xesc(reviewWarning(snip)) + '</div>' : '') +
      (vm.linkable ? _sbLinkHtml() : '') +
      '<div class="sb-fields">'+fhtml+'</div></div>' +
      '<section class="sb-preview" aria-labelledby="sb-preview-label">' +
        '<div class="sb-preview-heading"><h3 id="sb-preview-label">Message preview</h3><span>Live preview</span></div>' +
        '<div class="sb-prev" id="sb-prev"></div>' +
        // Only where the pictures cannot go: said before Insert, not after.
        (_takesFormatting(targetEl) ? '' : '<p class="ff-picnote" id="sb-picnote" role="status" hidden></p>') +
      '</section>' +
    '</div>' +
    '<div class="sb-foot">' +
      '<span class="sb-tip">Enter \u00b7 Esc to cancel</span>' +
      '<button type="button" class="sb-insert">Insert message <span aria-hidden="true">\u21b5</span></button>' +
    '</div>';

  el.style.cssText =
    'position:fixed!important;top:50%!important;left:50%!important;' +
    'transform:translate(-50%,-50%)!important;z-index:2147483647!important;' +
    'display:flex!important;flex-direction:column!important;' +
    'width:1280px!important;height:calc(100dvh - var(--sb-s-8))!important;max-width:calc(100vw - var(--sb-s-8))!important;max-height:calc(100dvh - var(--sb-s-8))!important;' +
    'overflow:hidden!important;' +
    'box-shadow:var(--sb-shadow-xl)!important;';

  var bd = document.createElement('div');
  bd.id = 'sb-bd';
  bd.style.cssText = 'position:fixed;inset:0;background:var(--sb-scrim);z-index:2147483646;';

  document.body.appendChild(bd);
  document.body.appendChild(el);
  overlayEl = el;
  el.dataset.pane = 'fields';
  el.querySelectorAll('[data-pane]').forEach(function(button) {
    button.addEventListener('click', function() {
      el.dataset.pane = button.dataset.pane;
      el.querySelectorAll('[data-pane]').forEach(function(b) { b.setAttribute('aria-pressed', String(b === button)); });
    });
  });
  if (window.SBFillFormUI) window.SBFillFormUI.enhance(el.querySelector('.sb-fields'), vm, {
    prefix: 'overlay', row: '.sb-field', caption: '.sb-lbl,.sb-ctx,.sb-ctxline', menu: '.sb-multi', control: '.sb-inp'
  });

  setTimeout(function() {
    // A form that can fill from a link opens on the Link box: the next thing
    // the operator does there is paste. Other forms start at the first field,
    // including prefilled dates, so long snippets open at the top in text order.
    _sbFocus(el.querySelector('.sb-linkinp') || el.querySelector('.sb-fields .ff-menu > summary,.sb-fields .sb-inp:not([type="radio"]):not([type="checkbox"])'));
    updatePrev(snip);
  }, 50);

  var inps = el.querySelectorAll('.sb-inp');
  for (var j = 0; j < inps.length; j++) {
    (function(inp) {
      inp.addEventListener('input',  function(){ _sbReorder(el, inp); updatePrev(snip); });
      inp.addEventListener('change', function(){
        _sbReorder(el, inp);
        _sbSyncOther(el);
        updatePrev(snip);
        // Ticking Other opens its box, and the answer is typed there next.
        if (inp.hasAttribute('data-other')) {
          if (inp.checked) _sbFocus(el.querySelector('.sb-othertxt[data-otherkey="' + inp.getAttribute('data-key') + '"]'));
          return;
        }
        // A radio is a finished answer the moment it is ticked, so the caret
        // moves to whatever is still empty. Checkboxes are excluded: a multiple
        // choice menu is not finished by one tick. No key is involved, so this
        // cannot collide with anything the keyboard already does.
        if (inp.type === 'radio' && inp.checked) {
          _sbFocus(_sbNextEmptyAfter(overlayEl, inp.getAttribute('data-key')));
        }
      });
      // Keeps the field being worked in on screen. The panel scrolls its field
      // content within the viewport, so on a long form the caret could sit below
      // the fold. Bound to focus rather than to the move above, so Tab and a
      // plain click get it too. 'nearest' means a form that already fits on
      // screen never jumps.
      inp.addEventListener('focus',  function(){
        try { inp.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      });
      inp.addEventListener('paste',  function(){ setTimeout(function(){ updatePrev(snip); }, 0); });
    })(inps[j]);
  }

  // Adjust panels. A day or a clock choice writes a value into the picker that
  // the operator could have set by hand, so everything downstream — the
  // preview, the insert, datetimediff() — reads it back through the normal
  // getVals path and no other code has to know the panel exists. A format
  // choice is the exception: it changes how the value prints rather than what
  // the value is, so it stays on the panel and travels as fmtOverride.
  var adjType = {};
  for (var t = 0; t < vm.fields.length; t++) adjType[vm.fields[t].key] = vm.fields[t].type;

  function adjBox(key) { return el.querySelector('.sb-adjbox[data-adjbox="' + key + '"]'); }
  function adjInput(key) { return el.querySelector('.sb-inp[data-key="' + key + '"]'); }

  function applyDay(key) {
    var box = adjBox(key), inp = adjInput(key);
    if (!box || !inp || !_SBFF || !_SBFF.dayValue) return;
    var mode = box.querySelector('.sb-daymode');
    var fixed = box.querySelector('.sb-dayfixed');
    var named = box.querySelector('.sb-daynamed');
    if (!mode) return;
    // The two shapes a fixed offset and an anchor need are different, and only
    // one of them is ever an answer, so the other is not on screen at all.
    if (fixed) fixed.hidden = mode.value !== 'fixed';
    if (named) named.hidden = mode.value !== 'named';
    var next = _SBFF.dayValue(adjType[key], {
      mode:   mode.value,
      amount: fixed ? box.querySelector('.sb-dayn').value : '',
      unit:   fixed ? box.querySelector('.sb-dayu').value : 'D',
      back:   fixed ? box.querySelector('.sb-dayback').checked : false,
      named:  named ? named.value : ''
    }, inp.value);
    if (next) inp.value = next;
    updatePrev(snip);
  }

  function applyClock(key) {
    var box = adjBox(key), inp = adjInput(key);
    if (!box || !inp || !_SBFF || !_SBFF.clockValue) return;
    var hh = box.querySelector('.sb-hh'), mm = box.querySelector('.sb-mm');
    if (!hh || !mm) return;
    var next = _SBFF.clockValue(adjType[key], hh.value, mm.value, inp.value);
    if (next) inp.value = next;
    updatePrev(snip);
  }

  var adjBtns = el.querySelectorAll('.sb-adj');
  for (var ab = 0; ab < adjBtns.length; ab++) {
    (function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var box = adjBox(btn.dataset.adj);
        if (!box) return;
        box.hidden = !box.hidden;
        btn.setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
      });
    })(adjBtns[ab]);
  }

  var adjCtrls = el.querySelectorAll('.sb-adjbox select, .sb-adjbox input');
  for (var ac = 0; ac < adjCtrls.length; ac++) {
    (function(ctrl) {
      var key = ctrl.dataset.key;
      var cls = ctrl.className;
      // The format never touches the value, so it only needs the preview
      // redrawn; getFmts reads the select itself when the time comes.
      var run = cls === 'sb-fmt'
        ? function() { updatePrev(snip); }
        : (cls === 'sb-hh' || cls === 'sb-mm'
            ? function() { applyClock(key); }
            : function() { applyDay(key); });
      ctrl.addEventListener('change', run);
      // The offset amount is typed, so it answers while it is being typed
      // rather than only when the field is left.
      if (cls === 'sb-dayn') ctrl.addEventListener('input', run);
    })(adjCtrls[ac]);
  }

  // Action buttons write their results straight into the inputs, so the preview
  // and the eventual insert both read them back through the normal getVals path.
  var errBox = el.querySelector('.sb-btnerr');
  var actBtns = el.querySelectorAll('.sb-actbtn');
  for (var b = 0; b < actBtns.length; b++) {
    (function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var spec = null;
        for (var q = 0; q < buttons.length; q++) { if (buttons[q].id === btn.dataset.btn) spec = buttons[q]; }
        if (!spec) return;
        var res = applyButtonCode(spec.statements, getVals());
        var errs = spec.errors.concat(res.errors);
        for (var name in res.values) {
          if (!Object.prototype.hasOwnProperty.call(res.values, name)) continue;
          var target = el.querySelector('.sb-inp[data-key="' + name + '"]');
          if (!target) { errs.push('No field called ' + name); continue; }
          if (target.type === 'checkbox') { errs.push(name + ' is a multi-choice menu'); continue; }
          // A single-choice menu is a radio group now: tick the option that
          // matches. Writing to .value would rewrite the first radio's own
          // value, silently changing one of the choices on offer.
          if (target.type === 'radio') {
            var want = String(res.values[name]);
            var group = el.querySelectorAll('.sb-inp[type="radio"][data-key="' + name + '"]:not([data-other])');
            var matched = false;
            for (var r = 0; r < group.length; r++) {
              if (group[r].value === want) { group[r].checked = true; matched = true; }
            }
            if (!matched) errs.push(name + ' has no option "' + want + '"');
            _sbSyncOther(el);
            continue;
          }
          target.value = String(res.values[name]);
        }
        if (errBox) {
          errBox.textContent = errs.join(' · ');
          errBox.hidden = errs.length === 0;
        }
        updatePrev(snip);
      });
    })(actBtns[b]);
  }

  var link = _sbBindLink(el, snip);

  var closeBtn   = el.querySelector('.sb-close');
  var insertBtn  = el.querySelector('.sb-insert');

  function onCloseClick(e) { e.stopPropagation(); closeOverlay(); }
  function onInsertClick(e) {
    e.stopPropagation();
    // Guard against double-fire (touchstart + click) on mobile
    var now = Date.now();
    if (onInsertClick._last && now - onInsertClick._last < 400) return;
    onInsertClick._last = now;
    doInsert(targetEl, snip);
  }
  function onBdClose(e) {
    var now = Date.now();
    if (onBdClose._last && now - onBdClose._last < 400) return;
    onBdClose._last = now;
    closeOverlay();
  }

  closeBtn.addEventListener('click',      onCloseClick);
  closeBtn.addEventListener('touchstart', onCloseClick, {passive: false});
  insertBtn.addEventListener('click',      onInsertClick);
  insertBtn.addEventListener('touchstart', onInsertClick, {passive: false});
  bd.addEventListener('click',      onBdClose);
  bd.addEventListener('touchstart', onBdClose, {passive: false});
  el.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      var focusable = Array.prototype.slice.call(el.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')).filter(function(n) { return !n.disabled && n.getClientRects().length; });
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOverlay(); }
    if (e.key === 'Enter' && !e.shiftKey) {
      // The Link box is not a field: Enter there reads the page, and never
      // inserts a message the operator has not seen filled yet.
      // A held key repeats: only the press itself reads, so one Enter is one
      // read against the server's allowance.
      if (link && document.activeElement === link.input) {
        e.preventDefault(); e.stopPropagation();
        if (!e.repeat) link.fill();
        return;
      }
      // BUTTON excluded: the browser already activates a focused button on
      // Enter, so inserting here too would fire an action button and insert
      // the message in one keypress.
      var tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag !== 'TEXTAREA' && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'SUMMARY') {
        e.preventDefault(); e.stopPropagation(); doInsert(targetEl, snip);
      }
    }
  });
}

function xesc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── FOCUS FLOW ───────────────────────────────────────────────────────
// Enter is NOT touched. In this overlay it inserts the message, and that two
// second path is the whole point of the product. What follows only decides
// where the caret starts and where it goes after a choice is made, so nothing
// a keyboard user already relies on changes meaning.
//
// Tab is not touched either. Making it skip answered fields would be a trap:
// Tab is a browser primitive and going back to correct a field has to work.

// Typing controls only. A radio or checkbox is answered by clicking it, so it
// is a destination for the caret, never a stop on the way.
function _sbTypingInputs(root) {
  var all = root.querySelectorAll('.sb-inp[data-key]'), out = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i].type !== 'radio' && all[i].type !== 'checkbox') out.push(all[i]);
  }
  return out;
}

// Scrolling is handled by the focus listener on every input, so this only has
// to move the caret and stay quiet when there is nowhere to move it.
function _sbFocus(inp) {
  if (!inp) return;
  try { inp.focus(); } catch (e) {}
}

// The first field still waiting for an answer, else the first field. Opening on
// a date that already reads today and making the operator tab past it was the
// small daily tax this removes.
function _sbFirstEmpty(root) {
  var typed = _sbTypingInputs(root);
  for (var i = 0; i < typed.length; i++) {
    if (!typed[i].value) return typed[i];
  }
  return typed[0] || root.querySelector('.sb-inp');
}

// After a single-choice menu is answered, the next thing to fill. Only forward,
// and only past fields that already have a value, so picking an option never
// drags the caret backwards over work already done.
function _sbNextEmptyAfter(root, key) {
  var order = [], all = root.querySelectorAll('.sb-inp[data-key]');
  for (var i = 0; i < all.length; i++) {
    var k = all[i].getAttribute('data-key');
    if (order.indexOf(k) === -1) order.push(k);
  }
  var from = order.indexOf(key);
  if (from === -1) return null;
  for (var j = from + 1; j < order.length; j++) {
    var next = root.querySelector('.sb-inp[data-key="' + order[j] + '"]');
    if (next && next.type !== 'radio' && next.type !== 'checkbox' && !next.value) return next;
  }
  return null;
}

function getVals() {
  if (!overlayEl) return {};
  var v = {}, menus = {};
  var inps = overlayEl.querySelectorAll('.sb-inp[data-key]');
  for (var i = 0; i < inps.length; i++) {
    var el = inps[i], k = el.dataset.key;
    // A {formmenu:} is a group of radios (single choice) or checkboxes
    // (multiple) sharing one data-key. Every control contributes, checked or
    // not, so a group with nothing ticked still reads '' rather than dropping
    // out, and the picks keep the order the menu declares them in.
    if (el.type === 'checkbox' || el.type === 'radio') {
      var m = menus[k] || (menus[k] = { multiple: el.type === 'checkbox', picks: [], other: null });
      if (!el.checked) continue;
      // The Other choice: what its box holds is the answer.
      if (el.hasAttribute('data-other')) {
        var box = overlayEl.querySelector('.sb-othertxt[data-otherkey="' + k + '"]');
        m.other = box ? box.value : '';
      } else {
        m.picks.push(el.value);
      }
    } else {
      v[k] = el.value;
    }
  }
  // How picks and a typed answer combine is decided once, in fill-form.js.
  for (var g in menus) {
    var mm = menus[g];
    v[g] = _SBFF ? _SBFF.menuValue(mm.multiple, mm.picks, mm.other)
                 : (mm.multiple ? mm.picks.join(', ') : (mm.picks[0] || ''));
  }
  return v;
}

// The Other choice on a menu: one more radio or checkbox, then the box its
// answer is typed in, shown only while Other is ticked. The box carries
// data-otherkey rather than data-key, so nothing reads it as a field of its
// own; getVals reads it through the Other control.
function _sbOtherHtml(cfg, oType, oName) {
  if (!cfg.other) return '';
  var key = xesc(cfg.key);
  return '<label class="sb-opt"><input type="'+oType+'" class="sb-inp"'+oName+' data-key="'+key+'" data-other="1" value=""'+
           (cfg.otherOn ? ' checked' : '')+'><span>'+xesc(cfg.other)+'</span></label>' +
         '<input type="text" class="sb-inp sb-othertxt" data-otherkey="'+key+'" aria-label="'+xesc(cfg.other)+'"'+
           ' placeholder="'+xesc(_SBFF ? _SBFF.OTHER_PLACEHOLDER : '')+'" value="'+xesc(cfg.otherText)+'"'+
           (cfg.otherOn ? '' : ' hidden')+'>';
}

// Shows each Other box while its choice is ticked and hides it otherwise. On a
// single-choice menu, picking an option unticks Other without an event of its
// own, so this runs after every change rather than on the Other control alone.
function _sbSyncOther(root) {
  var ctrls = root.querySelectorAll('.sb-inp[data-other]');
  for (var i = 0; i < ctrls.length; i++) {
    var box = root.querySelector('.sb-othertxt[data-otherkey="' + ctrls[i].getAttribute('data-key') + '"]');
    if (box) box.hidden = !ctrls[i].checked;
  }
}

// How each date and time field prints, when the operator has chosen for
// itself in the Adjust panel. Output only: the value in the picker is
// untouched, so a formula and datetimediff() still read the raw date.
// A field with no panel is simply absent, and the engine keeps the format
// the author wrote.
function getFmts() {
  if (!overlayEl) return {};
  var f = {}, sels = overlayEl.querySelectorAll('.sb-fmt[data-key]');
  for (var i = 0; i < sels.length; i++) f[sels[i].dataset.key] = sels[i].value;
  return f;
}

function overlayForm(snip) {
  var other = {};
  overlayEl.querySelectorAll('.sb-inp[data-other]:checked').forEach(function(ctrl) {
    var box = overlayEl.querySelector('.sb-othertxt[data-otherkey="' + ctrl.dataset.key + '"]');
    other[ctrl.dataset.key] = box ? box.value : '';
  });
  return _SBFF.fillForm(snip.body, getVals(), { fieldCfg: snip.fieldCfg || {}, lang: snip.lang, fieldFmt: getFmts(), other: other, formatted: snip.bodyHtml || null });
}
function updatePrev(snip) {
  var box = document.getElementById('sb-prev');
  if (!box || !overlayEl) return;
  var vm = overlayForm(snip);
  if (!window.SBFillFormUI) { box.textContent = vm.preview; return; }
  window.SBFillFormUI.showPreview(box, vm);
  window.SBFillFormUI.pictureNote(document.getElementById('sb-picnote'), vm, 'left-out');
  window.SBFillFormUI.refresh(overlayEl.querySelector('.sb-fields'), vm);
}

function _showFieldsPane() {
  overlayEl.dataset.pane = 'fields';
  overlayEl.querySelectorAll('[data-pane]').forEach(function(b) { b.setAttribute('aria-pressed', String(b.dataset.pane === 'fields')); });
}

// `checked` is absent on Insert, and the warning's answer once the person
// chose to go ahead: '' or the line saying what came of "Don't warn me".
function doInsert(targetEl, snip, checked) {
  var vm = overlayForm(snip);
  if (vm.errors.length) {
    _showFieldsPane();
    window.SBFillFormUI.validate(overlayEl.querySelector('.sb-fields'), vm);
    return;
  }
  var note = typeof checked === 'string' ? checked : '';
  if (typeof checked !== 'string') {
    var found = _unfinishedFor(snip, vm.preview, vm.fields);
    if (found.length && window.SBFillFormUI && window.SBFillFormUI.unfinishedDialog) {
      // Fix it only where a box can fix it. A gap written in the snippet
      // itself is fixed in the editor.
      var canFix = found.some(function(it) { return !!it.key; });
      window.SBFillFormUI.unfinishedDialog({
        items: found,
        fields: vm.fields,
        primary: canFix ? 'fix' : 'edit',
        anyway: 'insert-anyway',
        mute: !!snip.id,
        onPrimary: function() {
          if (!overlayEl) return;
          if (canFix) {
            _showFieldsPane();
            window.SBFillFormUI.flag(overlayEl.querySelector('.sb-fields'), vm, found);
          } else {
            _openSnippetEditor(snip);
            closeOverlay();
          }
        },
        onAnyway: function(muted, done) {
          if (!muted) { if (overlayEl) doInsert(targetEl, snip, ''); return; }
          _muteUnfinished(snip, function(text) { done(); if (overlayEl) doInsert(targetEl, snip, text); });
        },
        // Back to the form exactly as it was.
        onClose: function() {}
      });
      return;
    }
  }
  var vals = getVals();
  // Read BEFORE closeOverlay tears the panel down, and passed to the same
  // resolveBody the preview used, or what lands in the field prints in a
  // different format from the preview the operator just approved.
  var text = vm.preview;
  // The text with its pictures, for a field that takes formatting.
  var html = vm.formatted && _takesFormatting(targetEl) ? vm.formatted : null;
  note = _pictureNote(note, vm, html);
  var fillCount = Object.keys(vals).length;
  closeOverlay();
  if (!targetEl) return;
  var isCE = targetEl.isContentEditable || (targetEl.getAttribute &&
    (targetEl.getAttribute('contenteditable') === 'true' || targetEl.getAttribute('contenteditable') === ''));

  // Insert over the live CE selection, then celebrate. Capture the inserted
  // region so the Undo button can delete it: same mechanism as the no-field CE
  // path in _proceedInsert (see restoreFieldState).
  function insertSyncCE() {
    var before = _ceMeasureBefore(targetEl);
    insertText(targetEl, text, html);
    var snapshot = captureFieldState(targetEl, overlayTriggerLen);
    _markSyncInserted(snapshot, targetEl, before, text, html ? vm : null);
    showCelebration(
      text,
      function onConfirm() { logEvent(snip, fillCount); },
      function onUndo()    { restoreFieldState(snapshot); },
      { inserted: true, target: targetEl, warning: reviewWarning(snip), note: note }
    );
  }

  if (isCE && overlayTriggerLen > 0) {
    // CE field overlay: the trigger was never actually deleted (deleteChars only
    // set a selection at match time, which this overlay's focus then wiped).
    // Re-select the trigger and replace it atomically while the selection is live
    // — exactly how the no-field CE path inserts. Without this the literal
    // ::trigger survives and nothing is inserted.
    //
    // Prefer the caret offset recorded when the overlay opened: walking back from
    // the LIVE caret only works in editors that restore their own selection on
    // focus. A plain contenteditable puts the caret back at the start, so the walk
    // found nothing and the trigger stayed in the field. deleteChars remains the
    // fallback for editors whose DOM offsets we could not read.
    if (_ceRestoreTriggerRange(targetEl, overlayCaretCO, overlayTriggerLen)) {
      insertSyncCE();
    } else {
      deleteChars(targetEl, overlayTriggerLen, insertSyncCE);
    }
  } else if (isCE) {
    // The form also takes focus when opened from the picker or context menu.
    // Restore the original caret/selection before inserting, just as for triggers.
    if (overlaySelectionStartCO >= 0) {
      _ceRestoreTriggerRange(targetEl, overlayCaretCO, overlayCaretCO - overlaySelectionStartCO);
    }
    insertSyncCE();
  } else {
    // Textarea/input: the trigger was already stripped before the overlay opened.
    // Defer insertion to confirm so Undo can simply skip it — identical to the
    // no-field non-CE path. insertText() refocuses the field itself.
    var snapshot = captureFieldState(targetEl, overlayTriggerLen);
    showCelebration(
      text,
      function onConfirm() { insertText(targetEl, text); logEvent(snip, fillCount); },
      function onUndo()    { restoreFieldState(snapshot); },
      { inserted: false, target: targetEl, warning: reviewWarning(snip), note: note }
    );
  }
}

function closeOverlay() {
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  var bd = document.getElementById('sb-bd');
  if (bd) bd.remove();
  if (overlayDone) { overlayDone(); overlayDone = null; }
}

function removeOverlay() { closeOverlay(); }

// ── FIELD STATE SNAPSHOT (for Undo) ───────────────────────────────
// Positions in a field are counted in characters. Gmail shows every emoji it is
// given as a picture (<img alt="☺️">) with no text behind it, so counted as
// nothing, a snippet holding one measured shorter in the field than it is: Undo
// then started that many characters early, taking the end of what was typed
// before the snippet ("Hola " came back as "Hol"), and stopped in front of the
// picture, leaving the emoji behind. A picture standing for an emoji counts as
// the characters it shows, everywhere a position is measured.
var EMOJI_IN_ALT_RE = /\p{Extended_Pictographic}/u;

// The emoji an <img> stands for, or '' for any other node. A picture whose alt
// holds letters or digits (":smile:", a logo) is not an emoji and counts as
// nothing, as before.
function _ceEmojiPictureText(node) {
  if (!node || node.nodeType !== 1 || node.tagName !== 'IMG') return '';
  var alt = node.getAttribute('alt') || '';
  return (EMOJI_IN_ALT_RE.test(alt) && !/[A-Za-z0-9]/.test(alt)) ? alt : '';
}

// The characters a node contributes to a position: a text node's text, an emoji
// picture's emoji.
function _ceUnitText(node) {
  return typeof node.nodeValue === 'string' ? node.nodeValue : _ceEmojiPictureText(node);
}

// Visits, in order, every text node and emoji picture inside `host`.
function _ceUnitWalker(host) {
  return document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: function(n) {
      return (n.nodeType === 3 || _ceEmojiPictureText(n)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
}

// The field's text as positions count it: emoji pictures read as their emoji.
function _ceVisibleText(host) {
  var tw = _ceUnitWalker(host), node, out = '';
  while ((node = tw.nextNode())) out += _ceUnitText(node);
  return out;
}

// Characters inside `range`, counting each emoji picture it holds.
function _ceRangeLength(range, host) {
  var n = range.toString().length;
  var pictures = host.querySelectorAll ? host.querySelectorAll('img') : [];
  for (var i = 0; i < pictures.length; i++) {
    var shown = _ceEmojiPictureText(pictures[i]);
    if (shown && range.intersectsNode(pictures[i])) n += shown.length;
  }
  return n;
}

// Character offset of the current caret within `host`: block boundaries and
// <br> contribute nothing, a line break that landed as a "\n" character
// (white-space: pre-wrap) counts as one, an emoji picture as its emoji.
// `fromStart` reads where a selection starts instead of where it ends.
// Returns -1 if the caret isn't inside the host.
function _ceCaretCharOffset(host, fromStart) {
  try {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !host) return -1;
    var r = sel.getRangeAt(0);
    var node = fromStart ? r.startContainer : r.endContainer;
    var offset = fromStart ? r.startOffset : r.endOffset;
    if (host !== node && !host.contains(node)) return -1;
    var pre = document.createRange();
    pre.selectNodeContents(host);
    pre.setEnd(node, offset);
    return _ceRangeLength(pre, host);
  } catch(_) { return -1; }
}

// The DOM position just before or just after `node`, in its parent.
function _cePointBeside(node, after) {
  var i = 0, c = node.parentNode.firstChild;
  while (c && c !== node) { i++; c = c.nextSibling; }
  return { node: node.parentNode, offset: after ? i + 1 : i };
}

// Inverse of _ceCaretCharOffset: resolve a character offset within `host` to a
// concrete {node, offset} DOM position. An offset that falls between two text
// nodes resolves to the end of the first. `atStart` asks for the start of the
// second instead, for the start of a range: otherwise the range also takes
// whatever sits between them, and a snippet typed at the start of a new line
// replaced, or on Undo removed, the line break in front of it. An emoji picture
// is one piece: an offset that lands inside it resolves to just before it.
function _ceCharOffsetToPoint(host, target, atStart) {
  var tw = _ceUnitWalker(host);
  var acc = 0, node, last = null;
  while ((node = tw.nextNode())) {
    var len = _ceUnitText(node).length;
    if (acc + len > target || (acc + len === target && !atStart)) {
      if (typeof node.nodeValue === 'string') return { node: node, offset: Math.max(0, target - acc) };
      return _cePointBeside(node, acc + len === target);
    }
    acc += len;
    last = node;
  }
  if (last && acc === target) {
    return typeof last.nodeValue === 'string' ? { node: last, offset: last.nodeValue.length } : _cePointBeside(last, true);
  }
  return { node: host, offset: host.childNodes ? host.childNodes.length : 0 };
}

// Re-select the N characters ending at a caret offset captured earlier, so the
// next insertText replaces them (N = 0 just puts the caret back). Used when the
// live selection can no longer be trusted because a modal held focus in between
// (the field overlay, the {{name}} fill-in box). Returns false when the offset
// is unusable, leaving the caller its live-selection path.
// True when focus is already inside the editable field that holds `el`. Asking
// whether the focused element contains `el` instead also says yes when focus
// sits on the page itself (document.body contains everything), which is where
// it falls the moment one of our windows closes.
function _ceFocusInHost(el) {
  var host = _ceHost(el);
  var active = document.activeElement;
  return !!(host && active && (active === host || host.contains(active)));
}

function _ceRestoreTriggerRange(el, caretCO, n) {
  try {
    if (typeof caretCO !== 'number' || n < 0 || caretCO < n) return false;
    var host = _ceHost(el);
    if (!host) return false;
    // Focus the field BEFORE selecting the trigger. Gmail moves its caret back
    // to where it last was when the field regains focus; with focus left on the
    // page, that happened after the selection was set, so the trigger stayed
    // and the snippet landed after it ("::timeBuenos días…", or "::ti…").
    if (!_ceFocusInHost(el)) {
      try { host.focus(); } catch(e) { console.error('[Fibonax] could not focus the field', e); }
    }
    var sp = _ceCharOffsetToPoint(host, caretCO - n, n > 0);
    var ep = _ceCharOffsetToPoint(host, caretCO);
    var r = document.createRange();
    r.setStart(sp.node, sp.offset);
    r.setEnd(ep.node, ep.offset);
    if ((n > 0 && r.collapsed) || r.toString().length !== n) return false;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  } catch(_) { return false; }
}

function captureFieldState(el, triggerLen) {
  var isCE = el.isContentEditable || (el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''));
  if (isCE) return { type: 'ce', el: el, triggerLen: triggerLen || 0 };
  return { type: 'value', el: el, triggerLen: triggerLen || 0 };
}

// What a field holds just before an insertion, in _ceCaretCharOffset's units:
// where the selection the snippet replaces starts and ends, and the field's
// whole length. _markSyncInserted measures the snippet against it.
function _ceMeasureBefore(el) {
  var host = _ceHost(el);
  return {
    start: _ceCaretCharOffset(host, true),
    end: _ceCaretCharOffset(host),
    total: host ? _ceVisibleText(host).length : -1,
    // The pictures, line breaks, lines and lists already there, so Undo never
    // takes one of them.
    imgs: host ? Array.prototype.slice.call(host.querySelectorAll('img')) : [],
    brs: host ? Array.prototype.slice.call(host.querySelectorAll('br')) : [],
    blocks: host ? Array.prototype.slice.call(host.querySelectorAll(_CE_BLOCKS)) : []
  };
}

// Records the region a contenteditable insertion just wrote, for Undo: its
// length and the character offset where it ends, both in _ceCaretCharOffset's
// unit. `before` is _ceMeasureBefore's reading, taken before insertText.
// Lexical writes a pasted body a moment after insertText returns, so there the
// live caret still sits in front of the snippet and Undo would delete the text
// before it; the end is counted from the start instead. Every other editor has
// written it already, and its live caret stays the truth.
//
// The length is measured, not counted: the field grew by the snippet less what
// it replaced. Counting the snippet's own text was wrong wherever the editor
// tidies text as it lands. Gmail drops a space at the end of a line and shows
// an emoji as a picture, so Undo was a character or two out: it took the end of
// what was typed before the snippet ("Hola " came back as "Hol"), or left the
// snippet's first letter behind. The count stays as the fallback for an editor
// that has not written the text yet when this runs.
// `vm` is the fill form of a formatted insert, whose pictures, lines and lists
// Undo takes out too (_ceRemoveFormatted); null for text alone.
function _markSyncInserted(snapshot, el, before, text, vm) {
  var host = _ceHost(el);
  var startCO = before ? before.start : -1;
  snapshot.syncInserted = true;
  if (vm && vm.formatted && before) {
    snapshot.formatted = {
      imgs: before.imgs, brs: before.brs, blocks: before.blocks, pictures: _formattedPictures(vm),
      // An email copied from Gmail ends with a line break, which lands after
      // its last table.
      trailingBreak: /<br\s*\/?>\s*$/i.test(String(vm.formatted))
    };
  }
  snapshot.visibleLen = String(text).replace(/[\r\n]/g, '').length;
  if (_isLexicalHost(host) && startCO >= 0) {
    snapshot.endCharOffset = startCO + snapshot.visibleLen;
    return;
  }
  snapshot.endCharOffset = _ceCaretCharOffset(host);
  if (before && before.total >= 0 && startCO >= 0 && before.end >= startCO) {
    var grew = _ceVisibleText(host).length - before.total + (before.end - startCO);
    if (grew > 0) { snapshot.visibleLen = grew; return; }
  }
  // Fallback count: walk back from the caret over the snippet, last line
  // first, and count each line break that landed as a "\n" character (a field
  // styled white-space: pre-wrap). A break that landed as a <br> counts nothing.
  var upToCaret = snapshot.endCharOffset > 0 ? _ceVisibleText(host).slice(0, snapshot.endCharOffset) : '';
  var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  var at = upToCaret.length - lines[lines.length - 1].length;
  for (var i = lines.length - 2; i >= 0; i--) {
    if (upToCaret.charAt(at - 1) === '\n') { snapshot.visibleLen++; at--; }
    at -= lines[i].length;
  }
}

// A space left at the end of a line is not drawn, and Chrome drops it the moment
// typing resumes: "Hi " undone, then "there" typed, read "Hithere". While a space
// is typed at a line end the browser keeps it as a non-breaking one and turns it
// into a normal one once a character follows, which the snippet's first letter
// did. Range.deleteContents skips that clean-up, so it is done here: a space with
// nothing drawn for it becomes a non-breaking one again. A field that keeps its
// spaces (white-space: pre-wrap) still draws it, and the space stays as it is.
// `at` is where the removed snippet began.
function _ceHoldSpace(at) {
  try {
    var node = at.node, k = at.offset;
    if (!node || node.nodeType !== 3 || k < 1 || node.nodeValue.charAt(k - 1) !== ' ') return;
    var r = document.createRange();
    r.setStart(node, k - 1);
    r.setEnd(node, k);
    var drawn = r.getClientRects();
    if (drawn.length && drawn[0].width === 0) node.replaceData(k - 1, 1, '\u00a0');
  } catch(e) { console.error('[Fibonax] could not keep the space before the snippet', e); }
}

// The elements a formatted insert adds as lines and lists, and the ones an
// email layout adds: tables with their rows and cells, headings, quotes, a
// centred block, a rule.
var _CE_BLOCKS = 'div,p,ul,ol,li,table,thead,tbody,tfoot,tr,td,th,blockquote,h1,h2,h3,h4,h5,h6,center,hr';

// Takes out what a formatted insert left once its text is gone, all of it new
// since the insert. The pictures that show one of the snippet's pictures (by
// address, or by description where the editor moved the picture to its own
// address): text offsets cannot find them, a picture holds no characters. The
// line break beside such a picture, or one at the end of the snippet would
// leave an empty line. Then the lines, lists, tables, rows and cells left with
// nothing in them, the innermost first, or an empty numbered item, or a card's
// table with its borders and colours, stays behind. The line break an email
// layout ends with lands after its last table and goes with it. Returns how
// many nodes went.
function _ceRemoveFormatted(host, snapshot) {
  var p = snapshot.formatted;
  if (!host || !p) return 0;
  var removed = 0;
  var newBreak = function(from, side) {
    var node = from[side];
    while (node && node.nodeType === 3 && node.nodeValue === '') node = node[side];
    return node && node.nodeName === 'BR' && p.brs.indexOf(node) === -1 ? node : null;
  };
  Array.prototype.slice.call(host.querySelectorAll('img')).forEach(function(img) {
    if (p.imgs.indexOf(img) !== -1) return;
    var mine = p.pictures.some(function(pic) {
      return img.getAttribute('src') === pic.src || (!!pic.alt && img.getAttribute('alt') === pic.alt);
    });
    if (!mine || !img.parentNode) return;
    var br = newBreak(img, 'previousSibling') || newBreak(img, 'nextSibling');
    if (br) br.parentNode.removeChild(br);
    img.parentNode.removeChild(img);
    removed++;
  });
  // Pasting a block over a trigger that had a line break right after it, the
  // editor takes that break as the block's own and drops it (Chrome). The
  // layout's trailing break then stands in for it and stays.
  var lostBreaks = p.brs.some(function(br) { return !host.contains(br); });
  Array.prototype.slice.call(host.querySelectorAll(_CE_BLOCKS)).reverse().forEach(function(block) {
    if (p.blocks.indexOf(block) !== -1 || !block.parentNode) return;
    if (block.textContent.replace(/[\s\u00a0]+/g, '') !== '' || block.querySelector('img')) return;
    var br = p.trailingBreak && !lostBreaks ? newBreak(block, 'nextSibling') : null;
    if (br) { br.parentNode.removeChild(br); removed++; }
    block.parentNode.removeChild(block);
    removed++;
  });
  // A card pasted into the middle of a line splits the line: the rest of it
  // goes into a new block of the same kind after the card. With the card gone,
  // the rest goes back onto its line.
  var startCO = typeof snapshot.endCharOffset === 'number' && typeof snapshot.visibleLen === 'number'
    ? Math.max(0, snapshot.endCharOffset - snapshot.visibleLen) : -1;
  if (startCO >= 0) {
    var at = _ceCharOffsetToPoint(host, startCO);
    var line = at.node === host ? null : (at.node.nodeType === 1 ? at.node : at.node.parentNode);
    while (line && line !== host && !(line.matches && line.matches(_CE_BLOCKS))) line = line.parentNode;
    var rest = line && line !== host && p.blocks.indexOf(line) !== -1 ? line.nextSibling : null;
    while (rest && rest.nodeType === 3 && rest.nodeValue === '') rest = rest.nextSibling;
    if (rest && rest.nodeType === 1 && rest.tagName === line.tagName && p.blocks.indexOf(rest) === -1) {
      var holder = line.lastChild;
      if (holder && holder.nodeName === 'BR' && p.brs.indexOf(holder) === -1) line.removeChild(holder);
      while (rest.firstChild) line.appendChild(rest.firstChild);
      rest.parentNode.removeChild(rest);
      removed++;
    }
  }
  return removed;
}

function restoreFieldState(snapshot) {
  if (!snapshot || !snapshot.el) return;
  var el = snapshot.el;
  try {
    if (snapshot.type === 'ce') {
      if (snapshot.syncInserted) {
        // The snippet was inserted synchronously, REPLACING the trigger. So the
        // field's pre-trigger state == the field with the inserted region removed.
        //
        // Native execCommand('undo') is unusable for this: a large multi-block body
        // produces more undo transactions than the editor keeps, so it can never
        // fully revert (confirmed: 7 undos, fragment still stranded). Selecting the
        // inserted region and deleting via execCommand is also unreliable — the
        // editor collapses programmatic multi-block selections before the delete.
        //
        // Instead, delete the inserted region straight from the DOM with a Range
        // (Range.deleteContents bypasses both the undo stack and selection
        // normalization). The region is [endCharOffset - visibleLen, endCharOffset)
        // measured in text characters from the host start — captured the instant the
        // insertion finished — resolved to live DOM points at undo time, so it is
        // immune to node re-identity. The caret collapses to where the trigger began.
        if (document.activeElement !== el && !document.activeElement.contains(el)) {
          try { el.focus(); } catch(_) {}
        }
        var hostU = _ceHost(el);
        var endCO = (typeof snapshot.endCharOffset === 'number') ? snapshot.endCharOffset : -1;
        var vlen  = (typeof snapshot.visibleLen === 'number') ? snapshot.visibleLen : 0;
        var _ok = false;
        if (hostU && endCO >= 0 && vlen > 0) {
          try {
            var startCO = Math.max(0, endCO - vlen);
            var sp = _ceCharOffsetToPoint(hostU, startCO, true);
            var ep = _ceCharOffsetToPoint(hostU, endCO);
            var delR = document.createRange();
            delR.setStart(sp.node, sp.offset);
            delR.setEnd(ep.node, ep.offset);
            if (_isLexicalHost(hostU)) {
              // Lexical puts back the nodes a Range deletion removes (its line
              // breaks), so a multi-line snippet only half came out. Hand it the
              // deletion through its own input model, as the trigger is.
              var selL = window.getSelection();
              selL.removeAllRanges();
              selL.addRange(delR);
              _ceDeleteSelection(hostU);
              return;
            }
            delR.deleteContents();
            _ceHoldSpace(sp);
            try {
              var caretR = document.createRange();
              caretR.setStart(sp.node, sp.offset);
              caretR.collapse(true);
              var selR = window.getSelection();
              selR.removeAllRanges();
              selR.addRange(caretR);
            } catch(_c) { try { hostU.focus(); } catch(_f) {} }
            try { hostU.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })); }
            catch(_e) { try { hostU.dispatchEvent(new Event('input', { bubbles: true })); } catch(_e2) {} }
            _ok = true;
          } catch(_) {}
        }
        if (_ceRemoveFormatted(hostU, snapshot)) _ok = true;
        if (!_ok) {
          // Offsets unavailable (selection wasn't captured) — best-effort native undo.
          try { document.execCommand('undo', false, null); } catch(_) {}
        }
        return;
      }
      // deleteChars for CE only SET the selection spanning the trigger (no DOM
      // change). The trigger is still in the field, selected. Atomically delete
      // it via execCommand('insertText', '') — same mechanism insertText uses on
      // confirm, so Lexical/Gmail/Slack handle it as a single beforeinput event.
      if (document.activeElement !== el && !document.activeElement.contains(el)) {
        try { el.focus(); } catch(_) {}
      }
      var sel = window.getSelection();
      var canAtomicDelete = sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed;
      if (canAtomicDelete) {
        try { document.execCommand('insertText', false, ''); } catch(_) {}
      } else if (typeof snapshot.triggerLen === 'number' && snapshot.triggerLen > 0) {
        // Fallback: selection was reset (rare). Re-select N chars backward from
        // the current caret and delete them.
        try {
          var sel2 = window.getSelection();
          if (sel2 && sel2.rangeCount > 0) {
            var r  = sel2.getRangeAt(0);
            var bk = _ceWalkBackChars(_ceHost(el), r.endContainer, r.endOffset, snapshot.triggerLen);
            var nr = document.createRange();
            nr.setStart(bk.node, bk.offset);
            nr.setEnd(r.endContainer, r.endOffset);
            sel2.removeAllRanges();
            sel2.addRange(nr);
            document.execCommand('insertText', false, '');
          }
        } catch(_) {}
      }
    } else {
      if (snapshot.syncInsertedValue) {
        // Context-menu insert ran synchronously (insertion already happened, not
        // deferred). Restore the exact pre-insert value + caret via the native
        // setter so React-controlled fields register the change, then emit input.
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, snapshot.prevValue);
        else el.value = snapshot.prevValue;
        try { el.focus(); } catch(_) {}
        if (snapshot.prevSelStart != null && snapshot.prevSelEnd != null) {
          try { el.setSelectionRange(snapshot.prevSelStart, snapshot.prevSelEnd); } catch(_) {}
        }
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
        return;
      }
      // textarea / input: deleteChars already stripped the trigger from el.value
      // BEFORE the celebration appeared, and insertText was deferred — never
      // fired. The field is already in the clean post-undo state. Just refocus.
      try { el.focus(); } catch(_) {}
    }
  } catch(e) {}
}

// ── EXPANSION SUMMARY ─────────────────────────────────────────────
var activeCelebrationClose = null;

function _expansionSummary(text) {
  var body = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
  var characters = Array.from(body).length;
  // Keep the extension's existing typing assumption, shown explicitly in the UI.
  // This is a length-based estimate, not measured personal typing speed.
  var seconds = Math.round(characters / 3.3);
  var timeLabel = seconds + ' sec';
  if (seconds >= 3600) {
    timeLabel = Math.floor(seconds / 3600) + ' hr ' + Math.floor((seconds % 3600) / 60) + ' min';
  } else if (seconds >= 60) {
    timeLabel = Math.floor(seconds / 60) + ' min ' + (seconds % 60) + ' sec';
  }
  return { words: body ? body.split(/\s+/).length : 0,
    characters: characters, seconds: seconds, timeLabel: timeLabel };
}

// Review status (AI-KNOWLEDGE P2). Archived snippets never reach this script:
// the worker and the popup leave them out of the expansion cache. A deprecated
// one still expands, and the inserted-text card carries this line instead of
// its usual description. Same words as the popup and the phone.
function reviewWarning(snip) {
  return snip && snip.review_status === 'deprecated'
    ? 'This snippet is deprecated. Check it is still right before you send it.'
    : '';
}

// ── BEFORE IT GOES OUT ────────────────────────────────────────────
// Right before a snippet goes into the page, its finished text is read through
// SBFillForm.unfinished() (extension/shared/fill-form.js), the same check the
// popup, the editor preview and the phone run. When something looks unfinished
// ("[xxx]", "{fill this in}", an empty box) the warning in fill-form-ui.js
// opens first, and the person fixes it or goes ahead.

var SB_EDITOR_URL = 'https://app.fibonax.com/?snippet=';

// What looks unfinished in a text about to be inserted, or [] for a snippet
// someone asked not to be warned about. A {{placeholder}} left empty in the
// fill-in box has already been printed as nothing, so it is named here.
function _unfinishedFor(snip, text, fields) {
  if (!_SBFF || !_SBFF.unfinished || !_SBFF.checksUnfinished(snip)) return [];
  var blanks = (snip && snip.blankPlaceholders) || [];
  return blanks.map(function(name) {
    return { kind: 'empty', text: name.replace(/_/g, ' '), reason: _SBFF.unfinishedText('empty'), key: '', start: -1 };
  }).concat(_SBFF.unfinished(text, fields || []));
}

// Opens this snippet in the dashboard editor, in a new tab.
function _openSnippetEditor(snip) {
  if (!snip || !snip.id) return;
  try { window.open(SB_EDITOR_URL + encodeURIComponent(snip.id), '_blank', 'noopener'); }
  catch (e) { console.error('[Fibonax] could not open the snippet editor', e); }
}

// Saves "Don't warn me about this snippet again" through the worker, which
// holds the session, and answers with the line the summary card shows: that
// it worked, or that it did not. The worker writes the cache itself, so the
// next expansion of this snippet already skips the check.
function _muteUnfinished(snip, done) {
  var settled = false;
  function end(ok) {
    if (settled) return;
    settled = true;
    done(_SBFF.unfinishedText(ok ? 'muted' : 'mute-failed'));
  }
  var timer = setTimeout(function() { end(false); }, 8000);
  try {
    chrome.runtime.sendMessage({ type: 'snippet_check_unfinished', id: snip.id, on: false }, function(res) {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        console.error('[Fibonax] could not save the unfinished-text switch:', chrome.runtime.lastError.message);
        end(false);
        return;
      }
      end(!!(res && res.ok));
    });
  } catch (e) {
    clearTimeout(timer);
    console.error('[Fibonax] could not save the unfinished-text switch', e);
    end(false);
  }
}

// For a snippet with no form. go(note) runs at once when nothing looks
// unfinished, so the usual path is exactly what it was. Otherwise the warning
// opens first. It takes the focus, and with it the selection the snippet is
// about to replace, so that selection is read now and put back before either
// answer: go(note) to insert, or stop() when the person goes back. stop()
// then leaves the field as the summary card's Cancel does.
function _checkThenInsert(el, snip, text, go, stop) {
  var items = _unfinishedFor(snip, text, []);
  if (!items.length || !window.SBFillFormUI) { go(''); return; }
  var host = (el && _isCEEl(el)) ? _ceHost(el) : null;
  var endCO = host ? _ceCaretCharOffset(host) : -1;
  var startCO = host ? _ceCaretCharOffset(host, true) : -1;
  // Puts the selection back; false when a rich editor's offsets no longer
  // resolve. A plain box keeps its own selection while it is out of focus.
  function reselect() {
    if (host && endCO >= 0 && startCO >= 0) return _ceRestoreTriggerRange(el, endCO, endCO - startCO);
    if (el && el.isConnected && typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
    return true;
  }
  function proceed(note) {
    var n = endCO - startCO;
    if (!reselect() && n > 0) {
      deleteChars(el, n, function() { go(note); });
      return;
    }
    go(note);
  }
  function back() {
    reselect();
    stop();
  }
  window.SBFillFormUI.unfinishedDialog({
    items: items,
    primary: 'edit',
    anyway: 'insert-anyway',
    mute: !!(snip && snip.id),
    onPrimary: function() { _openSnippetEditor(snip); back(); },
    onAnyway: function(muted, done) {
      if (!muted) { proceed(''); return; }
      _muteUnfinished(snip, function(note) { done(); proceed(note); });
    },
    onClose: back
  });
}

function _celEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Whether the reader asked for less motion. A page can replace or remove
// matchMedia, and a missing one must not stop the card opening: it then
// reads as "no preference", the browser default.
function _prefersReducedMotion() {
  try {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch (e) {
    return false;
  }
}

function _celebrationBurst(card) {
  if (_prefersReducedMotion()) return;
  // Decoration only: with no icon to sit on, the card simply has no burst.
  var symbol = card.querySelector('.sb-cel-symbol');
  if (!symbol) return;
  var burst = document.createElement('span');
  burst.className = 'sb-cel-confetti';
  burst.setAttribute('aria-hidden', 'true');
  // One small burst around the status icon; no page-wide canvas or extra timer.
  for (var i = 0; i < 12; i++) {
    var piece = document.createElement('i');
    var angle = (i / 12) * Math.PI * 2;
    var distance = i % 2 ? 24 : 30;
    piece.style.setProperty('--cel-x', Math.round(Math.cos(angle) * distance) + 'px');
    piece.style.setProperty('--cel-y', Math.round(Math.sin(angle) * distance) + 'px');
    piece.style.setProperty('--cel-turn', (i % 2 ? 150 : -150) + 'deg');
    burst.appendChild(piece);
  }
  burst.addEventListener('animationend', function() { burst.remove(); }, { once: true });
  symbol.appendChild(burst);
}

function showCelebration(text, onConfirm, onUndo, options) {
  // Settle the previous card before capturing focus or installing a new timer.
  if (activeCelebrationClose) activeCelebrationClose();
  options = options || {};
  var inserted = options.inserted !== false;
  var canUndo = typeof onUndo === 'function';
  // A deprecated snippet still expands; the card says so (AI-KNOWLEDGE P2).
  var warning = typeof options.warning === 'string' ? options.warning : '';
  // What came of "Don't warn me about this snippet again", when it was ticked.
  var note = typeof options.note === 'string' ? options.note : '';
  var summary = _expansionSummary(text);
  var returnFocus = options.target || document.activeElement;
  var savedStart = returnFocus && typeof returnFocus.selectionStart === 'number' ? returnFocus.selectionStart : null;
  var savedEnd = savedStart !== null ? returnFocus.selectionEnd : null;
  var savedDirection = savedStart !== null ? returnFocus.selectionDirection : null;
  var savedRange = null;
  var selection = window.getSelection();
  if (savedStart === null && selection && selection.rangeCount) {
    savedRange = selection.getRangeAt(0).cloneRange();
  }

  var bd = document.createElement('div');
  bd.id = 'sb-cel-bd';
  bd.setAttribute('aria-hidden', 'true');
  var card = document.createElement('div');
  card.id = 'sb-celebrate';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'sb-cel-title');
  card.setAttribute('aria-describedby', 'sb-cel-description');
  card.setAttribute('tabindex', '-1');
  var closeLabel = inserted ? 'Close summary' : 'Cancel insertion';
  card.innerHTML =
    '<div class="sb-cel-header">' +
      '<span class="sb-cel-brand">Fibonax<span class="sb-cel-brand-detail"> / Text expansion</span></span>' +
      '<button type="button" id="sb-cel-skip" class="sb-cel-close" aria-label="' + closeLabel + '">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="sb-cel-body">' +
      '<div class="sb-cel-heading">' +
        '<span class="sb-cel-symbol" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          (inserted ? '<path d="m5 12 4 4L19 6"/>' : '<path d="M4 6h16M4 12h10M4 18h7M18 14v8M14 18h8"/>') +
        '</svg></span>' +
        '<h2 id="sb-cel-title">' + (inserted ? 'Text inserted' : 'Ready to insert') + '</h2>' +
      '</div>' +
      (warning
        ? '<p id="sb-cel-description" class="sb-cel-warn" role="alert">' + _celEsc(warning) + '</p>'
        : '<p id="sb-cel-description">' + (inserted ? 'Your text is ready in the current field.' : 'Your text is ready for the current field.') + '</p>') +
      (note ? '<p class="sb-cel-note" role="status">' + _celEsc(note) + '</p>' : '') +
      '<div class="sb-cel-time">' +
        '<span class="sb-cel-label">' + (inserted ? 'Estimated time saved' : 'Estimated typing time') + '</span>' +
        '<strong id="sb-cel-time-value">' + summary.timeLabel + '</strong>' +
        '<span class="sb-cel-assumption">Based on typing 3.3 characters per second.</span>' +
      '</div>' +
      '<dl class="sb-cel-metrics">' +
        '<div><dt>Words</dt><dd id="sb-cel-words">' + summary.words.toLocaleString('en-US') + '</dd></div>' +
        '<div><dt>Characters</dt><dd id="sb-cel-characters">' + summary.characters.toLocaleString('en-US') + '</dd></div>' +
      '</dl>' +
    '</div>' +
    '<div class="sb-cel-footer">' +
      '<div class="sb-cel-actions">' +
        (canUndo ? '<button type="button" id="sb-cel-undo" class="sb-cel-secondary">' + (inserted ? 'Undo insertion' : 'Cancel') + '</button>' : '') +
        '<button type="button" id="sb-cel-ok" class="sb-cel-primary">' + (inserted ? 'Done' : 'Insert text') + '</button>' +
      '</div>' +
      '<div class="sb-cel-timer"><span id="sb-cel-cd">' + (inserted ? 'Closes' : 'Inserts') + ' in 5s</span><span>Esc to ' + (inserted ? 'close' : 'cancel') + '</span></div>' +
      '<div class="sb-cel-track" aria-hidden="true"><div id="sb-cel-bar"></div></div>' +
    '</div>';

  document.body.appendChild(bd);
  document.body.appendChild(card);
  var settled = false;
  var paused = false;
  var autoCloseTimer;
  var countdownIv;
  var barEl = card.querySelector('#sb-cel-bar');
  var cdEl = card.querySelector('#sb-cel-cd');
  var reducedMotion = _prefersReducedMotion();

  // Focus goes back only if the card still holds it. If the page took it back
  // while the card was open, or the person clicked somewhere else, focus and
  // caret are already where they belong.
  function restoreFocus(cardHadFocus) {
    if (!cardHadFocus) return;
    if (!returnFocus || !returnFocus.isConnected || typeof returnFocus.focus !== 'function') return;
    returnFocus.focus({ preventScroll: true });
    if (savedStart !== null && typeof returnFocus.setSelectionRange === 'function') {
      returnFocus.setSelectionRange(savedStart, savedEnd, savedDirection || 'none');
    } else if (savedRange && savedRange.startContainer.isConnected && savedRange.endContainer.isConnected) {
      var sel = window.getSelection();
      // An editor that writes the text after this card opened (WhatsApp's)
      // has already put its caret after it. The range saved at open still
      // covers the shortcut, and restoring it sent the caret back to the start
      // of the message. Fall back on it only when the caret left the field.
      var caretInField = sel && sel.rangeCount > 0 && returnFocus.contains(sel.getRangeAt(0).endContainer);
      if (sel && !caretInField) { sel.removeAllRanges(); sel.addRange(savedRange); }
    }
  }

  function settle(callback) {
    if (settled) return;
    settled = true;
    clearTimeout(autoCloseTimer);
    clearInterval(countdownIv);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', pauseOnFocus, true);
    // Read before the card goes: removing it moves the browser's focus away.
    var cardHadFocus = card.contains(document.activeElement);
    card.remove();
    bd.remove();
    if (activeCelebrationClose === close) activeCelebrationClose = null;
    restoreFocus(cardHadFocus);
    if (typeof callback === 'function') callback();
  }

  function confirm() { settle(onConfirm); }
  function undo() { settle(onUndo); }
  function close() { if (inserted || !canUndo) confirm(); else undo(); }
  activeCelebrationClose = close;

  function pause() {
    if (settled || paused) return;
    paused = true;
    clearTimeout(autoCloseTimer);
    clearInterval(countdownIv);
    cdEl.textContent = inserted ? 'Auto-close paused' : 'Auto-insert paused';
    // Freeze the remaining time in place so the progress bar stays visible
    // while the countdown is paused.
  }

  // Only a pointer that moves over the card pauses it. The card opens right
  // where the person just clicked (a language, Insert message), so the pointer
  // is usually already resting on it: that used to pause the countdown at
  // once, and the card never closed on its own. A few pixels of hand tremor do
  // not count as moving.
  var pointerFrom = null;
  function pauseOnPointerMove(event) {
    if (!pointerFrom) { pointerFrom = { x: event.clientX, y: event.clientY }; return; }
    var dx = event.clientX - pointerFrom.x, dy = event.clientY - pointerFrom.y;
    if (dx * dx + dy * dy > 100) pause();
  }

  // The card takes focus once, when it opens, and never pulls it back. WhatsApp
  // moves focus to its editor the moment it finishes placing the text, and the
  // card used to grab it straight back: the two took it from each other about
  // once a millisecond and the tab froze. Focus moving onto one of the card's
  // own buttons still pauses the countdown.
  function pauseOnFocus(event) {
    if (card.contains(event.target) && event.target !== card) pause();
  }

  function onKey(event) {
    if (settled) return;
    if (event.key === 'Escape') {
      // Esc closes the card wherever focus is, and the page does not get it too.
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    // Keys typed while the page holds focus belong to the page: the person can
    // keep writing, or press Enter to send, while the card counts down.
    if (!card.contains(document.activeElement)) return;
    // Host editors must not act on a key intended for this dialog.
    event.stopPropagation();
    pause();
    if (event.key === 'Tab') {
      var buttons = card.querySelectorAll('button');
      var first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === card)) {
        event.preventDefault(); first.focus();
      }
    }
  }

  card.querySelector('#sb-cel-ok').addEventListener('click', confirm);
  card.querySelector('#sb-cel-skip').addEventListener('click', close);
  if (canUndo) card.querySelector('#sb-cel-undo').addEventListener('click', undo);
  bd.addEventListener('click', close);
  card.addEventListener('pointermove', pauseOnPointerMove);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', pauseOnFocus, true);
  card.focus({ preventScroll: true });

  var started = Date.now();
  countdownIv = setInterval(function() {
    var remaining = Math.max(0, 5000 - (Date.now() - started));
    // Reduced motion keeps a visible bar, updated in discrete one-second steps.
    var progress = reducedMotion ? Math.ceil(remaining / 1000) / 5 : remaining / 5000;
    barEl.style.transform = 'scaleX(' + progress + ')';
    cdEl.textContent = (inserted ? 'Closes' : 'Inserts') + ' in ' + Math.ceil(remaining / 1000) + 's';
  }, 100);
  autoCloseTimer = setTimeout(confirm, 5000);
  if (!warning && summary.characters > 0) _celebrationBurst(card);
}

// ── INLINE TRIGGER PICKER ──────────────────────────────────────────
var triggerPickerEl       = null;
var triggerPickerMode     = null; // 'snippet' | 'prompt'
var triggerPickerTarget   = null;
var triggerPickerIdx      = 0;
var triggerPickerQuery    = '';   // chars typed after trigger opens picker
var triggerPickerFiltered = [];   // currently visible (filtered) items
var triggerPickerDeleteLen = 0;   // total chars in field to delete on confirm
// Typing slowly opens the menu before the shortcut is finished, and from then on
// the menu owns the keystrokes — so the unique-prefix rule has to hold here too,
// or the same "::neo" expands by itself when typed fast and waits for Tab when
// typed slowly. Same settle window, same rule, one behaviour.
var pickerAutoTimer = null;
                                  // (trigger sequence + every char typed while picker open)

// Get pixel coords of the text cursor — used to position the picker.
// IMPORTANT: must not mutate the DOM or the live Selection, otherwise the
// cursor shifts (typically to the previous line) before the picker appears
// and subsequent insertions land at the wrong position.
function _getCaretCoords(el) {
  // A focused <textarea>/<input> keeps its caret in its own internal model:
  // window.getSelection() reports a position in the DOCUMENT (BODY), so Method 1
  // measures a 0x0 rect and Method 2 runs — and its span insertion mutates the
  // DOM, which resets the field's caret to 0. Everything typed after the picker
  // opened then landed at the START of the message, and the delete span on
  // insert took the wrong characters with it. Anchor these fields to their own
  // box: nothing about the page DOM is touched.
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
    var box = el.getBoundingClientRect();
    return { x: box.left, y: box.bottom };
  }
  // Method 1: getBoundingClientRect() on a collapsed Range — zero DOM mutations.
  // A collapsed range in Chrome returns the caret rect (width:0, height:lineHeight).
  try {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      var range = sel.getRangeAt(0).cloneRange();
      range.collapse(true);
      var rect = range.getBoundingClientRect();
      if (rect && rect.height > 0) {
        return { x: rect.left, y: rect.bottom };
      }
    }
  } catch(e) {}
  // Method 2: Span-insertion fallback (rare edge cases where Method 1 returns
  // a zero-height rect). Snapshots the selection endpoints before the DOM
  // mutation and restores them afterward so the cursor never drifts.
  try {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      var liveRange   = sel.getRangeAt(0);
      var startNode   = liveRange.startContainer;
      var startOff    = liveRange.startOffset;
      var endNode     = liveRange.endContainer;
      var endOff      = liveRange.endOffset;
      var insertRange = liveRange.cloneRange();
      insertRange.collapse(true);
      var span = document.createElement('span');
      span.textContent = '\u200b'; // zero-width space
      insertRange.insertNode(span);
      var rect = span.getBoundingClientRect();
      if (span.parentNode) span.parentNode.removeChild(span);
      // Restore original selection to undo the cursor shift caused by insertNode
      try {
        var restored = document.createRange();
        restored.setStart(startNode, startOff);
        restored.setEnd(endNode, endOff);
        sel.removeAllRanges();
        sel.addRange(restored);
      } catch(re) {}
      if (rect && (rect.width > 0 || rect.height > 0)) {
        return { x: rect.left, y: rect.bottom };
      }
    }
  } catch(e) {}
  // Method 3: Fallback — bottom-left of the element
  var elRect = el.getBoundingClientRect();
  return { x: elRect.left, y: elRect.bottom };
}

// Render a shortcut as the canonical `.sctag`: dim the leading trigger prefix
// (e.g. "::") to 0.45 opacity, body at full weight, azure mono — matches the
// harmonized mockup's shortcut-tag pattern.
function _scTag(sc) {
  var s = String(sc == null ? '' : sc);
  var m = s.match(/^([^0-9A-Za-z]+)([\s\S]*)$/);
  var pfx  = xesc(m ? m[1] : '');
  var body = xesc(m ? m[2] : s);
  return '<span style="margin-left:auto;flex:0 0 auto;font-family:\'SF Mono\',\'Cascadia Code\',\'JetBrains Mono\',ui-monospace,Menlo,Consolas,monospace;font-size:12px;font-weight:600;color:#1B4FD8;letter-spacing:.2px;white-space:nowrap">'
    + (pfx ? '<span style="opacity:.45;font-weight:400">' + pfx + '</span>' : '')
    + body
    + '</span>';
}

// Re-render picker items filtered by query string
function _renderPickerItems(query) {
  if (!triggerPickerEl) return;
  var allItems = triggerPickerMode === 'snippet' ? snippets : promptTemplates();
  var q = (query || '').toLowerCase();
  var filtered = q
    ? allItems.filter(function(s) {
        if ((s.title    || '').toLowerCase().indexOf(q) > -1) return true;
        if ((s.shortcut || '').toLowerCase().indexOf(q) > -1) return true;
        var aqs = Array.isArray(s.alternative_queries) ? s.alternative_queries : [];
        for (var ai = 0; ai < aqs.length; ai++) {
          if ((aqs[ai] || '').toLowerCase().indexOf(q) > -1) return true;
        }
        return false;
      })
    : allItems.slice();

  if (triggerPickerMode === 'snippet') filtered = _dedupByLangBase(filtered);
  triggerPickerFiltered = filtered;

  var itemsEl = triggerPickerEl.querySelector('.sb-tp-items');
  if (!itemsEl) return;

  var h = '';
  for (var i = 0; i < triggerPickerFiltered.length; i++) {
    var item = triggerPickerFiltered[i];
    // Divider at the base->dashboard boundary. Non-selectable (not .sb-tp-item),
    // so it never enters nav/highlight/click — those query .sb-tp-item only.
    if (i > 0 && item._group === 'list' && triggerPickerFiltered[i - 1]._group === 'base') {
      h += '<div class="sb-tp-sep" style="margin:5px 4px 2px;padding:7px 8px 3px;border-top:1px solid #E4E4E7;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#A1A1AA;">My prompt base</div>';
    }
    // Shortcut badge for BOTH snippets and prompts (when present) — surfaces the
    // prompt's direct-expansion shortcut in the browser so users learn it. Base
    // Prompts carry no shortcut, so they show none.
    var sc = item.shortcut
      ? _scTag(item.shortcut)
      : '';
    h += '<div class="sb-tp-item" data-idx="' + i + '" style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;font-size:14px;font-weight:500;color:#18181B;line-height:1.3;'
      + (i === 0 ? 'background:#EEF2FF;' : '') + '">'
      + '<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + xesc(item.title) + '</span>'
      // A deprecated item still works; the menu says so before it is picked.
      + (item.review_status === 'deprecated'
        ? '<span style="flex:none;padding:0 6px;border-radius:9999px;font-size:10px;font-weight:600;line-height:16px;color:var(--sb-warn);background:var(--sb-warn-bg);">Deprecated</span>'
        : '')
      + sc
      + '</div>';
  }
  if (!triggerPickerFiltered.length) {
    // An empty library and a query that matched nothing are different problems,
    // and the signed-out case is the common one: say what to do about it.
    var emptyMsg = 'No matches';
    if (!allItems.length) {
      emptyMsg = hasSession
        ? 'No snippets yet. Create one in the dashboard.'
        : 'Sign in from the Fibonax toolbar icon to load your snippets.';
    }
    h = '<div style="padding:16px 12px;font-size:13px;color:#A1A1AA;text-align:center;line-height:1.45">'
      + xesc(emptyMsg) + '</div>';
  }
  itemsEl.innerHTML = h;
  triggerPickerIdx = 0;

  itemsEl.querySelectorAll('.sb-tp-item').forEach(function(itemEl) {
    function onPickerSelect(e) {
      e.preventDefault();
      var now = Date.now();
      if (onPickerSelect._last && now - onPickerSelect._last < 400) return;
      onPickerSelect._last = now;
      selectTriggerItem(parseInt(itemEl.dataset.idx));
    }
    itemEl.addEventListener('mousedown', onPickerSelect);
    itemEl.addEventListener('touchstart', onPickerSelect, {passive: false});
  });
}


function showTriggerPicker(el, mode, seqLen, filterStr) {
  if (processing) return;
  closeTriggerPicker();
  if (mode === 'prompt') _prefetchPromptBrains();
  triggerPickerTarget = el;
  triggerPickerMode   = mode;
  triggerPickerIdx    = 0;
  triggerPickerQuery  = filterStr || '';
  // NON-DESTRUCTIVE: we leave the user's typed text in the field. The picker
  // is a suggestion preview; deletion + insertion only happens on explicit
  // confirm (Tab / Enter / click). The field content remains visible and
  // editable while the picker is open.
  triggerPickerDeleteLen = seqLen || 0;

  var div = document.createElement('div');
  div.id = 'sb-trigger-picker';
  div.style.cssText = 'position:fixed;z-index:2147483647;display:flex;flex-direction:column;background:#fff;border:1px solid #E4E4E7;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.06);min-width:260px;max-width:360px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;';

  var header = '<div style="flex:0 0 auto;padding:9px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#A1A1AA;border-bottom:1px solid #E4E4E7;display:flex;align-items:center;gap:8px">';
  header += mode === 'snippet'
    ? '<span style="display:inline-flex;align-items:center;gap:4px">' + snippetIcon(14) + 'Insert snippet</span>'
    : '<span style="display:inline-flex;align-items:center;gap:4px">' + promptIcon(14) + 'Prompt mode \u00b7 ' + xesc(triggerCfg.promptTrigger || '"""') + '</span>';
  header += '<span class="sb-tp-hint" style="margin-left:auto;font-weight:500;text-transform:none;letter-spacing:0;color:#A1A1AA;font-size:10px">' + PICKER_HINT + '</span>';
  header += '</div>';
  header += '<div class="sb-tp-items" style="flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px;"></div>';
  div.innerHTML = header;

  // Position at caret, keep inside viewport
  var coords = _getCaretCoords(el);
  var left = Math.max(4, Math.min(coords.x, window.innerWidth - 360));
  var top  = coords.y + 4;
  var spaceBelow = window.innerHeight - top - 20;
  if (spaceBelow < 160) {
    // Flip above cursor
    top = Math.max(4, coords.y - 4 - 320);
    spaceBelow = 320;
  }
  div.style.left      = left + 'px';
  div.style.top       = top  + 'px';
  div.style.maxHeight = Math.min(380, Math.max(160, spaceBelow)) + 'px';

  document.body.appendChild(div);
  triggerPickerEl = div;
  _renderPickerItems(triggerPickerQuery);
  // The letters typed before the menu opened may already leave one snippet.
  _armPickerAuto();
}

var PICKER_HINT = 'Tab / Enter to insert';

function _setPickerHint(text) {
  var hint = triggerPickerEl && triggerPickerEl.querySelector('.sb-tp-hint');
  if (hint) hint.textContent = text || PICKER_HINT;
}

// Stop a pending automatic insert and put the usual hint back.
function _cancelPickerAuto() {
  if (pickerAutoTimer) { clearTimeout(pickerAutoTimer); pickerAutoTimer = null; }
  _setPickerHint('');
}

// "Insert automatically" (AUTO-INSERT-001). Off until the person turns it on in
// Settings. Then, once the typed letters leave a single snippet standing, the
// menu stays open for the wait they chose and inserts it unless they do
// something else first: Esc, Backspace, an arrow key or another letter all
// stop or restart the wait, and Tab / Enter insert at once. Called when the menu
// opens and after every letter typed into it.
function _armPickerAuto() {
  _cancelPickerAuto();
  if (!triggerCfg.autoInsert || !triggerPickerEl || triggerPickerMode !== 'snippet') return;
  if (!_pickerHasOnePrefixMatch()) return;
  var secs = _autoInsertSeconds();
  _setPickerHint('Inserting in ' + secs + (secs === 1 ? ' second' : ' seconds') + ' · Esc to cancel');
  pickerAutoTimer = setTimeout(function() {
    pickerAutoTimer = null;
    if (!_pickerHasOnePrefixMatch()) { _setPickerHint(''); return; }
    selectTriggerItem(0);
  }, secs * 1000);
}

// True when the menu holds exactly one snippet and the typed letters are a real
// prefix of its shortcut or one of its alternative queries (not a word that
// merely appears inside a title), at least MIN_PREFIX_CHARS of them.
function _pickerHasOnePrefixMatch() {
  if (!triggerPickerEl || triggerPickerMode !== 'snippet') return false;
  if (triggerPickerQuery.length < MIN_PREFIX_CHARS) return false;
  if (triggerPickerFiltered.length !== 1) return false;
  var seq = (triggerCfg && triggerCfg.snippetTrigger) || '::';
  return !!_uniquePrefixSnippet(triggerPickerQuery, seq);
}

function selectTriggerItem(idx) {
  if (idx < 0 || idx >= triggerPickerFiltered.length) return;
  var item  = triggerPickerFiltered[idx];
  // A prompt whose Brain is still on its way waits, menu open (_holdPromptPick).
  if (triggerPickerMode === 'prompt' && _promptHasBrain(item) && !_promptBrainCached(item.body || '')) {
    _holdPromptPick(item);
    return;
  }
  var el    = triggerPickerTarget;
  var mode  = triggerPickerMode;
  // Full delete span: the trigger sequence (::) + everything typed since.
  // Captured BEFORE closeTriggerPicker resets state.
  var dLen  = triggerPickerDeleteLen || 0;
  closeTriggerPicker();
  if (!el) return;
  dLen = _fieldTriggerSpan(el, dLen);

  // Multi-language detection: if the selected snippet has sibling translations,
  // show the language picker modal instead of inserting directly. The modal
  // re-enters through handleMatch() which handles deletion + the full insertion
  // pipeline (placeholders, formulas, fields, celebration).
  if (mode === 'snippet') {
    var variantsMap = _findLangVariants(item);
    if (Object.keys(variantsMap).length > 1) {
      // Same fix as in checkBuf(): pass the full delete length through to
      // handleMatch instead of pre-deleting. The CE selection set by
      // deleteChars would be wiped when the modal grabs focus, leaving the
      // trigger string in the field after the user picks a language.
      processing = true;
      injectLangModal(variantsMap, el, dLen);
      return;
    }
  }

  var fieldSnapshot = captureFieldState(el, dLen);

  function doInsert() {
    if (mode === 'snippet') {
      var fields = extractFields(item.body);
      processing = true;
      if (!fields.length) {
        var text = resolveBody(item.body, {}, { lang: item.lang });
        var _isCE2 = el && (el.isContentEditable || (el.getAttribute &&
          (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')));
        var pics = _pictureForm(item);
        var html = pics && _takesFormatting(el) ? pics.formatted : null;
        // Checked first, as a typed trigger is (see _proceedInsert).
        _checkThenInsert(el, item, text, function(note) {
          note = _pictureNote(note, pics, html);
          if (_isCE2) {
            // Same sync-insert fix as _proceedInsert: insert while selection is live.
            var before = _ceMeasureBefore(el);
            insertText(el, text, html);
            _markSyncInserted(fieldSnapshot, el, before, text, html ? pics : null);
            showCelebration(
              text,
              function onConfirm() {     // timer expired or user clicked OK
                logEvent(item, 0);
                processing = false;
              },
              function onUndo() {        // user clicked Undo
                restoreFieldState(fieldSnapshot);
                processing = false;
              },
              { inserted: true, target: el, warning: reviewWarning(item), note: note }
            );
          } else {
            // Non-CE: trigger already stripped; defer insertion to onConfirm.
            showCelebration(
              text,
              function onConfirm() {     // timer expired or user clicked OK
                insertText(el, text);
                logEvent(item, 0);
                processing = false;
              },
              function onUndo() {        // user clicked Undo — never insert
                restoreFieldState(fieldSnapshot);
                processing = false;
              },
              { inserted: false, target: el, warning: reviewWarning(item), note: note }
            );
          }
        }, function() {
          restoreFieldState(fieldSnapshot);
          processing = false;
        });
      } else {
        showOverlay(el, item, dLen, function() { processing = false; });
      }
    } else {
      _promptText(item, function(text) {
        insertText(el, text);
        logEvent(item, 0);
      });
    }
  }

  // Delete the trigger + typed filter from the field, then insert the snippet.
  // This is the ONLY place deletion happens — opening the picker no longer
  // touches the field, so the user keeps seeing what they type.
  if (dLen > 0) {
    deleteChars(el, dLen, function() { doInsert(); });
  } else {
    doInsert();
  }
}

function closeTriggerPicker() {
  if (triggerPickerEl) { triggerPickerEl.remove(); triggerPickerEl = null; }
  _heldPromptPick = null;
  triggerPickerMode      = null;
  triggerPickerTarget    = null;
  triggerPickerIdx       = 0;
  triggerPickerQuery     = '';
  triggerPickerFiltered  = [];
  triggerPickerDeleteLen = 0;
  if (pickerAutoTimer) { clearTimeout(pickerAutoTimer); pickerAutoTimer = null; }
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
}

// Index within triggerPickerFiltered of a prompt whose shortcut EXACTLY equals
// the typed query (case-insensitive), else -1. Drives the prompt trigger's
// direct expansion: typing """ + a prompt's shortcut fires it straight away —
// the prompt-trigger analog of a snippet's ::shortcut. Base Prompts have no
// shortcut, so they never match here and stay menu-only.
function _promptShortcutExactIdx(query) {
  var q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return -1;
  for (var i = 0; i < triggerPickerFiltered.length; i++) {
    var sc = String(triggerPickerFiltered[i].shortcut || '').trim().toLowerCase();
    if (sc && sc === q) return i;
  }
  return -1;
}

function handleTriggerPickerKey(e) {
  if (!triggerPickerEl) return false;
  var count = triggerPickerFiltered.length;

  // Browsing the list means the person is choosing for themselves.
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _cancelPickerAuto();
    triggerPickerIdx = Math.min(triggerPickerIdx + 1, count - 1);
    updateTriggerPickerHighlight();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    _cancelPickerAuto();
    triggerPickerIdx = Math.max(triggerPickerIdx - 1, 0);
    updateTriggerPickerHighlight();
    return true;
  }
  if (e.key === 'Tab' || e.key === 'Enter') {
    // Only confirm if there are filtered matches; otherwise let Tab/Enter
    // pass through so the user isn't trapped when their query matches nothing.
    if (count > 0) {
      e.preventDefault();
      e.stopPropagation();   // kept from the page's editor, as for an armed match
      selectTriggerItem(triggerPickerIdx);
      return true;
    }
    closeTriggerPicker();
    return false;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    closeTriggerPicker();
    return true;
  }
  // Space closes the picker without inserting — keeps whatever the user
  // typed in the field as normal text, then the space flows through.
  if (e.key === ' ') {
    closeTriggerPicker();
    return false;
  }
  // Printable char — append to query, re-filter, track the extra char as
  // part of the delete-on-confirm span. Let the char reach the field too.
  if (e.key.length === 1) {
    triggerPickerQuery += e.key;
    triggerPickerDeleteLen += 1;
    _renderPickerItems(triggerPickerQuery);
    // Prompt shortcut → direct expansion: typing a prompt's exact shortcut after
    // the prompt trigger ("""foo) fires it immediately — the analog of a
    // snippet's ::shortcut. Deferred one tick so the just-typed char lands in the
    // field first, keeping the delete span aligned with what's on screen. The
    // menu stays open for browsing, Base Prompts, and partial matches.
    if (triggerPickerMode === 'prompt') {
      setTimeout(function() {
        if (!triggerPickerEl || triggerPickerMode !== 'prompt') return;
        var idx = _promptShortcutExactIdx(triggerPickerQuery);
        if (idx > -1) selectTriggerItem(idx);
      }, 0);
    }
    // Snippets: with "Insert automatically" on, a single remaining prefix match
    // starts the wait again from this letter (no-op when the setting is off).
    _armPickerAuto();
    // Return true to short-circuit the main keydown handler so the keystroke
    // isn't accidentally appended to the shortcut buffer (which could match
    // a different snippet while the picker is open).
    return true;
  }
  // Backspace — shrink query, shrink delete span, let backspace go into field
  if (e.key === 'Backspace') {
    if (triggerPickerQuery.length > 0) {
      // Deleting is the user disagreeing with the menu — never auto-expand into
      // a correction they are still making.
      _cancelPickerAuto();
      triggerPickerQuery = triggerPickerQuery.slice(0, -1);
      triggerPickerDeleteLen = Math.max(0, triggerPickerDeleteLen - 1);
      _renderPickerItems(triggerPickerQuery);
      return true;
    }
    // Nothing left in the query — close, but let the backspace through so
    // the user can keep deleting their trigger sequence normally.
    closeTriggerPicker();
    return false;
  }
  return false;
}

function updateTriggerPickerHighlight() {
  if (!triggerPickerEl) return;
  var items = triggerPickerEl.querySelectorAll('.sb-tp-item');
  for (var i = 0; i < items.length; i++) {
    items[i].style.background = i === triggerPickerIdx ? '#EEF2FF' : '';
  }
  if (items[triggerPickerIdx]) {
    items[triggerPickerIdx].scrollIntoView({ block: 'nearest' });
  }
}

// Collapse sibling language variants (quoteEN/quoteES/quoteIT) into a single
// row. The language picker modal handles the per-language choice on insert.
// Grouping comes from the shared rule (see _groupKeyOf); the row whose shortcut
// carries no language code represents the group, so the picker shows "::air"
// rather than whichever of "::airIT" / "::airES" happened to come first.
function _dedupByLangBase(list) {
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var key = _groupKeyOf(s);
    if (seen[key] !== undefined) {
      if (!LANG_SUFFIX_RE.test(s.shortcut || '')) out[seen[key]] = s;
      continue;
    }
    seen[key] = out.length;
    out.push(s);
  }
  return out;
}

// Close picker on outside click/tap or page scroll
document.addEventListener('mousedown', function(e) {
  // The caret is about to move — an armed match would expand at the new spot.
  _cancelArmed();
  if (triggerPickerEl && !triggerPickerEl.contains(e.target)) {
    setTimeout(function() { closeTriggerPicker(); }, 100);
  }
});
document.addEventListener('touchstart', function(e) {
  if (triggerPickerEl && !triggerPickerEl.contains(e.target)) {
    setTimeout(function() { closeTriggerPicker(); }, 100);
  }
}, {passive: true});
document.addEventListener('scroll', function(e) {
  if (triggerPickerEl && triggerPickerEl.contains(e.target)) return;
  closeTriggerPicker();
}, true);

// ── KEYBOARD LISTENER ──────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  // Handle trigger picker keys first
  if (triggerPickerEl && handleTriggerPickerKey(e)) return;

  // Skip if overlay open
  if (overlayEl) return;

  var t = e.target;

  // Skip our own elements
  if (t && t.closest && t.closest('#sb-overlay')) return;
  if (t && t.closest && t.closest('#sb-celebrate')) return;

  // An armed match is one keystroke from expanding. Tab and Enter end the word,
  // so they confirm it immediately — the settle window only exists to catch a
  // longer word, and these two rule that out. Enter is consumed so a chat
  // composer sends the expanded message, never the raw trigger; press it again
  // to send. Editing and navigation keys mean the caret is moving away, so the
  // match is dropped. Printable characters are decided in checkBuf, once they
  // have actually landed in the field.
  if (armedMatch) {
    if (e.key === 'Tab' || e.key === 'Enter') {
      // preventDefault alone still lets the page's own key handlers run, and
      // Lexical (WhatsApp Web) acts on Enter regardless of it: it added a blank
      // line under the snippet. Stop the key here, before it reaches the editor.
      e.preventDefault();
      e.stopPropagation();
      _fireArmed(0);
      return;
    }
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete' ||
        ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].indexOf(e.key) > -1) {
      _cancelArmed();
    }
  }

  // Cancel pending trigger on Escape
  if (triggerPending && e.key === 'Escape') {
    triggerPending = false;
    triggerPendingMode = null;
    triggerAffix = '';
    if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
    return;
  }

  // Handle special keys
  if (e.key === 'Backspace') { buf = buf.slice(0,-1); return; }
  if (e.key === 'Delete')    { buf = ''; return; }
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Enter','Tab'].indexOf(e.key) > -1) {
    buf = ''; return;
  }
  if (e.key.length !== 1) return;

  // Skip modifier-key combos (Ctrl+V, Cmd+V, etc.) — paste is handled separately
  if (e.ctrlKey || e.metaKey) return;

  // Skip if a paste is in progress
  if (isPasting) return;

  // Only track editable elements
  var editable = false;
  if (t) {
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') editable = true;
    else if (t.isContentEditable || t.getAttribute('contenteditable') === 'true' || t.getAttribute('contenteditable') === '') editable = true;
    else {
      // Walk up 6 levels for nested contenteditable (Claude, ChatGPT)
      var p = t;
      for (var i = 0; i < 6; i++) {
        p = p.parentElement;
        if (!p) break;
        if (p.isContentEditable || p.getAttribute('contenteditable') === 'true') { editable = true; break; }
      }
    }
  }
  if (!editable) return;

  activeEl = t;
  lastInputTime = Date.now(); // mark: keydown handled this char, input event should skip it
  addKey(e.key);
  setTimeout(checkBuf, 10);
}, true);

// ── PASTE GUARD ───────────────────────────────────────────────────
// Sets isPasting=true before paste characters reach the input event,
// preventing clipboard content from feeding the trigger buffer regardless
// of whether the browser populates InputEvent.inputType.
document.addEventListener('paste', function() {
  isPasting = true;
  _cancelArmed();
  buf = '';
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
  setTimeout(function() { isPasting = false; }, 50);
}, true);

// ── MOBILE INPUT LISTENER ─────────────────────────────────────────
// Soft keyboards (Android) fire `input` events instead of keydown with real keys.
// This listener is the primary trigger path on mobile; on desktop it is suppressed
// by the debounce guard (keydown already set lastInputTime within 50ms).
document.addEventListener('input', function(e) {
  if (overlayEl || triggerPickerEl) return;
  var t = e.target;
  if (!t) return;
  if (t.closest && (t.closest('#sb-overlay') || t.closest('#sb-celebrate'))) return;

  // Only handle text insertions, not deletions or composition commits
  var iType = e.inputType || '';
  if (iType && iType.indexOf('insert') === -1) return;

  // Clear buffer on paste/drop to prevent partial trigger matches
  if (isPasting || iType === 'insertFromPaste' || iType === 'insertFromDrop') {
    buf = '';
    return;
  }

  var data = e.data;
  if (!data || !data.length) return;

  // Debounce: if keydown fired within the last 50ms it already processed this char
  var now = Date.now();
  if (now - lastInputTime < 50) return;

  // Only editable targets
  var editable = false;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') editable = true;
  else if (t.isContentEditable || t.getAttribute('contenteditable') === 'true' || t.getAttribute('contenteditable') === '') editable = true;
  else {
    var p = t;
    for (var i = 0; i < 6; i++) {
      p = p.parentElement; if (!p) break;
      if (p.isContentEditable || p.getAttribute('contenteditable') === 'true') { editable = true; break; }
    }
  }
  if (!editable) return;

  activeEl = t;
  lastInputTime = now;
  for (var i = 0; i < data.length; i++) addKey(data[i]);
  setTimeout(checkBuf, 10);
}, true);

// ── INJECT STYLES ─────────────────────────────────────────────────
(function() {
  if (document.getElementById('sb-styles')) return;
  var s = document.createElement('style');
  s.id = 'sb-styles';
  s.textContent =
    '#sb-cel-bd{position:fixed;inset:0;background:var(--sb-scrim);z-index:2147483646;}' +
    '#sb-celebrate{all:initial;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;box-sizing:border-box;width:min(520px,calc(100vw - var(--sb-s-8)));max-height:calc(100dvh - var(--sb-s-8));overflow:auto;background:var(--sb-bg);border:1px solid var(--sb-line);border-radius:var(--sb-r-2xl);box-shadow:var(--sb-shadow-md);font-family:var(--sb-font);font-size:var(--sb-fs-13);color:var(--sb-ink);line-height:1.5;text-align:left;color-scheme:light;-webkit-font-smoothing:antialiased;animation:sbSummaryIn var(--sb-dur-base) var(--sb-ease);}' +
    '#sb-celebrate,#sb-celebrate *{box-sizing:border-box;}' +
    '#sb-celebrate h2,#sb-celebrate p,#sb-celebrate dl,#sb-celebrate dt,#sb-celebrate dd{margin:0;padding:0;font:inherit;color:inherit;}' +
    '#sb-celebrate .sb-cel-header{display:flex;align-items:center;justify-content:space-between;gap:var(--sb-s-3);padding:var(--sb-s-3) var(--sb-s-8);border-bottom:1px solid var(--sb-line);}' +
    '#sb-celebrate .sb-cel-brand{font-size:var(--sb-fs-12);font-weight:600;letter-spacing:-.01em;}' +
    '#sb-celebrate .sb-cel-brand-detail{font-weight:400;color:var(--sb-ink-muted);}' +
    '#sb-celebrate button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:var(--sb-s-10);font-family:inherit;font-size:var(--sb-fs-13);font-weight:600;line-height:1.3;cursor:pointer;touch-action:manipulation;border:1px solid transparent;border-radius:var(--sb-r-lg);padding:var(--sb-s-2) var(--sb-s-4);}' +
    '#sb-celebrate button:focus-visible{outline:2px solid var(--sb-azure);outline-offset:2px;}' +
    '#sb-celebrate .sb-cel-close{width:var(--sb-s-10);padding:0;color:var(--sb-ink-muted);flex:none;}' +
    '#sb-celebrate .sb-cel-close:hover{background:var(--sb-bg-alt);color:var(--sb-ink);}' +
    '#sb-celebrate svg{display:block;flex:none;}' +
    '#sb-celebrate .sb-cel-body{padding:var(--sb-s-8);}' +
    '#sb-celebrate .sb-cel-heading{display:flex;align-items:center;gap:var(--sb-s-3);}' +
    '#sb-celebrate .sb-cel-symbol{position:relative;width:var(--sb-s-8);height:var(--sb-s-8);display:flex;align-items:center;justify-content:center;flex:none;color:var(--sb-azure);background:var(--sb-azure-bg);border-radius:var(--sb-r-md);}' +
    '#sb-celebrate .sb-cel-confetti{position:absolute;inset:0;pointer-events:none;}' +
    '#sb-celebrate .sb-cel-confetti i{position:absolute;top:50%;left:50%;width:var(--sb-s-1);height:calc(var(--sb-s-1) * 1.5);background:var(--sb-azure);border-radius:0;opacity:0;animation:sbConfettiBurst calc(var(--sb-dur-base) * 5) ease-out both;}' +
    '#sb-celebrate .sb-cel-confetti i:nth-child(3n){background:var(--sb-lang-multi);}' +
    '#sb-celebrate .sb-cel-confetti i:nth-child(3n + 1){background:var(--sb-warn);}' +
    '#sb-celebrate #sb-cel-title{font-size:var(--sb-fs-24);font-weight:600;letter-spacing:-.03em;line-height:1.25;}' +
    '#sb-celebrate #sb-cel-description{margin-top:var(--sb-s-2);color:var(--sb-ink-muted);font-size:var(--sb-fs-13);}' +
    '#sb-celebrate #sb-cel-description.sb-cel-warn{color:var(--sb-warn);font-weight:600;}' +
    '#sb-celebrate .sb-cel-note{margin-top:var(--sb-s-2);font-size:var(--sb-fs-12);color:var(--sb-ink-muted);}' +
    '#sb-celebrate .sb-cel-time{display:flex;flex-direction:column;gap:var(--sb-s-1);margin-top:var(--sb-s-6);padding:var(--sb-s-5) var(--sb-s-6);background:var(--sb-azure-bg);border:1px solid var(--sb-azure-bdr);border-radius:var(--sb-r-xl);}' +
    '#sb-celebrate .sb-cel-label{font-size:var(--sb-fs-12);font-weight:500;color:var(--sb-azure);}' +
    '#sb-celebrate #sb-cel-time-value{font-size:var(--sb-fs-32);font-weight:600;line-height:1.25;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:var(--sb-azure);}' +
    '#sb-celebrate .sb-cel-assumption{font-size:var(--sb-fs-11);color:var(--sb-ink-muted);}' +
    '#sb-celebrate .sb-cel-metrics{display:grid;grid-template-columns:1fr 1fr;margin-top:var(--sb-s-5);}' +
    '#sb-celebrate .sb-cel-metrics>div+div{padding-left:var(--sb-s-6);border-left:1px solid var(--sb-line);}' +
    '#sb-celebrate .sb-cel-metrics dt{font-size:var(--sb-fs-12);color:var(--sb-ink-muted);}' +
    '#sb-celebrate .sb-cel-metrics dd{margin-top:var(--sb-s-1);font-size:var(--sb-fs-20);font-weight:600;line-height:1.3;letter-spacing:-.02em;font-variant-numeric:tabular-nums;}' +
    '#sb-celebrate .sb-cel-footer{padding:var(--sb-s-5) var(--sb-s-8);background:var(--sb-bg-alt);border-top:1px solid var(--sb-line);}' +
    '#sb-celebrate .sb-cel-actions{display:flex;justify-content:flex-end;gap:var(--sb-s-3);}' +
    '#sb-celebrate .sb-cel-secondary{margin-right:auto;background:var(--sb-bg);color:var(--sb-ink);border-color:var(--sb-line-2);}' +
    '#sb-celebrate .sb-cel-secondary:hover{background:var(--sb-bg-muted);}' +
    '#sb-celebrate .sb-cel-primary{min-width:calc(var(--sb-s-12) * 2);background:var(--sb-azure);color:var(--sb-bg);}' +
    '#sb-celebrate .sb-cel-primary:hover{background:var(--sb-azure-dark);}' +
    '#sb-celebrate .sb-cel-timer{display:flex;justify-content:space-between;gap:var(--sb-s-2);margin-top:var(--sb-s-3);font-size:var(--sb-fs-11);color:var(--sb-ink-muted);}' +
    '#sb-celebrate .sb-cel-track{height:var(--sb-s-1);margin-top:var(--sb-s-2);background:var(--sb-line);border-radius:var(--sb-r-pill);overflow:hidden;}' +
    '#sb-celebrate #sb-cel-bar{height:100%;background:var(--sb-azure);transform-origin:left;}' +
    '@media(max-width:480px){#sb-celebrate .sb-cel-header{padding:var(--sb-s-3) var(--sb-s-6);}#sb-celebrate .sb-cel-body{padding:var(--sb-s-6);}#sb-celebrate .sb-cel-time{padding:var(--sb-s-4) var(--sb-s-5);}#sb-celebrate .sb-cel-footer{padding:var(--sb-s-4) var(--sb-s-6);}}' +
    '@keyframes sbSummaryIn{from{opacity:0;transform:translate(-50%,-48%)}to{opacity:1;transform:translate(-50%,-50%)}}' +
    '@keyframes sbConfettiBurst{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}15%{opacity:1}65%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--cel-x)),calc(-50% + var(--cel-y))) rotate(var(--cel-turn)) scale(.7)}}' +
    '@media(prefers-reduced-motion:reduce){#sb-celebrate{animation:none;}#sb-celebrate .sb-cel-confetti{display:none;}}' +
    // The header and action stay visible; one scroll region holds the whole form.
    // All answers and their existing handlers remain inside the same dialog.
    "#sb-overlay{all:initial;box-sizing:border-box;background:var(--sb-bg);border:1px solid var(--sb-line);border-radius:var(--sb-r-2xl);font-family:var(--sb-font);font-size:var(--sb-fs-13);color:var(--sb-ink);line-height:1.5;text-align:left;color-scheme:light;-webkit-font-smoothing:antialiased;}" +
    "#sb-overlay *,#sb-overlay *::before,#sb-overlay *::after{box-sizing:border-box;}" +
    "#sb-overlay h2,#sb-overlay h3,#sb-overlay p{margin:0;padding:0;font:inherit;color:inherit;}" +
    "#sb-overlay button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:var(--sb-s-2);min-height:calc(var(--sb-s-10) + var(--sb-s-1));border:1px solid transparent;border-radius:var(--sb-r-lg);font-family:inherit;font-size:var(--sb-fs-13);font-weight:600;line-height:1.3;cursor:pointer;touch-action:manipulation;}" +
    "#sb-overlay button:focus-visible{outline:2px solid var(--sb-azure);outline-offset:2px;}" +
    "#sb-overlay .sb-hdr{flex:none;display:flex;align-items:center;justify-content:space-between;gap:var(--sb-s-3);padding:var(--sb-s-2) var(--sb-s-6);border-bottom:1px solid var(--sb-line);background:var(--sb-azure-bg);}" +
    "#sb-overlay .sb-function-name{min-width:0;font-size:var(--sb-fs-16);font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere;}" +
    "#sb-overlay .sb-close{flex:none;width:calc(var(--sb-s-10) + var(--sb-s-1));padding:0;color:var(--sb-ink-muted);}" +
    "#sb-overlay .sb-close:hover{background:var(--sb-bg-muted);color:var(--sb-ink);}" +
    "#sb-overlay .sb-close svg{display:block;}" +
    "#sb-overlay .sb-form-content{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scroll-padding-block:var(--sb-s-3);padding:var(--sb-s-5) var(--sb-s-6);}" +
    "#sb-overlay .sb-heading{margin-bottom:var(--sb-s-4);}" +
    "#sb-overlay #sb-fill-description{margin:0;font-size:var(--sb-fs-12);font-weight:600;color:var(--sb-ink);}" +
    "#sb-overlay .sb-revwarn{margin-bottom:var(--sb-s-5);padding:var(--sb-s-3) var(--sb-s-4);border:1px solid var(--sb-warn-bdr);border-radius:var(--sb-r-lg);background:var(--sb-warn-bg);color:var(--sb-ink);font-size:var(--sb-fs-12);}" +
    "#sb-overlay .sb-fields{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;gap:var(--sb-s-4);}" +
    "#sb-overlay .sb-field{display:flex;flex-direction:column;gap:var(--sb-s-2);min-width:0;}" +
    "#sb-overlay .sb-lbl{display:block;margin:0;font-family:inherit;font-size:var(--sb-fs-12);font-weight:600;color:var(--sb-ink);line-height:1.4;text-transform:none;letter-spacing:normal;overflow-wrap:anywhere;}" +
    "#sb-overlay .sb-row{display:flex;align-items:center;gap:var(--sb-s-2);flex-wrap:wrap;}" +
    "#sb-overlay .sb-row .sb-inp{flex:1 1 130px;width:auto;min-width:0;}" +
    "#sb-overlay .sb-ctx,#sb-overlay .sb-ctxline{font-size:var(--sb-fs-13);font-weight:400;color:var(--sb-ink-muted);line-height:1.5;overflow-wrap:anywhere;}" +
    "#sb-overlay .sb-inp{display:block;margin:0;width:100%;min-width:0;min-height:calc(var(--sb-s-10) + var(--sb-s-1));padding:var(--sb-s-2) var(--sb-s-3);background:var(--sb-bg);border:1px solid var(--sb-line-2);border-radius:var(--sb-r-lg);font-family:inherit;font-size:var(--sb-fs-16);line-height:1.4;color:var(--sb-ink);outline:none;touch-action:manipulation;transition:border-color var(--sb-dur-base),box-shadow var(--sb-dur-base);}" +
    "#sb-overlay .sb-inp:hover{border-color:var(--sb-ink-muted);}" +
    "#sb-overlay .sb-inp:focus{border-color:var(--sb-azure);box-shadow:0 0 0 3px var(--sb-azure-glow);}" +
    "#sb-overlay .sb-inp[type=text]{font-weight:700;}" +
    "#sb-overlay .sb-inp[hidden]{display:none;}" +
    "#sb-overlay .sb-inp::placeholder{font-weight:400;color:var(--sb-ink-muted);opacity:1;}" +
    "#sb-overlay .sb-inp[type=date],#sb-overlay .sb-inp[type=time],#sb-overlay .sb-inp[type=datetime-local]{color:var(--sb-azure);}" +
    "#sb-overlay .sb-adj{align-self:flex-start;padding:var(--sb-s-1) var(--sb-s-2);margin:calc(-1 * var(--sb-s-1)) 0;font-size:var(--sb-fs-12);font-weight:500;color:var(--sb-ink-muted);}" +
    "#sb-overlay .sb-adj:hover,#sb-overlay .sb-adj[aria-expanded=true]{color:var(--sb-azure);background:var(--sb-azure-bg);}" +
    "#sb-overlay .sb-adjbox{display:flex;flex-direction:column;gap:var(--sb-s-3);padding:var(--sb-s-4);background:var(--sb-bg-alt);border:1px solid var(--sb-line);border-radius:var(--sb-r-lg);}" +
    "#sb-overlay .sb-adjrow{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sb-s-2);}" +
    "#sb-overlay .sb-adjlbl{flex:none;width:var(--sb-s-12);font-size:var(--sb-fs-12);font-weight:500;color:var(--sb-ink-muted);}" +
    "#sb-overlay .sb-adjbox select,#sb-overlay .sb-adjbox input[type=number]{flex:1 1 auto;min-width:0;max-width:100%;min-height:calc(var(--sb-s-10) + var(--sb-s-1));padding:var(--sb-s-2);background:var(--sb-bg);border:1px solid var(--sb-line-2);border-radius:var(--sb-r-md);font-family:inherit;font-size:var(--sb-fs-13);color:var(--sb-ink);cursor:pointer;}" +
    "#sb-overlay .sb-adjbox select:focus,#sb-overlay .sb-adjbox input[type=number]:focus{outline:2px solid var(--sb-azure);outline-offset:2px;}" +
    "#sb-overlay .sb-adjbox input[type=number]{flex:0 1 calc(var(--sb-s-8) * 2);cursor:text;}" +
    "#sb-overlay .sb-dayfixed{display:flex;flex:1 1 100%;flex-wrap:wrap;align-items:center;gap:var(--sb-s-2);}" +
    "#sb-overlay .sb-dayfixed select{flex:1 1 calc(var(--sb-s-12) * 2);}" +
    "#sb-overlay .sb-adjchk{display:flex;align-items:center;gap:var(--sb-s-2);min-height:calc(var(--sb-s-10) + var(--sb-s-1));font-size:var(--sb-fs-12);color:var(--sb-ink-muted);cursor:pointer;}" +
    "#sb-overlay .sb-adjchk input{accent-color:var(--sb-azure);cursor:pointer;margin:0;}" +
    "#sb-overlay .sb-adjsep{flex:none;font-size:var(--sb-fs-13);color:var(--sb-ink-muted);}" +
    "#sb-overlay .sb-adjbox .sb-hh,#sb-overlay .sb-adjbox .sb-mm{flex:0 1 calc(var(--sb-s-8) * 2);}" +
    "#sb-overlay .sb-btnrow{display:flex;flex-wrap:wrap;gap:var(--sb-s-2);}" +
    "#sb-overlay .sb-actbtn{padding:var(--sb-s-2) var(--sb-s-3);border-color:var(--sb-line-2);color:var(--sb-ink);background:var(--sb-bg);}" +
    "#sb-overlay .sb-actbtn:hover{background:var(--sb-bg-muted);}" +
    "#sb-overlay .sb-btnerr{color:var(--sb-danger);font-size:var(--sb-fs-12);line-height:1.5;}" +
    "#sb-overlay .sb-link{display:flex;flex-direction:column;gap:var(--sb-s-2);margin-bottom:var(--sb-s-6);padding:var(--sb-s-4);background:var(--sb-azure-bg);border:1px solid var(--sb-azure-bdr);border-radius:var(--sb-r-xl);}" +
    "#sb-overlay .sb-linklbl{font-size:var(--sb-fs-13);font-weight:600;color:var(--sb-ink);}" +
    "#sb-overlay .sb-linkrow{display:flex;align-items:stretch;gap:var(--sb-s-2);}" +
    "#sb-overlay .sb-linkinp{flex:1 1 auto;min-width:0;margin:0;background:var(--sb-bg);border:1px solid var(--sb-line-2);border-radius:var(--sb-r-lg);padding:var(--sb-s-3);font-size:var(--sb-fs-16);color:var(--sb-ink);font-family:inherit;outline:none;}" +
    "#sb-overlay .sb-linkinp:focus{border-color:var(--sb-azure);box-shadow:0 0 0 3px var(--sb-azure-glow);}" +
    "#sb-overlay .sb-linkinp::placeholder{color:var(--sb-ink-muted);opacity:1;}" +
    "#sb-overlay .sb-linkbtn{flex:none;padding:var(--sb-s-2) var(--sb-s-3);border-color:var(--sb-azure-bdr);background:var(--sb-bg);color:var(--sb-azure);}" +
    "#sb-overlay .sb-linkbtn:hover{background:var(--sb-azure-bg);}" +
    "#sb-overlay .sb-linkbtn:disabled{opacity:.55;cursor:default;}" +
    "#sb-overlay .sb-linkmsg{font-size:var(--sb-fs-12);line-height:1.5;color:var(--sb-ink-muted);}" +
    "#sb-overlay .sb-linkmsg:empty{display:none;}" +
    "#sb-overlay .sb-linkmsg.sb-linkerr{color:var(--sb-danger);}" +
    "#sb-overlay .sb-linkmark{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sb-s-2);font-size:var(--sb-fs-12);line-height:1.4;}" +
    "#sb-overlay .sb-linkbadge{display:inline-block;padding:var(--sb-s-1) var(--sb-s-2);border:1px solid var(--sb-azure-bdr);border-radius:var(--sb-r-sm);background:var(--sb-azure-bg);color:var(--sb-azure);font-size:var(--sb-fs-11);font-weight:600;}" +
    "#sb-overlay .sb-linknote,#sb-overlay .sb-linknote.sb-linkwarn{color:var(--sb-ink-muted);}" +
    "#sb-overlay .sb-multi{display:flex;flex-direction:column;gap:var(--sb-s-1);max-width:100%;}" +
    "#sb-overlay .sb-opt{display:flex;align-items:center;gap:var(--sb-s-3);min-height:calc(var(--sb-s-10) + var(--sb-s-1));padding:var(--sb-s-2) var(--sb-s-3);border:1px solid var(--sb-line);border-radius:var(--sb-r-lg);font-size:var(--sb-fs-13);color:var(--sb-ink);cursor:pointer;touch-action:manipulation;overflow-wrap:anywhere;}" +
    "#sb-overlay .sb-opt:hover{background:var(--sb-bg-alt);}" +
    "#sb-overlay .sb-opt input.sb-inp{display:inline-block;width:var(--sb-s-4);height:var(--sb-s-4);min-height:0;padding:0;margin:0;flex:none;box-shadow:none;accent-color:var(--sb-azure);cursor:pointer;}" +
    "#sb-overlay .sb-opt:has(input:checked){border-color:var(--sb-azure-bdr);background:var(--sb-azure-bg);color:var(--sb-azure);font-weight:600;}" +
    "#sb-overlay .sb-opt:has(input:focus-visible){outline:2px solid var(--sb-azure);outline-offset:2px;}" +
    "#sb-overlay .sb-preview{margin-top:var(--sb-s-4);padding:var(--sb-s-3) var(--sb-s-4);background:var(--sb-bg-alt);border-radius:var(--sb-r-xl);}" +
    "#sb-overlay .sb-preview-heading{display:flex;align-items:baseline;justify-content:space-between;gap:var(--sb-s-2);margin-bottom:var(--sb-s-2);}" +
    "#sb-overlay #sb-preview-label{font-size:var(--sb-fs-12);font-weight:600;color:var(--sb-ink);}" +
    "#sb-overlay .sb-preview-heading>span{font-size:var(--sb-fs-11);color:var(--sb-ink-muted);}" +
    "#sb-overlay .sb-prev{font-family:inherit;font-size:var(--sb-fs-13);font-weight:400;color:var(--sb-ink-muted);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;}" +
    "#sb-overlay .sb-foot{flex:none;display:flex;align-items:center;justify-content:space-between;gap:var(--sb-s-4);padding:var(--sb-s-3) var(--sb-s-6);border-top:1px solid var(--sb-line);background:var(--sb-azure-bg);}" +
    "#sb-overlay .sb-insert{min-height:calc(var(--sb-s-10) + var(--sb-s-1));padding:var(--sb-s-3) var(--sb-s-5);background:var(--sb-azure);color:var(--sb-bg);border-radius:var(--sb-r-xl);font-size:var(--sb-fs-14);}" +
    "#sb-overlay .sb-insert:hover{background:var(--sb-azure-dark);}" +
    "#sb-overlay .sb-insert>span{font-size:var(--sb-fs-16);}" +
    "#sb-overlay .sb-tip{font-size:var(--sb-fs-11);color:var(--sb-ink-muted);}" +
    "#sb-overlay [hidden]{display:none;}" +
    "@media(min-width:600px){#sb-overlay .sb-fields{grid-template-columns:repeat(6,minmax(0,1fr));}#sb-overlay .sb-field{grid-column:span 3;}#sb-overlay .sb-field--wide,#sb-overlay .sb-btnrow,#sb-overlay .sb-btnerr{grid-column:1/-1;}}" +
    "@media(min-width:720px){#sb-overlay .sb-field--compact{grid-column:span 2;}}" +
    "@media(max-width:480px){#sb-overlay .sb-hdr{padding:var(--sb-s-2) var(--sb-s-5);}#sb-overlay .sb-form-content{padding:var(--sb-s-5);}#sb-overlay .sb-foot{flex-direction:column-reverse;gap:var(--sb-s-2);padding:var(--sb-s-3) var(--sb-s-5);}#sb-overlay .sb-insert{width:100%;}#sb-overlay .sb-adjbox select,#sb-overlay .sb-adjbox input[type=number]{font-size:var(--sb-fs-16);}#sb-overlay .sb-linkrow{flex-wrap:wrap;}#sb-overlay .sb-linkinp{flex-basis:100%;}#sb-overlay .sb-linkbtn{width:100%;}}" +
    "@media(prefers-reduced-motion:reduce){#sb-overlay .sb-inp{transition:none;}}" +
    '#sb-trigger-picker .sb-tp-item{touch-action:manipulation;border-radius:8px;transition:background .12s ease;}' +
    '#sb-trigger-picker .sb-tp-item:hover{background:#F4F4F5;}';
  document.head.appendChild(s);
})();



// ── CHAT CAPTURE HANDLER ──────────────────────────────────────────
// The popup asks for the conversation on this page so it can be saved as
// memory. Kept as its own listener rather than a branch inside the context-menu
// one below, because that listener is fire-and-forget and never calls
// sendResponse; mixing a request/response exchange into it would mean either
// returning true from a handler that usually has nothing to send, or leaving
// this one unable to reply.
//
// Answers synchronously. Reading the DOM needs no await, so returning true here
// would hold a port open for nothing.
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (!msg || msg.type !== 'SB_CAPTURE_CHAT') return;
  try {
    var api = window.SBChatCapture;
    if (!api) { sendResponse({ ok: false, reason: 'unavailable' }); return; }
    var captured = api.capture();
    if (!captured) { sendResponse({ ok: false, reason: 'no_conversation' }); return; }
    sendResponse({ ok: true, data: { meta: captured, blocks: api.toBlocks(captured) } });
  } catch (e) {
    sendResponse({ ok: false, reason: 'error' });
  }
});


// ── CONTEXT MENU MESSAGE HANDLER ──────────────────────────────────
// Receives snippet from background.js when user clicks context menu
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.type !== 'SB_CONTEXT_INSERT') return;
  var snip = msg.snippet;
  if (!snip) return;

  var fields = extractFields(snip.body);
  var el = document.activeElement;

  // If no active editable element, try to find last focused one
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable && el.getAttribute('contenteditable') !== 'true')) {
    // Walk up from body to find contenteditable
    var found = document.querySelector('[contenteditable="true"]:focus, textarea:focus, input:focus');
    if (found) el = found;
  }

  activeEl = el;

  var vars = parsePlaceholders(snip.body);
  if (vars.length > 0) {
    processing = true;
    // The fill-in box takes focus, and the caret with it. Read where the caret,
    // or the selection the snippet replaces, sits now and put it back before
    // inserting, as handleMatch does for a typed trigger.
    var host = _isCEEl(el) ? _ceHost(el) : null;
    var endCO = host ? _ceCaretCharOffset(host) : -1;
    var startCO = host ? _ceCaretCharOffset(host, true) : -1;
    injectDynamicModal(vars, function(varMap) {
      var newBody = interpolateSnippet(snip.body, varMap);
      var modSnip = {};
      for (var k in snip) modSnip[k] = snip[k];
      modSnip.body = newBody;
      modSnip.blankPlaceholders = vars.filter(function(v) { return varMap[v] === ''; });
      if (startCO >= 0) _ceRestoreTriggerRange(el, endCO, endCO - startCO);
      _proceedContextInsert(el, modSnip);
    }, function() {
      processing = false;
    });
  } else {
    _proceedContextInsert(el, snip);
  }
});

function _proceedContextInsert(el, snip) {
  var fields = extractFields(snip.body);
  if (fields.length === 0) {
    var text = resolveBody(snip.body, {}, { lang: snip.lang });
    var isCE = el && (el.isContentEditable || (el.getAttribute &&
      (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')));
    var isValueField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    var pics = _pictureForm(snip);
    var html = pics && _takesFormatting(el) ? pics.formatted : null;

    // Nothing is in the field yet, so going back from the warning has nothing
    // to undo. Held as processing while it is open, like any other insert.
    processing = true;
    _checkThenInsert(el, snip, text, function(note) {
      note = _pictureNote(note, pics, html);
      if (isCE) {
        // Insert synchronously, then celebrate with Undo — same proven mechanism as
        // the trigger paths' CE sync-insert (see _proceedInsert): capture the inserted
        // region so restoreFieldState can Range-delete it. onUndo skips logEvent.
        var snapCE = captureFieldState(el, 0);
        var before = _ceMeasureBefore(el);
        insertText(el, text, html);
        _markSyncInserted(snapCE, el, before, text, html ? pics : null);
        showCelebration(
          text,
          function onConfirm() { logEvent(snip, 0); processing = false; },
          function onUndo()    { restoreFieldState(snapCE); processing = false; },
          { inserted: true, target: el, warning: reviewWarning(snip), note: note }
        );
      } else if (isValueField) {
        // Textarea/input: the context menu inserts synchronously (no trigger to
        // defer), so Undo can't just "skip" insertion like the trigger paths —
        // snapshot the exact pre-insert value + caret and restore it on Undo.
        var snapVal = captureFieldState(el, 0);
        snapVal.syncInsertedValue = true;
        snapVal.prevValue    = el.value;
        snapVal.prevSelStart = el.selectionStart;
        snapVal.prevSelEnd   = el.selectionEnd;
        insertText(el, text);
        showCelebration(
          text,
          function onConfirm() { logEvent(snip, 0); processing = false; },
          function onUndo()    { restoreFieldState(snapVal); processing = false; },
          { inserted: true, target: el, warning: reviewWarning(snip), note: note }
        );
      } else {
        // No editable target: do not claim that text was inserted.
        if (el) insertText(el, text);
        logEvent(snip, 0);
        processing = false;
      }
    }, function() { processing = false; });
  } else {
    processing = true;
    showOverlay(el, snip, 0, function() { processing = false; });
  }
}


// ── MEMORY-001: working-memory composer picker ───────────────────────────────
//
// Mounts only on the AI chat hosts memory-picker.js knows about, and only once
// the account actually has a step configured. A pill that opens onto "nothing
// here" on every page would be worse than no pill.

// Replace the whole composer, rather than inserting at the caret. The picker
// prepends context to what is already typed, so it hands over the full new
// value and this writes it as one edit, which keeps Undo to a single restore.
function sbMemorySetComposer(el, text) {
  if (!el) return;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    el.focus();
    el.value = text;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
    try { el.setSelectionRange(text.length, text.length); } catch(e) {}
    return;
  }

  // contenteditable: select everything, then let the paste path replace it.
  // _cePasteInsert consumes the selection with execCommand before dispatching,
  // which is the only sequence Lexical honours (see the v2.122.0 contract).
  var host = _ceHost(el) || el;
  host.focus();
  try {
    var range = document.createRange();
    range.selectNodeContents(host);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch(e) {}

  if (!_cePasteInsert(el, text)) insertText(el, text);
}

// The memory panel's view of one snippet: which fact it belongs to, and every
// translation of that fact. Both answers come from the functions a trigger
// expands through (the shared grouping rule and _findLangVariants), so the panel
// can never offer as two facts what a trigger treats as one snippet, and never
// means a different body by "Italian" than a trigger does.
//
// Null when the row is not in the local library. The panel then treats the
// search result as a fact on its own, which is exactly what it did before
// translations were grouped, so a cold cache degrades to the old behaviour
// rather than to anything wrong.
function sbMemorySnippetInfo(id) {
  var idx = _snipIndex();
  var key = idx.keyOf[String(id)];
  if (!key) return null;
  var group = idx.byKey[key];
  var row = null;
  for (var i = 0; group && i < group.rows.length; i++) {
    if (String(group.rows[i].id) === String(id)) { row = group.rows[i]; break; }
  }
  if (!row) return null;

  var found = _findLangVariants(row);
  var variants = {};
  Object.keys(found).forEach(function (lang) {
    variants[lang] = { id: String(found[lang].id), lang: lang, body: found[lang].body };
  });
  // stableKey survives a re-sort of the library, which `key` does not.
  return { groupKey: group.stableKey || key, lang: String(row.lang || ''), variants: variants };
}

// The languages context should come in, best first. The same order
// resolveVariant expands in: the user's default language, then the fixed
// fallback. A snippet's context therefore arrives in the language its trigger
// would have used.
function sbMemoryPreferredLangs(preferred) {
  var out = [];
  [preferred, 'EN', 'ES', 'IT', 'FR'].forEach(function (lang) {
    var code = String(lang == null ? '' : lang).toUpperCase();
    if (code && out.indexOf(code) === -1) out.push(code);
  });
  return out;
}

(function sbInitMemoryPicker() {
  if (typeof SBMemoryPicker === 'undefined' || typeof SBMemoryPack === 'undefined') return;
  if (!SBMemoryPicker.hostConfig(location.hostname)) return;

  function ask(type, payload, cb) {
    try {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function(res) {
        if (chrome.runtime.lastError || !res || !res.ok) { cb(new Error('unavailable')); return; }
        cb(null, res);
      });
    } catch(e) { cb(e); }
  }

  // Mounted unconditionally on a supported host. Until v3.21.0 this waited for
  // memory_index and bailed when the user had no STEPS configured, which meant
  // no pill at all unless someone had first created a step in SQL. The panel
  // searches instead of reading a step, so there is nothing left to configure
  // and nothing left to gate on.
  var BUDGET_KEY = 'sb_memory_budgets';

  var picker = SBMemoryPicker.create({
    search: function(query, cb) {
      ask('knowledge_search', { query: query, limit: 40 }, function(e, r) {
        if (e) { cb(e); return; }
        cb(null, r.rows || []);
      });
    },
    // {id, kind} pairs, not bare ids: snippets and memory items live in
    // different tables with different id types, and the background worker needs
    // the kind to know which one to ask.
    getBodies: function(items, cb) {
      ask('memory_bodies', { items: items }, function(e, r) {
        if (e) { cb(e); return; }
        cb(null, r.rows || []);
      });
    },
    // Translations of one snippet are one fact. The panel asks the local
    // library, through the same rule expansion uses, rather than working it out
    // from search results that cannot see it.
    snippetInfo: sbMemorySnippetInfo,
    preferredLangs: function() { return sbMemoryPreferredLangs(defaultLang); },
    insertText: sbMemorySetComposer,
    // Per-host, because the same package that reads well in one composer is a
    // wall of text in another. Failure is silent and falls back to the host
    // default: a budget preference is not worth an error message.
    //
    // storage.LOCAL, never sync. Anything in storage.sync roams to every Chrome
    // signed into the same Google account, which has already leaked a snippet
    // library and an API key between profiles, and the privacy policy now
    // promises local only. scripts/check-storage.js enforces that promise.
    loadBudget: function(host, cb) {
      try {
        chrome.storage.local.get(BUDGET_KEY, function(d) {
          var all = (d && d[BUDGET_KEY]) || {};
          cb(all[host] || null);
        });
      } catch(e) { cb(null); }
    },
    saveBudget: function(host, tokens) {
      try {
        chrome.storage.local.get(BUDGET_KEY, function(d) {
          var all = (d && d[BUDGET_KEY]) || {};
          all[host] = tokens;
          var patch = {};
          patch[BUDGET_KEY] = all;
          chrome.storage.local.set(patch);
        });
      } catch(e) {}
    }
  });
  picker.mount();

  // The keyboard shortcut, relayed by the service worker.
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg && msg.type === 'SB_OPEN_MEMORY_PANEL') picker.open();
  });
}());
