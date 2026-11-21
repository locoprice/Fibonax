// season.js: the seasonal line of a snippet, decided once.
//
// A snippet body may carry {seasonal}. While an occasion is in season the token
// prints that occasion's sentence ("Merry Christmas."); the rest of the year it
// prints nothing and leaves no empty line behind. One snippet then reads as if
// it had been rewritten for the season, with nobody touching it.
//
// Which occasion is in season comes from one calendar per person:
//
//   three ready occasions   Christmas, New Year and Easter (found every year)
//   up to MAX_OWN of theirs  a name, a period and a sentence each: a closing
//                            week, new opening hours, an anniversary
//
// One occasion is in season at a time. When two periods overlap, the person's
// own occasion wins over a ready one, then the one whose day is closest to
// today, then the one with the shorter period.
//
// The calendar is written in the dashboard (Your occasions) and kept with the
// account's settings (user metadata, META_KEY), the way the trigger settings
// are, so every surface reads the same list:
//
//   extension/auth/auth.js           copies it to chrome.storage.local (STORAGE_KEY)
//   extension/content/content.js     reads that copy, and again when it changes
//   extension/popup/popup.js         the same
//   app/src/lib/season.ts            the dashboard (preview and Your occasions)
//   app/public/mobile/index.html     a generated copy of this file
//                                    (node scripts/sync-season.js)
//
// Each surface hands the list to set() once. formula-engine.js asks
// currentLine() when it meets {seasonal}, and shared/fill-form.js asks
// describe() for the line a fill form shows ("Christmas wishes included").
// Dates are read off the clock of the device that sends the message.
//
// A sentence is written per language (LANGS), and the snippet's language picks
// it. It may carry the details of whoever sends it ("Merry Christmas from
// {my: company}.", shared/my-details.js) and {year}, the year of the
// occasion's own day, so New Year's wishes sent on 28 December already name
// the year to come. When the snippet's language has no sentence, or one of its
// details is missing, a ready occasion prints its ready words instead: a wish
// never goes out half filled. An occasion of the person's own has no ready
// words, so it falls back to a sentence written in another language, and
// prints nothing when a detail is missing.
(function(root) {
  'use strict';

  var META_KEY = 'occasions';
  var STORAGE_KEY = 'sb_occasions';
  var MAX_OWN = 10;
  var MAX_NAME = 30;
  var MAX_TEXT = 160;
  // The languages a sentence is written in: the four the ready words speak.
  var LANGS = ['EN', 'IT', 'ES', 'FR'];
  // The longest calendar the account may keep. The account's settings travel
  // with every request it makes, so the calendar must stay small.
  var MAX_PACKED = 4000;
  var YEAR_TOKEN = '{year}';
  var EASTER_BEFORE_MAX = 60;
  var EASTER_AFTER_MAX = 14;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var TOKEN = '{seasonal}';
  var TOKEN_RE = /\{\s*seasonal\s*\}/i;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
  var MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // The ready occasions. `day` is the day itself, which is what "closest to
  // today" is measured against. Easter has no fixed day: its period is counted
  // in days around Easter Sunday. The sentences speak the four languages
  // {greeting} speaks; any other language reads the English one.
  var READY = [
    { id: 'christmas', name: 'Christmas', from: '12-08', to: '12-26', day: '12-25',
      words: { EN: 'Merry Christmas.', IT: 'Buon Natale.', ES: 'Feliz Navidad.', FR: 'Joyeux Noël.' } },
    { id: 'newyear', name: 'New Year', from: '12-27', to: '01-06', day: '01-01',
      words: { EN: 'Happy New Year.', IT: 'Buon anno.', ES: 'Feliz Año Nuevo.', FR: 'Bonne année.' } },
    { id: 'easter', name: 'Easter', before: 7, after: 1,
      words: { EN: 'Happy Easter.', IT: 'Buona Pasqua.', ES: 'Feliz Pascua.', FR: 'Joyeuses Pâques.' } }
  ];

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function readyById(id) {
    for (var i = 0; i < READY.length; i++) if (READY[i].id === id) return READY[i];
    return null;
  }

  // One line of plain text, no longer than `max`.
  function cleanText(raw, max) {
    if (typeof raw !== 'string') return '';
    return raw.replace(/\s+/g, ' ').replace(/^ | $/g, '').slice(0, max);
  }

  // A day of the year as the calendar stores it: 'MM-DD'. 29 February counts.
  function dayOk(value) {
    var m = typeof value === 'string' ? /^(\d{2})-(\d{2})$/.exec(value) : null;
    if (!m) return false;
    var month = Number(m[1]), day = Number(m[2]);
    return month >= 1 && month <= 12 && day >= 1 && day <= MONTH_DAYS[month - 1];
  }

  function wholeNumber(value, fallback, max) {
    var n = typeof value === 'number' ? Math.floor(value) : NaN;
    return isFinite(n) && n >= 0 && n <= max ? n : fallback;
  }

  // A sentence per language, every one of LANGS present: '' where none.
  function cleanTexts(raw) {
    var o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var out = {};
    for (var i = 0; i < LANGS.length; i++) out[LANGS[i]] = cleanText(o[LANGS[i]], MAX_TEXT);
    return out;
  }

  // Only the languages that have a sentence, for storing; null when none has.
  function packTexts(texts) {
    var out = {}, any = false;
    for (var i = 0; i < LANGS.length; i++) {
      var t = texts && texts[LANGS[i]];
      if (t) { out[LANGS[i]] = t; any = true; }
    }
    return any ? out : null;
  }

  function hasText(o) {
    for (var i = 0; i < LANGS.length; i++) if (o.texts[LANGS[i]]) return true;
    return false;
  }

  // A snippet's language as one of LANGS ('ES', 'es-ES'), or '' for any other.
  function langOf(lang) {
    var l = String(lang === null || lang === undefined ? '' : lang).slice(0, 2).toUpperCase();
    return LANGS.indexOf(l) === -1 ? '' : l;
  }

  /**
   * The whole calendar, ready occasions first, each one complete:
   * { id, ready, name, from, to, before, after, texts, on }.
   * `raw` is the stored list (see pack): anything damaged or unknown in it is
   * left out, so a surface can hand over whatever it read. `texts` holds a
   * sentence per language (LANGS), '' where the person wrote none; a ready
   * occasion prints its ready words there.
   */
  function list(raw) {
    var stored = Array.isArray(raw) ? raw : [];
    var out = [], own = [];
    var seen = {};
    for (var i = 0; i < stored.length; i++) {
      var item = stored[i];
      if (!item || typeof item !== 'object') continue;
      if (typeof item.id === 'string' && readyById(item.id)) {
        if (!seen[item.id]) seen[item.id] = item;
        continue;
      }
      var name = cleanText(item.name, MAX_NAME);
      if (!name || !dayOk(item.from) || !dayOk(item.to) || own.length >= MAX_OWN) continue;
      own.push({
        id: 'own-' + own.length, ready: false, name: name, from: item.from, to: item.to,
        before: 0, after: 0, texts: cleanTexts(item.texts), on: item.on !== false
      });
    }
    for (var r = 0; r < READY.length; r++) {
      var base = READY[r], over = seen[base.id] || {};
      var fixed = has(base, 'from');
      out.push({
        id: base.id, ready: true, name: base.name,
        from: fixed ? (dayOk(over.from) ? over.from : base.from) : '',
        to: fixed ? (dayOk(over.to) ? over.to : base.to) : '',
        before: fixed ? 0 : wholeNumber(over.before, base.before, EASTER_BEFORE_MAX),
        after: fixed ? 0 : wholeNumber(over.after, base.after, EASTER_AFTER_MAX),
        texts: cleanTexts(over.texts), on: over.on !== false
      });
    }
    return out.concat(own);
  }

  /**
   * A calendar as it is stored: a ready occasion only where it differs from
   * what it ships as, an own occasion in full. Small on purpose, because the
   * account's settings travel with every request.
   */
  function pack(items) {
    var full = list(unlist(items));
    var out = [];
    for (var i = 0; i < full.length; i++) {
      var o = full[i];
      var texts = packTexts(o.texts);
      if (!o.ready) {
        var own = { name: o.name, from: o.from, to: o.to };
        if (texts) own.texts = texts;
        if (!o.on) own.on = false;
        out.push(own);
        continue;
      }
      var base = readyById(o.id), diff = { id: o.id }, changed = false;
      if (!o.on) { diff.on = false; changed = true; }
      if (texts) { diff.texts = texts; changed = true; }
      if (has(base, 'from')) {
        if (o.from !== base.from) { diff.from = o.from; changed = true; }
        if (o.to !== base.to) { diff.to = o.to; changed = true; }
      } else {
        if (o.before !== base.before) { diff.before = o.before; changed = true; }
        if (o.after !== base.after) { diff.after = o.after; changed = true; }
      }
      if (changed) out.push(diff);
    }
    return out;
  }

  // A list() answer read back as stored items, so pack() cleans what a window
  // hands it with the same rules list() applies to what was stored.
  function unlist(items) {
    var arr = Array.isArray(items) ? items : [];
    return arr.map(function(o) {
      if (!o || typeof o !== 'object') return null;
      if (o.ready) return { id: o.id, on: o.on, texts: o.texts, from: o.from, to: o.to, before: o.before, after: o.after };
      return { name: o.name, from: o.from, to: o.to, texts: o.texts, on: o.on };
    });
  }

  /** Whether a stored calendar is small enough for the account to keep. */
  function fits(packed) {
    return JSON.stringify(packed || []).length <= MAX_PACKED;
  }

  // The calendar of the person using this page, as stored. Each surface sets
  // it once it has read the account's settings, and again when they change.
  var current = [];
  function set(raw) { current = Array.isArray(raw) ? raw : []; }
  function get() { return current; }

  // Easter Sunday of a year in the Gregorian calendar: { month (1-12), day }.
  function easterSunday(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    return { month: month, day: ((h + l - 7 * m + 114) % 31) + 1 };
  }

  // A calendar day as a count of days, compared in UTC so a clock change cannot
  // move it. 29 February reads as the 28th in a year that has none.
  function dayCount(year, month, day) {
    var leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return Math.round(Date.UTC(year, month - 1, (month === 2 && day === 29 && !leap) ? 28 : day) / DAY_MS);
  }

  function today(now) {
    // Read by its methods, not by `instanceof`: a date made on another page or
    // in a test's own context is still a date.
    var d = now && typeof now.getFullYear === 'function' ? now : new Date();
    return { year: d.getFullYear(), count: dayCount(d.getFullYear(), d.getMonth() + 1, d.getDate()) };
  }

  function monthDay(value) {
    return { month: Number(value.slice(0, 2)), day: Number(value.slice(3, 5)) };
  }

  // The occasion's period that starts in `year`: { start, end, day } as day
  // counts. A period written 27 December to 6 January ends the year after.
  function periodIn(o, year) {
    if (o.ready && !o.from) {
      var e = easterSunday(year), sunday = dayCount(year, e.month, e.day);
      return { start: sunday - o.before, end: sunday + o.after, day: sunday };
    }
    var from = monthDay(o.from), to = monthDay(o.to);
    var wraps = o.from > o.to;
    var start = dayCount(year, from.month, from.day);
    var end = dayCount(wraps ? year + 1 : year, to.month, to.day);
    var base = o.ready ? readyById(o.id) : null;
    var day = start;
    if (base && base.day) {
      // The day itself, in whichever year puts it inside the period, or
      // nearest to it when the person moved the period off the day.
      var d = monthDay(base.day), gap = Infinity;
      for (var y = year - 1; y <= year + 1; y++) {
        var c = dayCount(y, d.month, d.day);
        var off = c < start ? start - c : (c > end ? c - end : 0);
        if (off < gap) { gap = off; day = c; }
      }
    }
    return { start: start, end: end, day: day };
  }

  // The period of `o` that holds today, or null out of season.
  function periodNow(o, t) {
    for (var y = t.year - 1; y <= t.year; y++) {
      var p = periodIn(o, y);
      if (t.count >= p.start && t.count <= p.end) return p;
    }
    return null;
  }

  // Whether an occasion can print at all: switched on, and with a sentence.
  function prints(o) {
    return o.on && (o.ready || hasText(o));
  }

  // The year of a day count.
  function yearOfCount(count) {
    return new Date(count * DAY_MS).getUTCFullYear();
  }

  // The occasion in season on `now` and the period that holds today, or null.
  function activeNow(now, raw) {
    var items = list(raw === undefined ? current : raw);
    var t = today(now);
    var best = null, bestRank = null, bestP = null;
    for (var i = 0; i < items.length; i++) {
      var o = items[i];
      if (!prints(o)) continue;
      var p = periodNow(o, t);
      if (!p) continue;
      var rank = [o.ready ? 1 : 0, Math.abs(t.count - p.day), p.end - p.start, i];
      var better = !bestRank;
      for (var k = 0; !better && k < rank.length; k++) {
        if (rank[k] === bestRank[k]) continue;
        better = rank[k] < bestRank[k];
        break;
      }
      if (better) { best = o; bestRank = rank; bestP = p; }
    }
    return best ? { occasion: best, year: yearOfCount(bestP.day) } : null;
  }

  /**
   * The occasion in season on `now`, or null. `raw` is a stored calendar;
   * without one it is the calendar this page was given with set().
   */
  function active(now, raw) {
    var a = activeNow(now, raw);
    return a ? a.occasion : null;
  }

  /**
   * The year {year} prints for an occasion: the year of its own day in the
   * period that holds `now`, else in the next one to start.
   */
  function yearOf(o, now) {
    if (!o) return 0;
    var t = today(now);
    var p = periodNow(o, t);
    if (!p) {
      p = periodIn(o, t.year);
      if (p.start <= t.count) p = periodIn(o, t.year + 1);
    }
    return yearOfCount(p.day);
  }

  // The first occasion to start after `now`, with the day it starts on, or
  // null when none can print: { occasion, month (1-12), day }.
  function next(now, raw) {
    var items = list(raw === undefined ? current : raw);
    var t = today(now);
    var best = null;
    for (var i = 0; i < items.length; i++) {
      var o = items[i];
      if (!prints(o)) continue;
      for (var y = t.year; y <= t.year + 1; y++) {
        var p = periodIn(o, y);
        if (p.start <= t.count) continue;
        if (!best || p.start < best.start) best = { occasion: o, start: p.start };
        break;
      }
    }
    if (!best) return null;
    var d = new Date(best.start * DAY_MS);
    return { occasion: best.occasion, month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }

  // The ready sentence for an occasion in a snippet's language ('ES', 'es-ES',
  // '' for a Multi body). English for a language without one.
  function words(id, lang) {
    var base = readyById(id);
    if (!base) return '';
    var l = String(lang === null || lang === undefined ? '' : lang).slice(0, 2).toUpperCase();
    return has(base.words, l) ? base.words[l] : base.words.EN;
  }

  // The sentence the person wrote for a language, or '' when they wrote none.
  // An occasion of their own falls back to the first language they wrote in,
  // since it has no ready words to fall back to.
  function writtenFor(o, lang) {
    var l = langOf(lang);
    if (l && o.texts[l]) return o.texts[l];
    if (o.ready) return '';
    for (var i = 0; i < LANGS.length; i++) if (o.texts[LANGS[i]]) return o.texts[LANGS[i]];
    return '';
  }

  /**
   * What an occasion prints in a snippet of language `lang`: the person's own
   * sentence with its details and {year} filled in, else the ready words (a
   * ready occasion) or nothing (one of the person's own). `year` is what
   * {year} prints (yearOf); a sentence that uses {year} without it, or a
   * detail the account does not hold, is not printed half filled.
   */
  function textOf(o, lang, year) {
    if (!o) return '';
    var written = writtenFor(o, lang);
    if (written) {
      var D = root.SBMyDetails;
      var filled = D ? D.fill(written, { year: year }) : (/\{[^{}]*\}/.test(written) ? null : written);
      if (filled !== null) return filled;
    }
    return o.ready ? words(o.id, lang) : '';
  }

  /** What {seasonal} prints right now in a snippet of language `lang`. */
  function currentLine(lang, now) {
    var a = activeNow(now);
    return a ? textOf(a.occasion, lang, a.year) : '';
  }

  function hasLine(body) {
    return TOKEN_RE.test(String(body === null || body === undefined ? '' : body));
  }

  // "8 December", the way the notes below name a day.
  function dayLabel(month, day) {
    return day + ' ' + MONTHS[month - 1];
  }

  /** An occasion's period in words: "8 December to 26 December". */
  function periodLabel(o) {
    if (!o) return '';
    if (o.ready && !o.from) {
      var b = o.before, a = o.after;
      return (b === 1 ? '1 day' : b + ' days') + ' before Easter to ' + (a === 1 ? '1 day' : a + ' days') + ' after';
    }
    var from = monthDay(o.from), to = monthDay(o.to);
    return dayLabel(from.month, from.day) + ' to ' + dayLabel(to.month, to.day);
  }

  /**
   * The seasonal line of a text as a fill form shows it, or null for a text
   * without one. In season: the occasion, the sentence it prints in `lang`,
   * and the words of the row that lets a person leave it out this once (`off`
   * is that choice). Out of season `active` is false and `note` says when the
   * next one starts, which only the editor's preview shows. `raw` is a stored
   * calendar for a surface that holds one itself; without it the answer comes
   * from the calendar this page was given with set().
   */
  function describe(body, lang, now, off, raw) {
    if (!hasLine(body)) return null;
    var a = activeNow(now, raw);
    var o = a ? a.occasion : null;
    var text = a ? textOf(o, lang, a.year) : '';
    if (o && text) {
      var out = !!off;
      var label = o.ready
        ? o.name + (out ? ' wishes left out' : ' wishes included')
        : o.name + (out ? ': line left out' : ': line included');
      return { active: true, id: o.id, name: o.name, text: text, off: out,
        label: label, action: out ? 'Put back' : 'Leave out', note: '' };
    }
    var n = next(now, raw);
    return { active: false, id: '', name: '', text: '', off: false, label: '', action: '',
      note: 'The seasonal line prints nothing today. ' + (n
        ? n.occasion.name + ' starts on ' + dayLabel(n.month, n.day) + '.'
        : 'No occasion is switched on.') };
  }

  var API = {
    META_KEY: META_KEY,
    STORAGE_KEY: STORAGE_KEY,
    MAX_OWN: MAX_OWN,
    MAX_NAME: MAX_NAME,
    MAX_TEXT: MAX_TEXT,
    MAX_PACKED: MAX_PACKED,
    LANGS: LANGS,
    YEAR_TOKEN: YEAR_TOKEN,
    EASTER_BEFORE_MAX: EASTER_BEFORE_MAX,
    EASTER_AFTER_MAX: EASTER_AFTER_MAX,
    TOKEN: TOKEN,
    dayOk: dayOk,
    list: list,
    pack: pack,
    fits: fits,
    set: set,
    get: get,
    easterSunday: easterSunday,
    active: active,
    yearOf: yearOf,
    next: next,
    words: words,
    textOf: textOf,
    currentLine: currentLine,
    hasLine: hasLine,
    periodLabel: periodLabel,
    describe: describe
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBSeason = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
