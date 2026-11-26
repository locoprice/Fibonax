// SEARCHING SNIPPETS, PROMPTS AND BRAINS: one rule for "does this match, and why".
//
// Every search box reads this file: the popup, the menu a trigger opens on a
// page, the phone (an inlined copy, scripts/sync-asset-search.js) and the
// dashboard (app/src/lib/searchIndex.ts, held to this file by
// app/src/__tests__/assetSearch.test.ts). A snippet used to be found by its
// text on the dashboard and the phone and only by its name in the extension,
// which is the one place people look for it while they are writing.
//
// The rule:
//   1. The typed words are looked for one by one. Every word has to be
//      somewhere in the asset; the order and the distance between them do not
//      matter ("parking hours" finds a text that says "hours of the parking").
//   2. An asset is read through everything it carries: what its row prints
//      (name, trigger), its search keywords, its labels and its text.
//   3. A result whose row already shows every word ranks above one found
//      through something the row does not show (the popup and the menu list
//      them in that order, so Enter still picks the one named that way). The
//      second kind says why on a line of its own: the keyword, the label, or
//      the piece of text around the word.
//   4. Text is read the way a person reads it: a field or a formula counts as
//      the name it carries, never as the code that writes it, so "formtext"
//      finds nothing and a field called "address" is found by "address".
//   5. Capitals and accents never matter: "cafe" finds "Café", and "RESUME"
//      finds "résumé".
(function (root) {
  'use strict';

  // Characters of text kept on each side of the word that was found.
  var RADIUS = 40;

  // A token the engine reads: {formtext: name=x}, {=price*2}, {brain: id=…},
  // and the ones that close a rule or a button: {endif}, {else}, {/case}.
  // Any other bare {word} is left alone: in a prompt it is the person's text.
  var TOKEN_RE = /\{(?:=|\/?[a-z]+:)[^{}]*\}|\{(?:endif|else|\/[a-z]+)\}/gi;
  var TOKEN_NAME_RE = /(?:^|[;:{]\s*)name=([^;}]*)/i;

  // An accent counts as the letter under it: "cafe" finds "Café". A letter is
  // split into its base and its marks, and the marks (U+0300 to U+036F) are
  // dropped. Both ranges are built from their codes, so no invisible character
  // sits in this file.
  var MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  var WIDE = new RegExp('[' + String.fromCharCode(0x80) + '-' + String.fromCharCode(0xffff) + ']');
  var foldCache = {}, foldCount = 0;

  // Lower case with the accents off, and never a change in the length of the
  // text, so a position found in the folded copy is the same position in the
  // text that is printed.
  function lower(text) {
    if (!WIDE.test(text)) return text.toLowerCase();
    var hit = foldCache[text];
    if (hit !== undefined) return hit;
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      var low = c.toLowerCase();
      if (low.length !== 1) low = low.charAt(0) || c;
      var base = c.charCodeAt(0) < 0x80 ? low : low.normalize('NFD').replace(MARKS, '');
      out += base.length === 1 ? base : low;
    }
    // Bounded, like the cache of readable texts below.
    if (foldCount >= 5000) { foldCache = {}; foldCount = 0; }
    foldCache[text] = out; foldCount++;
    return out;
  }

  function str(value) {
    return value == null ? '' : String(value);
  }

  function list(values) {
    return Array.isArray(values) ? values : [];
  }

  /** The typed words, lower case, each one once. */
  function words(query) {
    var parts = lower(str(query)).split(/\s+/), out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && out.indexOf(parts[i]) === -1) out.push(parts[i]);
    }
    return out;
  }

  var readCache = {}, readCount = 0;

  /** A text as a person reads it: tokens as the name they carry, on one line. */
  function readable(text) {
    var raw = str(text);
    if (!raw) return '';
    var hit = readCache[raw];
    if (hit !== undefined) return hit;
    var out = raw, before, pass = 0;
    // An inner token first, then the one around it.
    do {
      before = out;
      out = out.replace(TOKEN_RE, function (token) {
        var named = TOKEN_NAME_RE.exec(token);
        return named ? ' ' + named[1] + ' ' : ' ';
      });
    } while (out !== before && ++pass < 4);
    // A field taken out leaves its space behind, never in front of a comma.
    out = out.replace(/\s+/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
    // Bounded: a library is a few thousand texts, typed over many times.
    if (readCount >= 5000) { readCache = {}; readCount = 0; }
    readCache[raw] = out; readCount++;
    return out;
  }

  function holds(texts, word) {
    for (var i = 0; i < texts.length; i++) {
      if (lower(str(texts[i])).indexOf(word) > -1) return true;
    }
    return false;
  }

  function firstHolding(texts, word) {
    for (var i = 0; i < texts.length; i++) {
      if (lower(str(texts[i])).indexOf(word) > -1) return str(texts[i]);
    }
    return '';
  }

  /**
   * The piece of `text` around the first of `wanted` it holds, cut at whole
   * words: { kind: 'Text', before, hit, after }. Null when it holds none.
   */
  function excerpt(text, wanted) {
    var plain = readable(text), low = lower(plain);
    var at = -1, word = '';
    for (var i = 0; i < wanted.length; i++) {
      var found = low.indexOf(wanted[i]);
      if (found > -1 && (at === -1 || found < at)) { at = found; word = wanted[i]; }
    }
    if (at === -1) return null;
    var end = at + word.length;
    var from = Math.max(0, at - RADIUS), to = Math.min(plain.length, end + RADIUS);
    if (from > 0) {
      var gap = plain.indexOf(' ', from);
      from = (gap > -1 && gap < at) ? gap + 1 : from;
    }
    if (to < plain.length) {
      var back = plain.lastIndexOf(' ', to);
      to = back > end ? back : to;
    }
    return {
      kind: 'Text',
      before: (from > 0 ? '…' : '') + plain.slice(from, at),
      hit: plain.slice(at, end),
      after: plain.slice(end, to) + (to < plain.length ? '…' : '')
    };
  }

  /**
   * How an asset answers what was typed.
   *
   * asset:
   *   shown    what its row prints: name, trigger, a preview
   *   keywords its search keywords
   *   labels   the names of its labels
   *   also     read without a reason given: the Brain an item sits in
   *   text     its texts, one per language
   *
   * Returns null when a word is nowhere in it. Otherwise { rank, why }:
   *   rank 2   the row already shows every word
   *   rank 1   found through something the row does not show
   *   why      what to print under the row, or null:
   *            { kind: 'Keyword' | 'Label', value } or
   *            { kind: 'Text', before, hit, after }
   *
   * Nothing typed matches everything and explains nothing.
   */
  function look(query, asset) {
    var wanted = words(query);
    if (!wanted.length) return { rank: 2, why: null };
    var a = asset || {};
    var shown = list(a.shown), keywords = list(a.keywords), labels = list(a.labels), also = list(a.also);
    var text = list(a.text).map(readable);
    var hidden = [];
    for (var i = 0; i < wanted.length; i++) {
      var word = wanted[i];
      if (holds(shown, word)) continue;
      if (!holds(keywords, word) && !holds(labels, word) && !holds(also, word) && !holds(text, word)) return null;
      hidden.push(word);
    }
    if (!hidden.length) return { rank: 2, why: null };
    var why = null;
    for (var h = 0; h < hidden.length && !why; h++) {
      var keyword = firstHolding(keywords, hidden[h]);
      if (keyword) { why = { kind: 'Keyword', value: keyword }; break; }
      var label = firstHolding(labels, hidden[h]);
      if (label) why = { kind: 'Label', value: label };
    }
    for (var t = 0; t < text.length && !why; t++) why = excerpt(text[t], hidden);
    return { rank: 1, why: why };
  }

  function esc(value) {
    return str(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** `why` as the line under a row, escaped, the found word inside <mark>. */
  function whyHtml(why) {
    if (!why) return '';
    if (why.kind === 'Text') return esc(why.before) + '<mark>' + esc(why.hit) + '</mark>' + esc(why.after);
    return why.kind + ': ' + esc(why.value);
  }

  var API = {
    fold: function (text) { return lower(str(text)); },
    words: words,
    readable: readable,
    excerpt: excerpt,
    look: look,
    whyHtml: whyHtml
  };

  // UMD: browser globals, CommonJS (the node gate and the dashboard's test).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBAssetSearch = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
