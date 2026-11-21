// my-details.js: the details of the person using a snippet, decided once.
//
// A snippet body may carry {my: name}, {my: company} or {my: job title}, and so
// may the seasonal line's wishes ("Merry Christmas from {my: company}."). Each
// prints what the account already holds, for whoever uses the snippet, so a
// signature written once signs for everyone in the team and nobody types it:
//
//   name       the account's name
//   company    the account's Company branding, else the one of whoever
//              created the person's team
//   job title  the job title the team holds for the person
//
// The server works them out (my_details(), migration 20261121120000) and every
// surface keeps the answer and hands it to set():
//
//   extension/background/background.js  asks for it with the library, keeps it
//                                       in chrome.storage.local (STORAGE_KEY)
//   extension/content/content.js        reads that copy, and again when it changes
//   extension/popup/popup.js            the same
//   app/src/lib/myDetails.ts            the dashboard
//   app/public/mobile/index.html        a generated copy of this file
//                                       (node scripts/sync-my-details.js)
//
// formula-engine.js prints a token through value(); a detail the account does
// not hold prints nothing, and a line left empty by it goes with it.
// shared/season.js fills a wish through fill(), which answers null when a
// detail is missing, so a wish never goes out as "Merry Christmas from ."
(function(root) {
  'use strict';

  var STORAGE_KEY = 'sb_my_details';
  var RPC = 'my_details';
  var MAX_VALUE = 80;

  // Each detail: the word written in the token, the key the server answers
  // with, and what the editor calls it.
  var DETAILS = [
    { word: 'name', key: 'name', label: 'Your name' },
    { word: 'company', key: 'company', label: 'Company name' },
    { word: 'job title', key: 'job_title', label: 'Job title' }
  ];

  var TOKEN_RE = /\{\s*my\s*:\s*([^{}]*?)\s*\}/gi;
  var YEAR_RE = /\{\s*year\s*\}/gi;

  // "Job Title", "job_title" and "job  title" are one word.
  function normalWord(raw) {
    return String(raw === null || raw === undefined ? '' : raw)
      .replace(/[_\s]+/g, ' ').replace(/^ | $/g, '').toLowerCase();
  }

  function detailOf(word) {
    var w = normalWord(word);
    for (var i = 0; i < DETAILS.length; i++) if (DETAILS[i].word === w) return DETAILS[i];
    return null;
  }

  /** The token the editor writes for a detail word: "{my: company}". */
  function token(word) {
    var d = detailOf(word);
    return d ? '{my: ' + d.word + '}' : '';
  }

  /** Whether a token's text (without braces, lower case) is a {my: …} token. */
  function isHead(tokLow) {
    return /^my\s*:/.test(String(tokLow));
  }

  /** The word after "my:" in a token's text, or '' when it names no detail. */
  function wordOf(tok) {
    var m = /^\s*my\s*:\s*(.*)$/i.exec(String(tok));
    var d = m ? detailOf(m[1]) : null;
    return d ? d.word : '';
  }

  /** What the editor calls a detail word: "Company name". */
  function label(word) {
    var d = detailOf(word);
    return d ? d.label : '';
  }

  // One line of plain text, no longer than MAX_VALUE.
  function cleanValue(raw) {
    if (typeof raw !== 'string') return '';
    return raw.replace(/\s+/g, ' ').replace(/^ | $/g, '').slice(0, MAX_VALUE);
  }

  /** The server's answer, kept to what it should hold: { name, company, job_title }. */
  function clean(raw) {
    var o = raw && typeof raw === 'object' ? raw : {};
    var out = {};
    for (var i = 0; i < DETAILS.length; i++) out[DETAILS[i].key] = cleanValue(o[DETAILS[i].key]);
    return out;
  }

  // The details of the person using this page. Each surface sets them once it
  // has asked the server, and again when they change.
  var current = clean(null);
  function set(raw) { current = clean(raw); }
  function get() { return current; }

  /** What a detail word prints for the person using this page: '' when unknown. */
  function value(word) {
    var d = detailOf(word);
    return d ? current[d.key] : '';
  }

  /** Every detail word a text uses, once each, in order. */
  function wordsIn(text) {
    var out = [], m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(String(text || ''))) !== null) {
      var d = detailOf(m[1]);
      if (d && out.indexOf(d.word) === -1) out.push(d.word);
    }
    return out;
  }

  /** The detail words a text uses that this account does not hold. */
  function missingIn(text) {
    return wordsIn(text).filter(function(w) { return value(w) === ''; });
  }

  /**
   * A sentence with its details filled in: every {my: …} token, and {year}
   * when `extra.year` is given. Null when one of them has no value, or names
   * a detail that does not exist, so the caller can fall back to something
   * whole rather than print a gap.
   */
  function fill(text, extra) {
    var ok = true;
    var out = String(text || '').replace(TOKEN_RE, function(all, word) {
      var d = detailOf(word);
      var v = d ? current[d.key] : '';
      if (v === '') ok = false;
      return v;
    });
    out = out.replace(YEAR_RE, function() {
      var y = extra && extra.year;
      if (!y) { ok = false; return ''; }
      return String(y);
    });
    return ok ? out : null;
  }

  var API = {
    STORAGE_KEY: STORAGE_KEY,
    RPC: RPC,
    MAX_VALUE: MAX_VALUE,
    DETAILS: DETAILS,
    token: token,
    isHead: isHead,
    wordOf: wordOf,
    label: label,
    clean: clean,
    set: set,
    get: get,
    value: value,
    wordsIn: wordsIn,
    missingIn: missingIn,
    fill: fill
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBMyDetails = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
