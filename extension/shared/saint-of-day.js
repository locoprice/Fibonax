// saint-of-day.js: the two footer lines, decided once.
//
//   "Santo del Giorno · <name>"   the saint of the day, read from Vatican News
//                                 by the saint-of-the-day server function
//   "<N> days to Christmas"       plain date arithmetic, no network
//
// Both footers carry them, in the same order and with the same words:
//
//   extension/popup/popup.js         popup footer (this module)
//   app/src/lib/saintOfDay.ts        dashboard footer (TS copy)
//
// The saint is the only part that needs the network, so it is the only part
// with rules about being stale. A saint is fresh while it is under 24 hours old
// AND was read on today's date in Rome, where the Vatican keeps its calendar,
// so a saint is never shown the morning after it changed. Anything that cannot
// be read, offline or a page that changed shape, simply shows no saint; the
// countdown does not depend on it and is always shown.
//
// The saint has a switch in Settings (on by default, kept on the device). The
// countdown has no switch.
//
// The popup keeps both values in chrome.storage.local, like every other
// popup setting. scripts/check-saint-of-day.js runs this module and the
// dashboard copy over the same cases (scripts/saint-cases.json) and fails when
// they differ.
(function(root) {
  'use strict';

  var ENABLED_KEY = 'sb_saint_of_day_enabled';
  var CACHE_KEY = 'sb_saint_of_day_cache';
  var FUNCTION_NAME = 'saint-of-the-day';
  var LABEL = 'Santo del Giorno';
  var TTL_MS = 24 * 60 * 60 * 1000;
  var MAX_NAME = 80;
  var VATICAN_TIME_ZONE = 'Europe/Rome';
  var DAY_MS = 24 * 60 * 60 * 1000;

  // The switch is on until it is explicitly turned off. The extension stores a
  // boolean and localStorage stores a string, so both spellings of off count.
  function isOn(value) {
    return value !== false && value !== 'false';
  }

  // Today's date in Rome as YYYY-MM-DD.
  function romeDay(nowMs) {
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: VATICAN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(nowMs));
    var o = {};
    parts.forEach(function(p) { o[p.type] = p.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }

  // A name that is safe to put in the footer: plain text on one line, not empty,
  // not long, no markup. null for anything else.
  function cleanName(raw) {
    if (typeof raw !== 'string') return null;
    var s = raw.replace(/\s+/g, ' ').trim();
    if (!s || s.length > MAX_NAME || /[<>]/.test(s)) return null;
    return s;
  }

  function isDay(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  // What the server function answered, or null when it did not answer with a
  // usable saint.
  function readResponse(body) {
    if (!body || body.ok !== true) return null;
    var name = cleanName(body.name);
    if (name === null || !isDay(body.date)) return null;
    return { name: name, date: body.date };
  }

  function makeEntry(reading, nowMs) {
    return { name: reading.name, date: reading.date, fetchedAt: nowMs };
  }

  // A stored cache entry, or null when it is missing or damaged.
  function readEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = cleanName(raw.name);
    if (name === null || !isDay(raw.date)) return null;
    if (typeof raw.fetchedAt !== 'number' || !isFinite(raw.fetchedAt)) return null;
    return { name: name, date: raw.date, fetchedAt: raw.fetchedAt };
  }

  function isFresh(raw, nowMs) {
    var entry = readEntry(raw);
    if (!entry || typeof nowMs !== 'number' || !isFinite(nowMs)) return false;
    var age = nowMs - entry.fetchedAt;
    return age >= 0 && age < TTL_MS && entry.date === romeDay(nowMs);
  }

  function label(name) {
    return LABEL + ' · ' + name;
  }

  // Whole days from today to the next 25 December, by the calendar on this
  // device. 0 on Christmas Day itself; from 26 December it counts to next year.
  // Calendar days are compared in UTC so a clock change cannot move the count.
  function daysToChristmas(nowMs) {
    var now = new Date(nowMs);
    var year = now.getFullYear();
    var today = Date.UTC(year, now.getMonth(), now.getDate());
    var christmas = Date.UTC(year, 11, 25);
    if (today > christmas) christmas = Date.UTC(year + 1, 11, 25);
    return Math.round((christmas - today) / DAY_MS);
  }

  function christmasLabel(days) {
    if (typeof days !== 'number' || !isFinite(days) || days < 0) return '';
    if (days === 0) return 'Merry Christmas';
    return days === 1 ? '1 day to Christmas' : days + ' days to Christmas';
  }

  // The extension's own storage, or null outside the extension.
  function extensionStorage() {
    var c = root.chrome;
    if (!c || !c.storage || !c.storage.local || !c.runtime) return null;
    return c.storage.local;
  }

  // cb(value) once the stored value is known. A page left open across an
  // extension reload has lost its context; it keeps the fallback until it is
  // reloaded, like every other setting.
  function loadKey(key, fallback, cb) {
    var store = extensionStorage();
    if (!store) { cb(fallback); return; }
    try {
      store.get(key, function(d) {
        cb(root.chrome.runtime.lastError ? fallback : (d && d[key]));
      });
    } catch (e) {
      cb(fallback);
    }
  }

  function saveKey(key, value) {
    var store = extensionStorage();
    if (!store) return;
    var patch = {};
    patch[key] = value;
    store.set(patch, function() {
      if (root.chrome.runtime.lastError) {
        console.error('Santo del Giorno: could not save on this device:', root.chrome.runtime.lastError.message);
      }
    });
  }

  function loadEnabled(cb) {
    loadKey(ENABLED_KEY, true, function(v) { cb(isOn(v)); });
  }

  function saveEnabled(on) {
    saveKey(ENABLED_KEY, on !== false);
  }

  function loadCache(cb) {
    loadKey(CACHE_KEY, null, function(v) { cb(readEntry(v)); });
  }

  function saveCache(entry) {
    saveKey(CACHE_KEY, entry);
  }

  var API = {
    ENABLED_KEY: ENABLED_KEY,
    CACHE_KEY: CACHE_KEY,
    FUNCTION_NAME: FUNCTION_NAME,
    LABEL: LABEL,
    TTL_MS: TTL_MS,
    MAX_NAME: MAX_NAME,
    isOn: isOn,
    romeDay: romeDay,
    cleanName: cleanName,
    readResponse: readResponse,
    makeEntry: makeEntry,
    readEntry: readEntry,
    isFresh: isFresh,
    label: label,
    daysToChristmas: daysToChristmas,
    christmasLabel: christmasLabel,
    loadEnabled: loadEnabled,
    saveEnabled: saveEnabled,
    loadCache: loadCache,
    saveCache: saveCache
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBSaintOfDay = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
