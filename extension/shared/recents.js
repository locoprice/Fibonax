// RECENTLY OPENED: what the search window lists before anything is typed.
//
// One helper for every surface that opens the window (the popup, the dashboard,
// the phone through an inlined copy, scripts/sync-command-palette.js). It keeps
// which item was opened and when, nothing else: no name, no text. The name is
// read from the library when the list is drawn, so an item that was renamed
// shows its new name and one that was deleted leaves the list by itself.
//
// The list stays on the device, per account, newest first, 50 at most. An item
// opened again moves to the top instead of appearing twice.
(function (root) {
  'use strict';

  var LIMIT = 50;
  var DAY = 24 * 60 * 60 * 1000;
  // The headings of the list, in the order they are drawn. An empty one is
  // left out.
  var GROUPS = ['Today', 'Yesterday', 'Past week', 'Past 30 days', 'Older'];

  /** A stored list as this file wants it: valid rows, newest first, each key once. */
  function clean(list) {
    var rows = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (row) {
      if (!row || typeof row.k !== 'string' || !row.k) return;
      var at = Number(row.t);
      if (!isFinite(at) || at <= 0) return;
      rows.push({ k: row.k, t: at });
    });
    rows.sort(function (a, b) { return b.t - a.t; });
    return rows.filter(function (row) {
      if (seen[row.k]) return false;
      seen[row.k] = true;
      return true;
    }).slice(0, LIMIT);
  }

  /** The list after `key` was opened at `now`. The list given is not changed. */
  function record(list, key, now) {
    if (typeof key !== 'string' || !key) return clean(list);
    var at = isFinite(Number(now)) ? Number(now) : Date.now();
    return clean([{ k: key, t: at }].concat(Array.isArray(list) ? list : []));
  }

  /** The list without `keys`, for items that no longer exist. */
  function forget(list, keys) {
    var gone = {};
    (Array.isArray(keys) ? keys : []).forEach(function (key) { gone[key] = true; });
    return clean(list).filter(function (row) { return !gone[row.k]; });
  }

  // Midnight of the day `ms` falls in, on this device's clock.
  function dayStart(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /**
   * The heading a moment sits under, counted in whole days on the calendar:
   * something opened at 23:50 is "Yesterday" ten minutes later.
   */
  function groupOf(at, now) {
    var today = dayStart(isFinite(Number(now)) ? Number(now) : Date.now());
    var day = dayStart(at);
    if (day >= today) return GROUPS[0];
    if (day >= today - DAY) return GROUPS[1];
    if (day >= today - 7 * DAY) return GROUPS[2];
    if (day >= today - 30 * DAY) return GROUPS[3];
    return GROUPS[4];
  }

  /**
   * `rows` under their headings, in order, empty headings left out:
   * [{ label, rows }]. `atOf` reads the moment of a row (its `t` by default).
   */
  function group(rows, now, atOf) {
    var read = typeof atOf === 'function' ? atOf : function (row) { return row.t; };
    var buckets = {};
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var label = groupOf(read(row), now);
      (buckets[label] = buckets[label] || []).push(row);
    });
    return GROUPS.filter(function (label) { return !!buckets[label]; }).map(function (label) {
      return { label: label, rows: buckets[label] };
    });
  }

  // Where a list is kept. Each one answers get(cb) with whatever is stored and
  // takes set(list). A device that refuses storage keeps the list for the
  // visit only: the window still works, it just forgets on reload.

  /** A page's own storage (the dashboard, the phone). */
  function localStore(name) {
    return {
      get: function (cb) {
        var stored = null;
        try { stored = JSON.parse(root.localStorage.getItem(name) || 'null'); } catch (e) { stored = null; }
        cb(stored);
      },
      set: function (list) {
        try { root.localStorage.setItem(name, JSON.stringify(list)); } catch (e) { /* kept for this visit only */ }
      }
    };
  }

  /** The extension's storage. */
  function chromeStore(name) {
    return {
      get: function (cb) {
        try {
          root.chrome.storage.local.get(name, function (data) { cb(data ? data[name] : null); });
        } catch (e) { cb(null); }
      },
      set: function (list) {
        var patch = {};
        patch[name] = list;
        try { root.chrome.storage.local.set(patch); } catch (e) { /* kept for this visit only */ }
      }
    };
  }

  /**
   * A list that is read once and then answers at once.
   *
   *   ready(cb)    calls back when the stored list has been read
   *   list()       the rows, newest first: [{ k, t }]
   *   record(key)  `key` was opened now
   *   forget(keys) these items no longer exist
   *   clear()      empty the list
   */
  function open(store) {
    var rows = [], loaded = false, waiting = [];
    store.get(function (stored) {
      // Anything opened while the stored list was still being read stays.
      rows = clean(rows.concat(Array.isArray(stored) ? stored : []));
      loaded = true;
      waiting.splice(0).forEach(function (cb) { cb(); });
    });
    function save() { store.set(rows); }
    return {
      ready: function (cb) { if (loaded) cb(); else waiting.push(cb); },
      list: function () { return rows.slice(); },
      record: function (key, now) { rows = record(rows, key, now); save(); },
      forget: function (keys) {
        var next = forget(rows, keys);
        if (next.length !== rows.length) { rows = next; save(); }
      },
      clear: function () { rows = []; save(); }
    };
  }

  var API = {
    LIMIT: LIMIT,
    GROUPS: GROUPS,
    clean: clean,
    record: record,
    forget: forget,
    groupOf: groupOf,
    group: group,
    localStore: localStore,
    chromeStore: chromeStore,
    open: open
  };

  // UMD: browser globals, CommonJS (the node gate and the dashboard's test).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBRecents = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
