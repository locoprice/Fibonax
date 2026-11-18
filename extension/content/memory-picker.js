// WORKING-MEMORY COMPOSER PICKER (MEMORY-001).
//
// Mounts a "Context" pill next to the prompt box on AI chat sites. Pick a step,
// and the shards that step wants are prepended to whatever you have typed,
// inside the step's token budget.
//
// Two decisions worth knowing before changing anything here.
//
// 1. The context is INSERTED AS VISIBLE TEXT, above what you typed. It is not
//    held aside and merged at send time. Send-time merging looks tidier and is
//    how the competitor does it, but it means hooking every platform's send
//    button, which breaks on every redesign, and it means the user cannot see
//    what was actually sent. Visible text is editable, deletable and honest.
//
// 2. The pill FLOATS, anchored to the composer's bounding box, rather than
//    being injected into each site's own toolbar. Toolbars are the fastest
//    changing part of these apps. A floating anchor survives a redesign that
//    only moves things around, and degrades to a slightly odd position rather
//    than to nothing.
//
// Bodies are never fetched to draw the menu. The index carries name, summary
// and token cost, which is everything the ranking needs, so opening the picker
// costs one small request and picking a step fetches only the bodies that fit
// the budget. That split is the point of the feature.
//
// Ranking and budget live in extension/shared/memory-pack.js, kept in step with
// the TypeScript engine by scripts/check-memory-parity.js.
(function (root) {
  'use strict';

  var PACK = root.SBMemoryPack;

  // Composer selectors, best first. These WILL rot: every one of these apps
  // rewrites its editor periodically. That is why findComposer falls through to
  // a generic scan rather than giving up when the list misses.
  // `budget` is the default token ceiling for context on that host. It is not
  // about what the model can take: it is about what a wall of text above the
  // prompt does to a message you are still writing. Claude handles a longer
  // preamble comfortably; on the others a shorter one reads better. Overridable
  // per host from the panel.
  var DEFAULT_BUDGET = 1500;
  var HOSTS = [
    { match: /(^|\.)chatgpt\.com$/,        budget: 2000, sel: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'] },
    { match: /(^|\.)chat\.openai\.com$/,   budget: 2000, sel: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'] },
    { match: /(^|\.)claude\.ai$/,          budget: 4000, sel: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'] },
    { match: /(^|\.)gemini\.google\.com$/, budget: 2000, sel: ['div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]'] },
    { match: /(^|\.)grok\.com$/,           budget: 2000, sel: ['textarea', 'div[contenteditable="true"]'] },
    { match: /(^|\.)perplexity\.ai$/,      budget: 2000, sel: ['textarea', 'div[contenteditable="true"]'] },
    { match: /(^|\.)chat\.deepseek\.com$/, budget: 2000, sel: ['#chat-input', 'textarea'] },
    { match: /(^|\.)copilot\.microsoft\.com$/, budget: 2000, sel: ['textarea#userInput', 'textarea'] }
  ];

  /** The default budget for a hostname, or the conservative fallback. */
  function hostBudget(hostname) {
    var cfg = hostConfig(hostname);
    return (cfg && cfg.budget) || DEFAULT_BUDGET;
  }

  // Only the tail of the draft is used as the query. A long message is several
  // thoughts, and the one being written now is the one that needs context; the
  // opening paragraph would otherwise dominate every search.
  var QUERY_TAIL_CHARS = 600;

  function draftQuery(text) {
    var s = String(text == null ? '' : text);
    // Never search on our own injected block: it would match itself and rank
    // everything the user already has above everything they do not.
    if (PACK.stripInjectedBlock) s = PACK.stripInjectedBlock(s);
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    return s.length > QUERY_TAIL_CHARS ? s.slice(s.length - QUERY_TAIL_CHARS) : s;
  }

  function hostConfig(hostname) {
    for (var i = 0; i < HOSTS.length; i++) {
      if (HOSTS[i].match.test(hostname)) return HOSTS[i];
    }
    return null;
  }

  /**
   * The part of an element that is on screen: its box, cut down by every
   * ancestor that clips its content (overflow other than visible) and by the
   * viewport. A composer that holds more text than fits scrolls inside such an
   * ancestor, so its own box runs far above and below what the user sees.
   * Returns {top, left, right, bottom, width, height}; width or height of zero
   * when nothing of it shows.
   */
  function visibleRect(el, win) {
    var w = win || root;
    var r = el.getBoundingClientRect();
    var top = r.top, left = r.left, right = r.right, bottom = r.bottom;
    for (var node = el.parentElement; node; node = node.parentElement) {
      var cs = w.getComputedStyle ? w.getComputedStyle(node) : null;
      if (!cs) continue;
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      var c = node.getBoundingClientRect();
      if (c.top > top) top = c.top;
      if (c.left > left) left = c.left;
      if (c.right < right) right = c.right;
      if (c.bottom < bottom) bottom = c.bottom;
    }
    var vw = w.innerWidth || right;
    var vh = w.innerHeight || bottom;
    if (top < 0) top = 0;
    if (left < 0) left = 0;
    if (right > vw) right = vw;
    if (bottom > vh) bottom = vh;
    return {
      top: top, left: left, right: right, bottom: bottom,
      width: Math.max(0, right - left), height: Math.max(0, bottom - top)
    };
  }

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 16) return false;
    var cs = root.getComputedStyle ? root.getComputedStyle(el) : null;
    if (cs && (cs.visibility === 'hidden' || cs.display === 'none')) return false;
    return true;
  }

  /**
   * The prompt box on this page, or null.
   *
   * Tries the host's known selectors, then falls back to the largest visible
   * editable sitting in the lower half of the viewport, which is where a chat
   * composer lives on every one of these apps. The fallback is what keeps this
   * working the week after a redesign.
   */
  function findComposer(doc, hostname) {
    doc = doc || root.document;
    hostname = hostname || (root.location && root.location.hostname) || '';

    var cfg = hostConfig(hostname);
    if (cfg) {
      for (var i = 0; i < cfg.sel.length; i++) {
        var found = doc.querySelectorAll(cfg.sel[i]);
        for (var j = 0; j < found.length; j++) {
          if (isVisible(found[j])) return found[j];
        }
      }
    }

    // Only the lower half of the viewport, which is where a chat composer lives.
    // This used to widen to the whole page when the lower half had nothing, and
    // that is how the button ended up on settings pages and search boxes: any
    // large text box anywhere passed for a chat. A page the host's own
    // selectors miss and whose lower half holds no editable is not a chat.
    var candidates = doc.querySelectorAll('textarea, div[contenteditable="true"], p[contenteditable="true"]');
    var midpoint = (root.innerHeight || 800) / 2;

    var best = null;
    var bestArea = 0;
    for (var k = 0; k < candidates.length; k++) {
      var el = candidates[k];
      if (!isVisible(el)) continue;
      var rect = el.getBoundingClientRect();
      if (rect.top < midpoint) continue;
      var area = rect.width * rect.height;
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
  }

  /**
   * True when something the site drew sits on top of the composer: a settings
   * window, a dialog, a full-page menu. The button floats above the page, so
   * without this it stayed in sight over whatever covered the chat. Tested at
   * the middle of the composer's visible part; what is found there has to be
   * the composer, something inside it (its text, its placeholder), or
   * something around it. `skip` is the button's own host.
   */
  function isCovered(el, rect, doc, skip) {
    if (typeof doc.elementFromPoint !== 'function') return false;
    var hit = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || hit === skip) return false;
    return !(el === hit || el.contains(hit) || hit.contains(el));
  }

  function readComposer(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.textContent || '';
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  // Shadow DOM, because this renders inside someone else's stylesheet. Colors
  // are the literal design tokens (docs/DESIGN_SYSTEM.md); the extension's
  // token stylesheet is not loaded on a third-party page.
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    // At rest the button is the Fibonax T and nothing else. Clicked, it widens
    // to show "Context" while the panel is open, then folds back.
    '.pill{display:inline-flex;align-items:center;height:28px;min-width:28px;padding:0 4px;background:#FFFFFF;',
    'border:1px solid #BED0FF;border-radius:999px;font-size:12px;font-weight:600;color:#1B4FD8;',
    'cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.06);line-height:1.2}',
    '.pill:hover{background:#EEF2FF}',
    '.pill:focus-visible{outline:2px solid #1B4FD8;outline-offset:2px}',
    '.pill[data-active="1"]{background:#EEF2FF;border-color:#1B4FD8}',
    '.pill svg{width:18px;height:18px;flex:0 0 auto}',
    '.lbl{max-width:0;margin:0;overflow:hidden;white-space:nowrap;opacity:0;',
    'transition:max-width .18s ease,opacity .18s ease,margin .18s ease}',
    '.pill[data-active="1"] .lbl{max-width:80px;margin:0 6px 0 4px;opacity:1}',
    '@media (prefers-reduced-motion:reduce){.lbl{transition:none}}',
    '.menu{position:absolute;bottom:calc(100% + 8px);left:0;width:300px;max-height:340px;overflow-y:auto;',
    'background:#FFFFFF;border:1px solid #E5E5EA;border-radius:12px;padding:6px;',
    'box-shadow:0 4px 20px rgba(27,79,216,.12),0 1px 3px rgba(0,0,0,.06)}',
    '.hd{padding:8px 10px 6px;font-size:10px;font-weight:700;letter-spacing:.08em;',
    'text-transform:uppercase;color:#6B6B70}',
    '.row{display:block;width:100%;text-align:left;padding:8px 10px;border:0;background:transparent;',
    'border-radius:8px;cursor:pointer;font-size:13px;color:#1C1C1E}',
    '.row:hover{background:#EEF2FF}',
    '.row .nm{font-weight:600;display:block}',
    '.row .sub{display:block;font-size:11px;color:#6E6E73;margin-top:2px}',
    '.empty{padding:10px;font-size:12px;color:#6E6E73;line-height:1.5}',
    '.toast{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#FFFFFF;',
    'border:1px solid #BED0FF;border-radius:10px;font-size:12px;line-height:1.45;color:#1C1C1E;',
    'box-shadow:0 4px 20px rgba(27,79,216,.12)}',
    // The message takes the room that is left and wraps only once the toast has
    // hit the width cap; min-width:0 is what lets a flex child wrap at all.
    '.toast>span{flex:1 1 auto;min-width:0}',
    // Undo keeps its own size whatever the message does. Without this it is the
    // flex item that gives way, and the button is the part that must stay
    // clickable.
    '.undo{flex:0 0 auto;white-space:nowrap;',
    'padding:4px 10px;background:transparent;border:1.5px solid #BED0FF;border-radius:7px;',
    'font-size:11px;font-weight:600;color:#1B4FD8;cursor:pointer}',
    // ── Injection panel (MEMORY-002 I1) ──
    // The panel is a flex column with its own scroll region, so clamping its
    // height shortens the LIST and never pushes the footer out of reach. The
    // outer .menu scroll is turned off here for the same reason.
    '.panel{width:380px;padding:0;overflow:hidden;display:flex;flex-direction:column}',
    '.plist{overflow-y:auto;min-height:0;padding:0 6px 2px}',
    '.ptop{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:8px 10px 4px}',
    '.ptitle{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B6B70}',
    '.pcount{font-size:11px;color:#6E6E73;font-variant-numeric:tabular-nums}',
    '.pcount.over{color:#D70015;font-weight:600}',
    // What the panel adds: prompts, Brain items, or both. One track, three
    // equal parts; the chosen one is the raised white part in bold, so the
    // choice never rests on colour alone.
    '.pmode{display:flex;gap:2px;margin:2px 10px 6px;padding:2px;background:#F2F2F7;border-radius:8px;flex:0 0 auto}',
    '.seg{flex:1 1 0;min-width:0;height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;',
    'font-size:12px;font-weight:500;color:#3A3A3C;cursor:pointer}',
    '.seg:hover{color:#1C1C1E}',
    '.seg[aria-checked="true"]{background:#FFFFFF;color:#1B4FD8;font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.12)}',
    '.seg:focus-visible{outline:2px solid #1B4FD8;outline-offset:1px}',
    // Search inside the panel, so finding an item never depends on what is in
    // the message box.
    '.psearch{display:block;width:calc(100% - 20px);height:30px;margin:0 10px 6px;padding:0 10px;flex:0 0 auto;',
    'border:1px solid #E5E5EA;border-radius:8px;background:#FFFFFF;font-size:13px;color:#1C1C1E;outline:0}',
    '.psearch::placeholder{color:#6E6E73}',
    '.psearch:focus{border-color:#1B4FD8;box-shadow:0 0 0 2px #BED0FF}',
    '.item{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer}',
    '.item:hover{background:#EEF2FF}',
    '.item input{margin:2px 0 0;width:14px;height:14px;flex:0 0 auto;accent-color:#1B4FD8;cursor:pointer}',
    '.item .txt{min-width:0;flex:1}',
    '.item .nm{display:block;font-size:13px;font-weight:600;color:#1C1C1E;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.item .sub{display:block;font-size:11px;color:#6E6E73;margin-top:1px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.kind{display:inline-block;padding:0 5px;border-radius:999px;background:#F2F2F7;',
    'font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6B6B70;margin-right:5px}',
    // A deprecated fact still inserts; the row says it is out of date first
    // (AI-KNOWLEDGE P2). The extension's warning amber, --sb-warn / --sb-warn-bg.
    '.dep{display:inline-block;padding:0 5px;border-radius:999px;background:#FFFBEB;',
    'font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#D97706;margin-right:5px}',
    // The language a fact will be inserted in. Same shape as .kind so the row
    // reads as one line of labels, blue because it is the one that does
    // something when clicked.
    '.lang{display:inline-block;padding:0 5px;border:1px solid #BED0FF;border-radius:999px;background:#FFFFFF;',
    'font:inherit;font-size:9px;font-weight:700;letter-spacing:.04em;line-height:inherit;color:#1B4FD8;',
    'margin-right:4px;cursor:pointer;vertical-align:baseline}',
    '.lang:hover{background:#EEF2FF}',
    // Why a Brain item was ticked without being asked: it usually goes in with
    // the prompt named. Blue on the panel's blue tint, cut with an ellipsis so
    // a long prompt name never pushes the rest of the line out.
    '.why{display:inline-block;max-width:190px;padding:0 5px;border-radius:999px;background:#EEF2FF;',
    'font-size:9px;font-weight:700;letter-spacing:.02em;color:#1B4FD8;margin-right:5px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}',
    '.pfoot{display:flex;align-items:center;gap:6px;padding:6px 10px 8px;border-top:1px solid #E5E5EA;flex:0 0 auto}',
    '.btn{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid #1B4FD8;',
    'background:#1B4FD8;color:#fff}',
    '.btn:hover{background:#1440B0;border-color:#1440B0}',
    '.btn:disabled{opacity:.5;cursor:default}',
    '.btn.ghost{background:transparent;color:#1B4FD8;border-color:#BED0FF}',
    '.btn.ghost:hover{background:#EEF2FF}',
    '.spacer{flex:1}',
    '.bsel{padding:4px 6px;border:1px solid #E5E5EA;border-radius:7px;background:#fff;',
    'font-size:11px;color:#1C1C1E;cursor:pointer}',
    '.loading{padding:14px 10px;font-size:12px;color:#6E6E73}'
  ].join('');

  // The Fibonax T, as on the landing page (landing/leib-tour-icon.png), drawn
  // as strokes so it stays sharp at button size and needs no file from the
  // extension: three lines a side, each a bar that turns down into the stem.
  var T_MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" ' +
    'aria-hidden="true" focusable="false"><path d="' +
    'M0.8 2.4H9.6L11.1 4.6V19.4L12 20.6M2.2 3.8H8.4L9.7 5.8V18.6L12 20.9M3.6 5.2H7L8.1 6.9V17.4L12 21.3' +
    'M23.2 2.4H14.4L12.9 4.6V19.4L12 20.6M21.8 3.8H15.6L14.3 5.8V18.6L12 20.9M20.4 5.2H17L15.9 6.9V17.4L12 21.3' +
    '"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // What a row's badge says. The database calls a Brain item 'memory'; the
  // person reading the list calls it a Brain.
  var KIND_LABELS = { memory: 'Brain', prompt: 'Prompt', snippet: 'Snippet' };

  function kindLabel(kind) {
    return KIND_LABELS[kind] || kind;
  }

  // ── What the panel adds: prompts, Brain items, or both ───────────────────
  //
  // One choice at the top of the panel decides what is searched, listed and
  // inserted. It is remembered on this device. `kinds` is what the search is
  // asked for; the rest is the wording each choice shows.
  // How long the typing has to stop before the panel searches.
  var SEARCH_PAUSE_MS = 300;
  var DEFAULT_MODE = 'both';
  var MODE_ORDER = ['prompt', 'brains', 'both'];
  var MODES = {
    prompt: { label: 'Prompts', kinds: ['prompt'], noun: 'your prompts',
              loading: 'Looking through your prompts…', search: 'Search your prompts' },
    brains: { label: 'Brains', kinds: ['memory'], noun: 'your Brains',
              loading: 'Looking through your Brains…', search: 'Search your Brains' },
    both:   { label: 'Both', kinds: ['memory', 'prompt'], noun: 'your prompts or Brains',
              loading: 'Looking through your prompts and Brains…', search: 'Search your prompts and Brains' }
  };

  /** A saved choice, or the default when it is missing or not one of ours. */
  function normaliseMode(mode) {
    return Object.prototype.hasOwnProperty.call(MODES, mode) ? mode : DEFAULT_MODE;
  }

  /** The kinds the search returns for a choice. */
  function kindsForMode(mode) {
    return MODES[normaliseMode(mode)].kinds.slice();
  }

  /**
   * The ticked facts that stay when the list is replaced by a new search or a
   * new choice: still ticked, and of a kind the choice adds. Searching for a
   * second item must not untick the first, and switching to Brains must drop a
   * ticked prompt, since the choice says what goes in.
   */
  function carryChecked(facts, checked, mode) {
    var kinds = kindsForMode(mode);
    var out = [];
    var list = facts || [];
    for (var i = 0; i < list.length; i++) {
      if (checked && checked[list[i].id] && kinds.indexOf(list[i].kind) !== -1) out.push(list[i]);
    }
    return out;
  }

  /** Carried facts first, then what the search found, each fact once. */
  function mergeCarried(carried, facts) {
    var seen = {};
    var out = [];
    var i;
    for (i = 0; i < carried.length; i++) { seen[carried[i].id] = true; out.push(carried[i]); }
    for (i = 0; i < facts.length; i++) {
      if (!seen[facts[i].id]) out.push(facts[i]);
    }
    return out;
  }

  /**
   * The order items go into the message: prompts first, then Brain items, each
   * group in the order the engine ranked it. A prompt says what to do and a
   * Brain item says what to know, so with both in one block the instructions
   * lead and the facts follow, instead of the two taking turns by score.
   */
  function orderForInsert(items) {
    var prompts = [];
    var rest = [];
    var list = items || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind === 'prompt') prompts.push(list[i]);
      else rest.push(list[i]);
    }
    return prompts.concat(rest);
  }

  // ── One fact, one row (injection step A) ─────────────────────────────────
  //
  // A snippet translated into four languages is four rows in the database and
  // four search results, and until this it was four rows in the panel, all
  // pre-selected, costing four bodies. These turn search rows into facts before
  // anything is shown. Which rows are one fact is not decided here: that comes
  // from the local library through the same rule expansion uses.

  // The order a fact's languages are listed and cycled through.
  var LANG_ORDER = ['EN', 'ES', 'IT', 'FR', 'MULTI'];

  function languagesOf(variants) {
    var known = [];
    var other = [];
    for (var lang in variants) {
      if (!Object.prototype.hasOwnProperty.call(variants, lang)) continue;
      if (LANG_ORDER.indexOf(lang) === -1) other.push(lang);
      else known.push(lang);
    }
    known.sort(function (a, b) { return LANG_ORDER.indexOf(a) - LANG_ORDER.indexOf(b); });
    other.sort();
    return known.concat(other);
  }

  // A one-line description of a body the search did not return: its first
  // non-empty line, capped like the view caps a summary.
  function summaryOf(body) {
    var lines = String(body == null ? '' : body).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, '');
      if (line) return line.slice(0, 280);
    }
    return '';
  }

  // The first preferred language the fact actually has. A fact with none of
  // them keeps the language of the row the search matched, if it can.
  function firstPreferred(langs, preferredLangs, fallback) {
    var prefs = preferredLangs || [];
    for (var i = 0; i < prefs.length; i++) {
      if (langs.indexOf(prefs[i]) !== -1) return prefs[i];
    }
    if (fallback && langs.indexOf(fallback) !== -1) return fallback;
    return langs[0];
  }

  /**
   * Point a fact at one of its translations: the row to fetch at insert, and
   * what the panel shows. The search described the row it matched, in that
   * row's language, so any other translation is described from the local
   * library instead. Showing a French summary and a French token count while
   * inserting the Italian body would misstate both.
   */
  function useTranslation(fact, lang) {
    var variant = fact.variants && fact.variants[lang];
    if (!variant) return;
    fact.lang = lang;
    fact.variantId = variant.id;
    if (variant.id === fact.matched.id && lang === fact.matched.lang) {
      fact.tokens = fact.matched.tokens;
      fact.summary = fact.matched.summary;
    } else {
      fact.tokens = PACK.estimateTokens(variant.body);
      fact.summary = summaryOf(variant.body);
    }
  }

  /**
   * knowledge_search rows in, facts out, in the order the search ranked them.
   *
   * `snippetInfo(id)` answers from the local library, or null when the row is
   * not there, in which case that row is a fact on its own, exactly as before
   * translations were grouped. The engine collapses each group and chooses the
   * member in the earliest preferred language; a fact with several translations
   * then gets the first preferred language among ALL of them, including ones the
   * search did not match, since the draft may have matched only the French
   * wording of a fact the user reads in Italian.
   */
  function factsFromSearchRows(rows, snippetInfo, preferredLangs) {
    var candidates = [];
    var info = {};
    var list = rows || [];
    for (var i = 0; i < list.length; i++) {
      var candidate = PACK.candidateFromSearchRow(list[i]);
      if (candidate.kind === 'snippet' && snippetInfo) {
        var known = snippetInfo(candidate.id);
        if (known) {
          candidate.groupKey = known.groupKey;
          candidate.lang = known.lang;
          info[candidate.id] = known;
        }
      }
      candidates.push(candidate);
    }

    var clusters = PACK.clusterCandidates(candidates, preferredLangs || []);
    var facts = [];
    for (var j = 0; j < clusters.length; j++) {
      // Already a copy, carrying the fact's best rank.
      var fact = clusters[j].candidate;
      var local = info[fact.id];
      var langs = local ? languagesOf(local.variants) : [];
      if (langs.length > 1) {
        fact.matched = { id: fact.id, lang: fact.lang, tokens: fact.tokens, summary: fact.summary };
        fact.variants = local.variants;
        fact.langs = langs;
        useTranslation(fact, firstPreferred(langs, preferredLangs, fact.lang));
      }
      facts.push(fact);
    }
    return facts;
  }

  // ── Usually added together ───────────────────────────────────────────────
  //
  // With Both chosen, the panel remembers which Brain items went into a
  // message beside which prompt, and ticks them the next time that prompt is
  // ticked. It is a tally of ids, kept on this device and nowhere else:
  //
  //   { <prompt id>: { n: <inserts with this prompt>, t: <last one, ms>,
  //                    w: { <Brain item id>: <inserts with both> } } }
  //
  // No names and no text are kept. What a suggested item is called and how
  // long it is are read fresh when it is suggested, so a renamed item shows its
  // new name and a deleted one is never offered.
  var PAIR_MIN_TOGETHER = 2;   // added together at least twice,
  var PAIR_MIN_SHARE = 0.5;    // and in at least half of that prompt's inserts
  var PAIR_MAX_SUGGESTED = 3;  // the most a prompt brings with it
  var PAIR_AGE_AT = 21;        // past this many inserts a prompt's tally is halved
  var PAIR_MAX_PARTNERS = 21;  // Brain items remembered per prompt
  var PAIR_MAX_PROMPTS = 144;  // prompts remembered

  /**
   * The tally after one insert. `items` is what went into the message, as
   * {id, kind}. Answers with the same object when there is nothing to learn:
   * no prompt went in.
   *
   * Halving at PAIR_AGE_AT is what lets a habit change: an item added with a
   * prompt twenty times last spring and never since falls under the share
   * within a few weeks of use, instead of being suggested for good.
   */
  function recordInsert(store, items, now) {
    var prompts = [];
    var brains = [];
    var list = items || [];
    var i, j;
    for (i = 0; i < list.length; i++) {
      if (list[i].kind === 'prompt') prompts.push(String(list[i].id));
      else if (list[i].kind === 'memory') brains.push(String(list[i].id));
    }
    if (!prompts.length) return store;

    var next = {};
    var id;
    for (id in store) {
      if (Object.prototype.hasOwnProperty.call(store, id)) next[id] = store[id];
    }

    for (i = 0; i < prompts.length; i++) {
      var old = next[prompts[i]] || { n: 0, t: 0, w: {} };
      var tally = {};
      for (id in old.w) {
        if (Object.prototype.hasOwnProperty.call(old.w, id)) tally[id] = old.w[id];
      }
      for (j = 0; j < brains.length; j++) tally[brains[j]] = (tally[brains[j]] || 0) + 1;

      var count = old.n + 1;
      var ids = Object.keys(tally);
      if (count > PAIR_AGE_AT) {
        count = count / 2;
        for (j = 0; j < ids.length; j++) tally[ids[j]] = tally[ids[j]] / 2;
      }
      ids.sort(function (a, b) { return tally[b] - tally[a] || a.localeCompare(b); });
      var kept = {};
      for (j = 0; j < ids.length && j < PAIR_MAX_PARTNERS; j++) {
        // Under a half, an item is a habit long gone.
        if (tally[ids[j]] >= 0.5) kept[ids[j]] = tally[ids[j]];
      }
      next[prompts[i]] = { n: count, t: now, w: kept };
    }

    // The prompts used longest ago go first when the tally is full.
    var all = Object.keys(next);
    if (all.length > PAIR_MAX_PROMPTS) {
      all.sort(function (a, b) { return next[b].t - next[a].t || a.localeCompare(b); });
      var trimmed = {};
      for (i = 0; i < PAIR_MAX_PROMPTS; i++) trimmed[all[i]] = next[all[i]];
      next = trimmed;
    }
    return next;
  }

  /** The Brain item ids usually added with a prompt, most usual first. */
  function usualPartners(store, promptId) {
    var entry = store && Object.prototype.hasOwnProperty.call(store, promptId) ? store[promptId] : null;
    if (!entry || !entry.w || !(entry.n > 0)) return [];
    var ids = [];
    for (var id in entry.w) {
      if (!Object.prototype.hasOwnProperty.call(entry.w, id)) continue;
      if (entry.w[id] >= PAIR_MIN_TOGETHER && entry.w[id] / entry.n >= PAIR_MIN_SHARE) ids.push(id);
    }
    ids.sort(function (a, b) { return entry.w[b] - entry.w[a] || a.localeCompare(b); });
    return ids.slice(0, PAIR_MAX_SUGGESTED);
  }

  // A fact starts ticked only when it scores close to the best one. The rest are
  // listed, unticked, for the user to add. See preselect().
  var PRESELECT_RATIO = 0.8;

  /**
   * The facts the panel opens with ticked, as {id: true}.
   *
   * The common case is accepting what was suggested, so the panel opens with a
   * usable selection rather than an empty one. But knowledge_search returns
   * everything that plausibly matches, and a draft about an airport also matches
   * a reply that happens to mention the client. Ticking all of it put those in
   * the box too, which is exactly what made injected context read as noise. So
   * only facts within PRESELECT_RATIO of the best score start ticked; the looser
   * ones stay visible, one click away.
   *
   * Nothing is ticked for a browse. An empty composer, or one holding only
   * greetings and function words, has nothing to match, and knowledge_search
   * answers with a recency listing scored zero throughout. Ticking that would
   * present the last things the user edited as relevant.
   *
   * Top down, and a fact that does not fit the budget is skipped rather than
   * ending the loop, so a short one ranked below a long one still gets in: the
   * same rule the engine applies at insert.
   */
  function preselect(facts, budget) {
    var list = facts || [];
    var top = 0;
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].rank > top) top = list[i].rank;
    }

    var picked = {};
    if (top <= 0) return picked;

    var used = 0;
    for (i = 0; i < list.length; i++) {
      var fact = list[i];
      if (fact.rank < PRESELECT_RATIO * top) continue;
      if (used + fact.tokens <= budget) {
        picked[fact.id] = true;
        used += fact.tokens;
      }
    }
    return picked;
  }

  /**
   * @param {object} deps
   *   search(query, kinds, cb)  cb(err, rows): knowledge_search rows of those kinds, no bodies
   *   loadMode(cb)              cb(mode|null): the saved Prompts / Brains / Both choice
   *   saveMode(mode)            persists that choice
   *   loadPairs(cb)             cb(store|null): the "usually added together" tally (see recordInsert)
   *   savePairs(store)          persists that tally
   *   getFacts(ids, cb)         cb(err, rows): Brain items by id, shaped like search rows, no bodies
   *   snippetInfo(id)           {groupKey, lang, variants} or null: the local library's view of a snippet
   *   preferredLangs()          language codes, best first: the order context should arrive in
   *   getBodies(items, cb)      cb(err, rows): bodies for accepted {id, kind} pairs only
   *   insertText(el, text, prev) writes into the composer; the surface's own inserter
   *   loadBudget(host, cb)      cb(tokens|null) — the user's override for this site
   *   saveBudget(host, tokens)  persists that override
   *   doc, win                  overridable for the test harness
   */
  function create(deps) {
    var doc = deps.doc || root.document;
    var win = deps.win || root;

    var host = doc.createElement('div');
    host.setAttribute('data-sb-memory', '1');
    host.style.cssText = 'position:fixed;z-index:2147483646;display:none';
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = doc.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    var wrap = doc.createElement('div');
    wrap.style.cssText = 'position:relative';
    shadow.appendChild(wrap);

    var pill = doc.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.setAttribute('aria-label', 'Context');
    pill.setAttribute('aria-expanded', 'false');
    pill.title = 'Add context from your Brains';
    pill.innerHTML = T_MARK + '<span class="lbl">Context</span>';
    wrap.appendChild(pill);

    var menu = null;
    var composer = null;
    var lastUndo = null;

    // Anchored to the part of the composer the user can see, not to the text
    // element itself. Once a composer fills up, the text scrolls inside a box of
    // fixed height, and the element's own top edge moves far above that box:
    // the pill followed it up the page, away from the field it belongs to.
    function position() {
      if (!composer) { host.style.display = 'none'; return; }
      var r = visibleRect(composer, win);
      if (r.width < 80 || r.height <= 0 || isCovered(composer, r, doc, host)) {
        host.style.display = 'none';
        return;
      }
      host.style.display = 'block';
      host.style.left = Math.round(r.left) + 'px';
      host.style.top = Math.round(r.top - 34) + 'px';
    }

    // The composer grows as text goes in, whether typed or inserted from this
    // panel, and nothing scrolls while it does. Without this the pill kept its
    // old place until the next refresh tick.
    var sizeWatch = typeof win.ResizeObserver === 'function'
      ? new win.ResizeObserver(function () { position(); })
      : null;

    function closeMenu() {
      if (menu) { menu.remove(); menu = null; }
      pill.setAttribute('data-active', '0');
      pill.setAttribute('aria-expanded', 'false');
    }

    // ── Injection panel (MEMORY-002 I1) ────────────────────────────────────
    //
    // Replaces the step menu. The draft in the composer is the query: nothing
    // to configure, nothing to pick from a list of phases someone had to create
    // in SQL first. The panel is a chooser, not a decider; buildContext in
    // memory-pack.js stays the single selection authority and runs at insert,
    // on real bodies.

    var results = [];      // ContextCandidates from the last search, ranked
    var deprecated = {};   // id -> true for rows the search reports as deprecated
    var checked = {};      // id -> true, the user's choices
    var budget = 0;        // token ceiling for this host
    var searching = false;
    var mode = DEFAULT_MODE;  // what the panel adds: 'prompt', 'brains' or 'both'
    var typed = '';           // the panel's own search box; empty means "match my message"
    var searchSeq = 0;        // only the newest search may fill the list
    var typeTimer = null;
    var listFloor = 0;        // the tallest the list has been since the panel opened
    var lastFound = 0;        // how many facts the last search itself returned
    var pairs = {};           // the "usually added together" tally, read when the panel opens
    var suggested = {};       // Brain item id -> {by, name, auto}: the prompt that brought it
    var brought = {};         // prompt id -> true once its usual items were offered

    // True while the panel itself is showing: not closed, and not the toast.
    function isPanelOpen() {
      return !!menu && menu.className === 'menu panel';
    }

    function checkedCandidates() {
      var out = [];
      for (var i = 0; i < results.length; i++) {
        if (checked[results[i].id]) out.push(results[i]);
      }
      return out;
    }

    function checkedTokens() {
      var picked = checkedCandidates();
      var total = 0;
      for (var i = 0; i < picked.length; i++) total += picked[i].tokens;
      return total;
    }

    function renderPanel() {
      // Every render replaces the list, which snapped it back to the top on each
      // tick. That was tolerable for a checkbox and is not for switching the
      // language of the eighth row, so the scroll position is carried across.
      var previousList = menu ? menu.querySelector('.plist') : null;
      var scrollTop = previousList ? previousList.scrollTop : 0;

      // The same goes for the keyboard: a render in the middle of typing a
      // search, or of walking the three choices with the arrows, must hand the
      // focus back where it was.
      var focused = (menu && shadow.activeElement && menu.contains(shadow.activeElement))
        ? shadow.activeElement : null;
      var focusSearch = !!focused && focused.className === 'psearch';
      var focusMode = !!focused && focused.className === 'seg';
      var caret = focusSearch ? [focused.selectionStart, focused.selectionEnd] : null;

      closeMenu();
      menu = doc.createElement('div');
      menu.className = 'menu panel';

      var wording = MODES[mode];
      var query = typed.replace(/^\s+|\s+$/g, '');
      var used = checkedTokens();
      var over = used > budget;
      var html = '<div class="ptop"><span class="ptitle">Add context</span>' +
                 '<span class="pcount' + (over ? ' over' : '') + '">' +
                 used + ' / ' + budget + ' tokens</span></div>';

      html += '<div class="pmode" role="radiogroup" aria-label="What to add">';
      for (var s = 0; s < MODE_ORDER.length; s++) {
        var chosen = MODE_ORDER[s] === mode;
        html += '<button type="button" class="seg" role="radio" data-mode="' + MODE_ORDER[s] + '"' +
                ' aria-checked="' + (chosen ? 'true' : 'false') + '" tabindex="' + (chosen ? '0' : '-1') + '">' +
                MODES[MODE_ORDER[s]].label + '</button>';
      }
      html += '</div>';

      html += '<input class="psearch" type="text" autocomplete="off" spellcheck="false"' +
              ' placeholder="' + esc(wording.search) + '" aria-label="' + esc(wording.search) + '"' +
              ' value="' + esc(typed) + '">';

      // Only this list scrolls. The header and footer stay put, so Insert is
      // reachable however short the panel has been clamped.
      html += '<div class="plist">';
      // A typed search that found nothing says so even when ticked facts are
      // still listed under it: they were carried in, not found.
      if (!searching && (query ? !lastFound : !results.length)) {
        html += query
          ? '<div class="empty">Nothing in ' + wording.noun + ' matches "' + esc(query) + '".' +
            '<br>Try another word.</div>'
          : '<div class="empty">Nothing in ' + wording.noun + ' matches what you are writing.' +
            '<br>Search above, or keep typing and press Refresh.</div>';
      } else if (!searching && !anyMatched()) {
        // A browse, not a match. Say so rather than letting a list of recent
        // items read as a list of relevant ones.
        html += '<div class="empty">Your most recent items, not matches.' +
                '<br>Search above, or type your message and press Refresh.</div>';
      }
      if (results.length || searching) {
        // While a search runs the list holds the ticked facts being carried
        // into it, so they stay in sight, with the wait named under them.
        for (var i = 0; i < results.length; i++) {
          var c = results[i];
          var on = checked[c.id] ? ' checked' : '';
          // A fact with translations names the one it will insert, and that
          // name is the control for choosing another.
          var langHtml = '';
          if (c.langs && c.langs.length > 1) {
            langHtml = '<button type="button" class="lang" data-lang-for="' + esc(c.id) + '"' +
                       ' title="Switch language" aria-label="' +
                       esc('Inserting ' + c.lang + '. Switch language') + '">' + esc(c.lang) + '</button>' +
                       c.langs.length + ' languages · ';
          }
          // A Brain item a prompt brought with it says so, in words.
          var whyHtml = '';
          if (suggested[c.id]) {
            var why = 'Usually with ' + suggested[c.id].name;
            whyHtml = '<span class="why" title="' + esc('You usually add this with ' + suggested[c.id].name) + '">' +
                      esc(why) + '</span>';
          }
          html += '<label class="item"><input type="checkbox" data-id="' + esc(c.id) + '"' + on + '>' +
                  '<span class="txt"><span class="nm">' + esc(c.name) + '</span>' +
                  '<span class="sub">' + (deprecated[c.id] ? '<span class="dep">Deprecated</span>' : '') +
                  '<span class="kind">' + esc(kindLabel(c.kind)) + '</span>' + whyHtml + langHtml +
                  c.tokens + 't · ' + esc(c.summary || 'No summary') + '</span></span></label>';
        }
        if (searching) html += '<div class="loading" role="status">' + wording.loading + '</div>';
      }
      html += '</div>';

      html += '<div class="pfoot">' +
              '<select class="bsel" title="Token budget for this site">' +
              budgetOptions(budget) + '</select>' +
              '<button class="btn ghost" data-act="refresh" type="button">Refresh</button>' +
              '<span class="spacer"></span>';
      if (PACK.hasInjectedBlock(readComposer(composer))) {
        html += '<button class="btn ghost" data-act="remove" type="button">Remove</button>';
      }
      html += '<button class="btn" data-act="insert" type="button"' +
              (checkedCandidates().length ? '' : ' disabled') + '>Insert ' +
              checkedCandidates().length + '</button></div>';

      menu.innerHTML = html;
      wrap.appendChild(menu);
      pill.setAttribute('data-active', '1');
      pill.setAttribute('aria-expanded', 'true');
      placeMenu();
      wirePanel();

      // After placeMenu, which may have clamped the height the offset lives in.
      var list = menu.querySelector('.plist');
      // The panel grows upward from the message box, so a list that got
      // shorter would pull the search box down from under the cursor in the
      // middle of a word. While the panel is open the list keeps the tallest
      // height it has had; it can still give way when the window is short.
      if (list) {
        if (list.offsetHeight < listFloor) list.style.flexBasis = listFloor + 'px';
        else listFloor = list.offsetHeight;
      }
      if (list && scrollTop) list.scrollTop = scrollTop;

      var back = focusSearch ? menu.querySelector('.psearch')
        : focusMode ? menu.querySelector('.seg[aria-checked="true"]') : null;
      if (back) {
        back.focus();
        if (caret) back.setSelectionRange(caret[0], caret[1]);
      }
    }

    function budgetOptions(current) {
      var choices = [1000, 1500, 2000, 3000, 4000, 8000];
      var html = '';
      var seen = false;
      for (var i = 0; i < choices.length; i++) {
        if (choices[i] === current) seen = true;
        html += '<option value="' + choices[i] + '"' +
                (choices[i] === current ? ' selected' : '') + '>' + choices[i] + ' tokens</option>';
      }
      if (!seen) {
        html = '<option value="' + current + '" selected>' + current + ' tokens</option>' + html;
      }
      return html;
    }

    /**
     * Put the panel on the side with more room, and never let it exceed that
     * room.
     *
     * The previous rule flipped downward whenever the upward panel did not fit,
     * without asking whether downward fitted either. On these sites the
     * composer sits at the bottom of the window, so downward is almost always
     * the worse side: the panel flipped into the space under the composer and
     * ran straight off the bottom of the screen.
     *
     * Measuring both sides fixes that, and clamping the height to whatever was
     * measured is what makes the fix hold. Without the clamp the panel would
     * still overflow the side it chose, just less often.
     */
    function placeMenu() {
      if (!menu) return;

      var GAP = 8;
      // 340 for the list, footer and title the panel always had, plus the two
      // rows above the list (the choice and the search box).
      var MAX = 412;
      // Below this a panel is not usable, and a page short enough to trigger it
      // is not a chat composer. Clamping to the floor and accepting a little
      // overflow beats rendering something nobody can read.
      var MIN = 140;

      var anchor = host.getBoundingClientRect();
      var viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 0;

      var roomAbove = anchor.top - GAP;
      var roomBelow = viewportHeight - anchor.bottom - GAP;

      // Ties go upward: it is where the room usually is, and a panel that stays
      // put between openings is less disorienting than one that hops sides.
      var openUpward = roomAbove >= roomBelow;
      var room = openUpward ? roomAbove : roomBelow;

      if (openUpward) {
        menu.style.top = 'auto';
        menu.style.bottom = 'calc(100% + ' + GAP + 'px)';
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = 'calc(100% + ' + GAP + 'px)';
      }

      menu.style.maxHeight = Math.round(Math.max(MIN, Math.min(room, MAX))) + 'px';
    }

    function wirePanel() {
      var boxes = menu.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) {
        boxes[i].addEventListener('change', function (e) {
          var id = e.currentTarget.getAttribute('data-id');
          var fact = factById(id);
          if (e.currentTarget.checked) checked[id] = true;
          else delete checked[id];
          // A tick or an untick made by hand is the user's from here on: the
          // prompt that brought the item no longer takes it away.
          if (suggested[id]) suggested[id].auto = false;
          if (fact && fact.kind === 'prompt') {
            if (e.currentTarget.checked) bringPartners([fact]);
            else dropPartners(id);
          }
          renderPanel();
        });
      }

      var sel = menu.querySelector('.bsel');
      if (sel) {
        sel.addEventListener('change', function (e) {
          budget = parseInt(e.currentTarget.value, 10) || budget;
          deps.saveBudget(hostname(), budget);
          autoCheck();
          renderPanel();
        });
      }

      var buttons = menu.querySelectorAll('button[data-act]');
      for (var k = 0; k < buttons.length; k++) {
        buttons[k].addEventListener('click', function (e) {
          var act = e.currentTarget.getAttribute('data-act');
          // Refresh reads the message again and starts the ticks over. With a
          // search typed in the panel it runs that search again instead, and
          // what is ticked stays.
          if (act === 'refresh') search(!!typed.replace(/\s+/g, ''));
          else if (act === 'insert') insertChecked();
          else if (act === 'remove') removeBlock();
        });
      }

      // Prompts, Brains or Both. A click chooses; so do the arrow keys, the
      // way a group of radio buttons moves.
      var segs = menu.querySelectorAll('.seg');
      for (var g = 0; g < segs.length; g++) {
        segs[g].addEventListener('click', function (e) {
          setMode(e.currentTarget.getAttribute('data-mode'));
        });
        segs[g].addEventListener('keydown', function (e) {
          var step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
            : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          e.stopPropagation();
          var at = MODE_ORDER.indexOf(mode);
          setMode(MODE_ORDER[(at + step + MODE_ORDER.length) % MODE_ORDER.length]);
        });
      }

      // The panel's own search. It searches a moment after the typing stops, or
      // at once on Enter. Escape empties the box, then closes the panel. The
      // keys stop here so the page's own shortcuts never fire while a word is
      // being typed into the panel.
      var box = menu.querySelector('.psearch');
      if (box) {
        box.addEventListener('input', function (e) {
          typed = e.currentTarget.value;
          if (typeTimer) win.clearTimeout(typeTimer);
          typeTimer = win.setTimeout(function () {
            typeTimer = null;
            // Closed in the meantime: searching now would open it again.
            if (isPanelOpen()) search(true);
          }, SEARCH_PAUSE_MS);
        });
        box.addEventListener('keydown', function (e) {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            search(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            if (typed) { typed = ''; search(true); }
            else closeMenu();
          }
        });
        box.addEventListener('keyup', function (e) { e.stopPropagation(); });
        box.addEventListener('keypress', function (e) { e.stopPropagation(); });
      }

      // One click, the next translation. The selection is left exactly as the
      // user set it: switching a language is not a reason to re-decide what
      // goes in.
      var langButtons = menu.querySelectorAll('button[data-lang-for]');
      for (var m = 0; m < langButtons.length; m++) {
        langButtons[m].addEventListener('click', function (e) {
          // The button sits inside the row's label, and a click that reached
          // the label would also toggle the checkbox it wraps.
          e.preventDefault();
          e.stopPropagation();
          var id = e.currentTarget.getAttribute('data-lang-for');
          for (var r = 0; r < results.length; r++) {
            var fact = results[r];
            if (fact.id !== id || !fact.langs) continue;
            useTranslation(fact, fact.langs[(fact.langs.indexOf(fact.lang) + 1) % fact.langs.length]);
            break;
          }
          renderPanel();
        });
      }
    }

    function hostname() {
      return (win.location && win.location.hostname) || '';
    }

    // See preselect(): the rule lives outside the panel so the gate can test it.
    function autoCheck() {
      checked = preselect(results, budget);
    }

    /** True when a search ran and something matched it. */
    function anyMatched() {
      for (var i = 0; i < results.length; i++) {
        if (results[i].rank > 0) return true;
      }
      return false;
    }

    /**
     * Fill the list. The words typed into the panel's search box are the
     * query; with the box empty, the message being written is, as before.
     *
     * `keep` carries the ticked facts into the new list (see carryChecked): a
     * search typed in the panel and a change of Prompts / Brains / Both both
     * pass it. Without it the ticks start over from what matches the message,
     * which is what opening the panel and Refresh do.
     *
     * Facts are ticked by the panel only when it matched the message and
     * nothing was carried. A typed search ticks nothing: every letter would
     * tick something, and each of those would then be carried along.
     */
    function search(keep) {
      if (!composer) return;
      if (typeTimer) { win.clearTimeout(typeTimer); typeTimer = null; }

      var query = typed.replace(/^\s+|\s+$/g, '');
      var carried = keep ? carryChecked(results, checked, mode) : [];
      // Starting over from the message also forgets what the prompts brought.
      if (!keep) { suggested = {}; brought = {}; }
      var seq = ++searchSeq;
      var i;
      // Until the answer arrives the list is what was carried and nothing
      // else, so Insert can never add a fact the new choice leaves out.
      results = carried;
      checked = {};
      for (i = 0; i < carried.length; i++) checked[carried[i].id] = true;
      searching = true;
      renderPanel();

      deps.search(query || draftQuery(readComposer(composer)), kindsForMode(mode), function (err, rows) {
        // An answer to an older question: a newer search is on its way, and
        // letting this one in would show results for words already replaced.
        if (seq !== searchSeq) return;
        searching = false;
        // Closed, or showing the note that follows an insert: filling the list
        // now would open the panel again over it.
        if (!isPanelOpen()) return;

        // What is ticked now, not what was when the search began: a prompt's
        // usual Brain items may have arrived in between.
        carried = carryChecked(results, checked, mode);

        var facts = [];
        var flagged = {};
        for (i = 0; i < carried.length; i++) {
          if (deprecated[carried[i].id]) flagged[carried[i].id] = true;
        }
        if (!err && rows) {
          // knowledge_search leaves archived items out and reports the rest
          // with their review status.
          for (var r = 0; r < rows.length; r++) {
            if (rows[r] && rows[r].review_status === 'deprecated') flagged[rows[r].source_id] = true;
          }
          // Facts, not rows. Grouping runs before anything is shown because the
          // panel is where the user decides, and a translated snippet listed
          // four times is four decisions about one thing.
          facts = factsFromSearchRows(rows, deps.snippetInfo,
            deps.preferredLangs ? deps.preferredLangs() : []);
        }
        deprecated = flagged;
        lastFound = facts.length;
        results = mergeCarried(carried, facts);

        // What was carried stays ticked, which is why `checked` is left alone
        // unless the panel is choosing afresh from the message.
        if (!query && !carried.length) autoCheck();

        // Every ticked prompt brings the Brain items it usually goes in with.
        var tickedPrompts = [];
        for (i = 0; i < results.length; i++) {
          if (checked[results[i].id] && results[i].kind === 'prompt') tickedPrompts.push(results[i]);
        }
        bringPartners(tickedPrompts);
        renderPanel();
      });
    }

    function factById(id) {
      for (var i = 0; i < results.length; i++) {
        if (results[i].id === id) return results[i];
      }
      return null;
    }

    // Mark a Brain item as brought by a prompt, and tick it when it fits the
    // budget. One the user already ticked is theirs and is left as it is.
    function offer(fact, prompt) {
      if (fact.kind !== 'memory' || checked[fact.id] || suggested[fact.id]) return;
      var fits = checkedTokens() + fact.tokens <= budget;
      suggested[fact.id] = { by: prompt.id, name: prompt.name, auto: fits };
      if (fits) checked[fact.id] = true;
    }

    /**
     * Usually added together: tick the Brain items that usually go in with
     * these prompts (see recordInsert). Only with Both chosen, and once per
     * prompt for as long as it stays ticked, so an item unticked by hand is
     * not ticked again behind the user's back.
     *
     * Items already in the list are ticked where they are. The others are read
     * by id, without their text, and listed right under their prompt.
     */
    function bringPartners(prompts) {
      if (mode !== 'both' || !deps.getFacts) return;

      var missing = [];
      var bringer = {};   // Brain item id -> the prompt that brings it
      for (var p = 0; p < prompts.length; p++) {
        var prompt = prompts[p];
        if (brought[prompt.id]) continue;
        brought[prompt.id] = true;
        var ids = usualPartners(pairs, prompt.id);
        for (var i = 0; i < ids.length; i++) {
          var listed = factById(ids[i]);
          if (listed) offer(listed, prompt);
          else if (!bringer[ids[i]]) { bringer[ids[i]] = prompt; missing.push(ids[i]); }
        }
      }
      if (!missing.length) return;

      deps.getFacts(missing, function (err, rows) {
        // A suggestion that cannot be read is simply not made.
        if (err || !rows || !rows.length || !isPanelOpen() || mode !== 'both') return;

        var facts = factsFromSearchRows(rows, deps.snippetInfo,
          deps.preferredLangs ? deps.preferredLangs() : []);
        for (var r = 0; r < rows.length; r++) {
          if (rows[r] && rows[r].review_status === 'deprecated') deprecated[rows[r].source_id] = true;
        }

        var placed = {};   // prompt id -> how many rows already sit under it
        for (var f = 0; f < facts.length; f++) {
          var by = bringer[facts[f].id];
          // The prompt was unticked or searched away while this was read.
          if (!by || !checked[by.id] || !factById(by.id) || factById(facts[f].id)) continue;
          var at = results.indexOf(factById(by.id)) + 1 + (placed[by.id] || 0);
          results.splice(at, 0, facts[f]);
          placed[by.id] = (placed[by.id] || 0) + 1;
          offer(facts[f], by);
        }
        renderPanel();
      });
    }

    // A prompt was unticked: the Brain items it brought go with it, unless the
    // user has ticked or unticked them by hand since.
    function dropPartners(promptId) {
      delete brought[promptId];
      for (var id in suggested) {
        if (!Object.prototype.hasOwnProperty.call(suggested, id) || suggested[id].by !== promptId) continue;
        if (suggested[id].auto) delete checked[id];
        delete suggested[id];
      }
    }

    function setMode(next) {
      next = normaliseMode(next);
      if (next === mode) return;
      mode = next;
      // The choice changed what a prompt can bring, so that starts over.
      suggested = {};
      brought = {};
      if (deps.saveMode) deps.saveMode(mode);
      search(true);
    }

    function openPanel() {
      if (!composer) return;
      if (!budget) budget = hostBudget(hostname());
      // Every opening starts from the message, with the search box empty.
      typed = '';
      listFloor = 0;
      deps.loadBudget(hostname(), function (saved) {
        if (saved) budget = saved;
        loadChoice(function () {
          loadTally(function () { search(false); });
        });
      });
    }

    function loadChoice(done) {
      if (!deps.loadMode) { done(); return; }
      deps.loadMode(function (savedMode) {
        mode = normaliseMode(savedMode);
        done();
      });
    }

    function loadTally(done) {
      if (!deps.loadPairs) { done(); return; }
      deps.loadPairs(function (saved) {
        pairs = saved || {};
        done();
      });
    }

    // Remember which Brain items went in beside which prompt. Only with Both
    // chosen: under Prompts no Brain item can go in, and counting those
    // inserts would make every pair look rarer than it is.
    function learnFrom(items) {
      if (mode !== 'both' || !deps.loadPairs || !deps.savePairs) return;
      // Read again first: another tab may have learned something since this
      // panel opened, and saving the copy held here would undo it.
      deps.loadPairs(function (saved) {
        var before = saved || {};
        pairs = recordInsert(before, items, Date.now());
        if (pairs !== before) deps.savePairs(pairs);
      });
    }

    function insertChecked() {
      var picked = checkedCandidates();
      if (!picked.length || !composer) return;

      // Kind travels with the id: the kinds are stored in different tables,
      // and keying anything on a bare id would collide the day a snippet id and
      // a shard id match, which uuid-shaped snippet ids make possible.
      // The row to fetch is the chosen translation's, which is not always the
      // row the search matched.
      var wanted = [];
      for (var i = 0; i < picked.length; i++) {
        wanted.push({ id: picked[i].variantId || picked[i].id, kind: picked[i].kind });
      }

      deps.getBodies(wanted, function (err, rows) {
        if (err) { toast('Could not load that context.', null); return; }

        var byKey = {};
        for (var j = 0; j < rows.length; j++) {
          byKey[rows[j].kind + ':' + rows[j].id] = rows[j];
        }

        // Bodies are in hand, so the engine can do the real work: floor,
        // deduplicate on actual text, budget, and compress to a summary when a
        // body will not fit. An item whose body did not come back is dropped by
        // the engine and reported below, never inserted as an empty heading.
        var candidates = [];
        for (var k = 0; k < picked.length; k++) {
          var c = picked[k];
          var row = byKey[c.kind + ':' + (c.variantId || c.id)];
          // One translation, read the way expansion reads it: a translation
          // can live inside another row's `bodies` map.
          var body = !row ? '' : (c.lang ? PACK.bodyForLang(row, c.lang) : row.body);
          candidates.push({
            id: c.id, kind: c.kind, name: c.name, summary: c.summary,
            // A prompt carrying a Brain comes back finished and counted again:
            // its search count was the reference, not the Brain.
            body: body || '', tokens: (row && typeof row.tokens === 'number') ? row.tokens : c.tokens,
            pinned: false, rank: c.rank, contentHash: ''
          });
        }

        // No relevance floor here. Everything in this list was ticked in the
        // panel, in plain sight. The floor is for a package nobody chose, and
        // it used to drop a fact ticked from the recent list as soon as it
        // went in beside one found by a search, under "did not fit".
        var pack = PACK.buildContext({ candidates: candidates, budget: budget, minRank: 0 });

        var unavailable = 0;
        for (var n = 0; n < pack.dropped.length; n++) {
          if (pack.dropped[n].reason === 'no-body') unavailable++;
        }

        if (!pack.items.length) {
          // Two different failures, and conflating them sends someone to change
          // a budget that was never the problem.
          toast(unavailable
            ? 'That content could not be loaded. Try refreshing.'
            : 'Nothing fitted in the budget.', null);
          return;
        }

        var current = readComposer(composer);
        // Replacing rather than stacking: inserting twice should refresh the
        // context, not leave two blocks arguing with each other.
        var draft = PACK.stripInjectedBlock(current);
        // One block either way. With prompts and Brain items together, the
        // prompts lead: see orderForInsert.
        var block = PACK.formatInjectedBlock({ items: orderForInsert(pack.items) });

        deps.insertText(composer, block + draft, current);
        lastUndo = { el: composer, text: current };
        learnFrom(pack.items);

        var note = pack.items.length + ' item' + (pack.items.length === 1 ? '' : 's') +
                   ', ' + pack.usedTokens + ' tokens';
        var compressed = 0;
        for (var m = 0; m < pack.items.length; m++) if (pack.items[m].compressed) compressed++;
        if (compressed) note += ' · ' + compressed + ' shortened to fit';
        if (pack.deduped.length) note += ' · ' + pack.deduped.length + ' duplicate removed';
        if (unavailable) note += ' · ' + unavailable + ' could not be loaded';
        if (pack.dropped.length - unavailable > 0) {
          note += ' · ' + (pack.dropped.length - unavailable) + ' did not fit';
        }
        toast(note, undo);
      });
    }

    function removeBlock() {
      if (!composer) return;
      var current = readComposer(composer);
      var stripped = PACK.stripInjectedBlock(current);
      if (stripped === current) { toast('No context to remove.', null); return; }
      deps.insertText(composer, stripped, current);
      lastUndo = { el: composer, text: current };
      toast('Context removed.', undo);
    }

    function undo() {
      if (!lastUndo) return;
      deps.insertText(lastUndo.el, lastUndo.text, null);
      lastUndo = null;
    }

    function toast(message, onUndo) {
      closeMenu();
      var t = doc.createElement('div');
      t.className = 'menu';
      t.style.padding = '0';
      t.style.border = '0';
      t.style.boxShadow = 'none';
      t.style.overflow = 'visible';
      // `auto` looks like the right answer and is not. The toast is absolutely
      // positioned, so shrink-to-fit measures it against its containing block,
      // and that block is the wrapper around the pill: about 90px. A one-line
      // message wrapped onto three and the box came out taller than it was
      // wide. `max-content` sizes it to the message instead.
      t.style.width = 'max-content';
      t.innerHTML = '<div class="toast"><span>' + esc(message) + '</span>' +
                    (onUndo ? '<button class="undo" type="button">Undo</button>' : '') + '</div>';
      wrap.appendChild(t);
      menu = t;

      // Two clamps, because width alone cannot solve it. A long message (every
      // count carries its own clause) has to stay narrow enough to read, and the
      // pill sits wherever the composer does, which on a split screen is inches
      // from the right edge.
      //
      // First the width: never wider than the panel that opened it, and never
      // wider than the window. Past that the message wraps, which is fine.
      var viewportWidth = win.innerWidth || doc.documentElement.clientWidth || 0;
      t.style.maxWidth = Math.round(Math.max(160, Math.min(380, viewportWidth - 32))) + 'px';

      // Then the position. `.menu` pins its left edge to the pill, so a toast
      // opened near the right edge runs off it. Slide it back by exactly the
      // overrun rather than squeezing the text into whatever room is left, and
      // stop at the pill's own offset so it can never leave on the other side.
      var edge = host.getBoundingClientRect().left;
      var overflow = Math.round(edge + t.getBoundingClientRect().width + 16 - viewportWidth);
      if (overflow > 0) t.style.left = '-' + Math.min(overflow, Math.round(edge)) + 'px';
      // Same anchoring as the panel: a toast under a bottom-anchored composer
      // would run off screen for exactly the same reason.
      placeMenu();
      if (onUndo) {
        var b = t.querySelector('.undo');
        if (b) b.addEventListener('click', function () { onUndo(); closeMenu(); });
      }
      win.setTimeout(function () { if (menu === t) closeMenu(); }, 6000);
    }

    pill.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (menu) { closeMenu(); return; }
      openPanel();
    });

    doc.addEventListener('click', function (e) {
      if (menu && e.target !== host) closeMenu();
    }, true);

    function refresh() {
      var found = findComposer(doc, (win.location && win.location.hostname) || '');
      if (found !== composer) {
        if (sizeWatch) {
          sizeWatch.disconnect();
          if (found) sizeWatch.observe(found);
        }
        composer = found;
        closeMenu();
      }
      position();
    }

    return {
      host: host,
      shadow: shadow,
      mount: function (into) {
        (into || doc.body).appendChild(host);
        refresh();
        win.addEventListener('scroll', position, true);
        win.addEventListener('resize', position);
        // Windows such as a site's settings open on a click or a key, and
        // nothing scrolls when they do. Look again just after, so the button
        // leaves with the chat instead of waiting for the next tick.
        // Plain typing never opens a window, so only shortcuts and Escape count.
        function recheck() { win.setTimeout(position, 200); }
        doc.addEventListener('click', recheck, true);
        doc.addEventListener('keyup', function (e) {
          if (e.key === 'Escape' || e.ctrlKey || e.metaKey || e.altKey) recheck();
        }, true);
        // Composers get re-created on navigation inside these single-page apps,
        // so a one-time lookup goes stale within a click or two.
        win.setInterval(refresh, 1500);
      },
      refresh: refresh,
      position: position,
      /** The keyboard shortcut's entry point, and the pill's. */
      open: openPanel,
      close: closeMenu,
      getComposer: function () { return composer; }
    };
  }

  var API = {
    findComposer: findComposer,
    hostConfig: hostConfig,
    kindLabel: kindLabel,
    normaliseMode: normaliseMode,
    kindsForMode: kindsForMode,
    carryChecked: carryChecked,
    mergeCarried: mergeCarried,
    orderForInsert: orderForInsert,
    recordInsert: recordInsert,
    usualPartners: usualPartners,
    readComposer: readComposer,
    factsFromSearchRows: factsFromSearchRows,
    preselect: preselect,
    visibleRect: visibleRect,
    PRESELECT_RATIO: PRESELECT_RATIO,
    create: create
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBMemoryPicker = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
