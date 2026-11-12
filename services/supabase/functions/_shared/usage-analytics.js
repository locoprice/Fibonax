// GENERATED from extension/shared/usage-analytics.js by scripts/sync-usage-analytics.js. Do not edit: change the source and run the script.
// USAGE ANALYTICS — one reading of "how is my library being used".
//
// The dashboard's Analytics page and the phone's Analytics page used to count
// on their own. The phone counted only what the library holds (no use at all),
// and the dashboard printed a comparison it never computed ("+12% vs previous
// 7 days" was typed into the page). Here every figure both pages show is
// decided once, from the same inputs, so the two can never disagree:
//
//   events     the caller's own rows of public.snippet_events (one per real
//              insert, written by the extension and by the phone), at least
//              LOAD_DAYS back: { snippet_id, created_at, fields_filled }
//   snippets   the library the caller can read: { id, title, shortcut,
//              folder_id, lang, created_at }
//   folders    { id, name }
//   lastUsed   snippet_last_used(): { snippet_id: iso } over ALL time, across
//              the team for a shared snippet. It is what "never used" and "not
//              used for 90 days" read, because the event window is finite.
//   period     7, 30, 90 or 365 days, ending today
//   month      'YYYY-MM' instead of a period: that calendar month, compared
//              with the calendar month before it (the monthly recap email).
//              Pass a finished month: an unfinished one is cut at today.
//   now        a timestamp, passed in so the gate can pin the clock
//
// pareto() reads the same inputs, plus the prompt log (public.prompt_events)
// and the prompt library, for the 80/20 view: the few snippets and prompts
// that did most of the work, and how much of it happened on a phone.
//
// Rules that keep the numbers honest:
//   - Days are LOCAL calendar days, stepped with setDate, so a day across a
//     clock change is still one day. "Last 7 days" is today and the 6 before.
//   - The previous period is the same number of days immediately before, so
//     every change compares like with like. A change from 0 has no percentage;
//     it reads "New", never "+100%" or "Infinity".
//   - An insert of a snippet that no longer exists still counts in every
//     total, and is ranked as "Deleted snippet" rather than vanishing.
//   - Time saved is an estimate at SECONDS_PER_USE per insert, the figure the
//     dashboard has always used, and every surface says it is an estimate.
//   - A streak that reaches back to the start of the loaded window is reported
//     as "at least", not as an exact number.
(function (root) {
  'use strict';

  var PERIODS = [7, 30, 90, 365];
  var DEFAULT_PERIOD = 30;
  var SECONDS_PER_USE = 30;
  // Two years: the previous period of "Last 12 months" is the year before it.
  var LOAD_DAYS = 730;
  var DORMANT_DAYS = 90;
  var TOP_LIMIT = 10;
  var MOVER_LIMIT = 5;
  var LIST_LIMIT = 5;
  var DELETED_KEY = '__deleted__';
  var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var LANG_NAMES = { EN: 'English', IT: 'Italian', ES: 'Spanish', FR: 'French', DE: 'German', PT: 'Portuguese', MULTI: 'Several languages' };

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function startOfDay(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, n) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  function dayKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function normalizePeriod(p) {
    var n = Number(p);
    return PERIODS.indexOf(n) === -1 ? DEFAULT_PERIOD : n;
  }

  function periodLabel(p) {
    var n = normalizePeriod(p);
    return n === 365 ? 'Last 12 months' : 'Last ' + n + ' days';
  }

  /** 'YYYY-MM' as { year, month (1-12) }, or null for anything else. */
  function monthKey(value) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    if (!m) return null;
    var month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return { year: Number(m[1]), month: month };
  }

  /** Calendar days from one local midnight to another, whatever the clock change does in between. */
  function daysBetween(from, to) {
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }

  /**
   * The two windows compared, as Dates (start inclusive, end exclusive).
   * A period is the last N days ending today; a month is that calendar month
   * against the calendar month before it, which may be a different length
   * (`prevDays`). `today` is the last day inside the window.
   */
  function range(period, now, month) {
    var key = monthKey(month);
    var today = startOfDay(now);
    if (key) {
      var mStart = new Date(key.year, key.month - 1, 1);
      var mEnd = new Date(key.year, key.month, 1);
      var mPrev = new Date(key.year, key.month - 2, 1);
      var last = addDays(mEnd, -1);
      return {
        period: daysBetween(mStart, mEnd),
        prevDays: daysBetween(mPrev, mStart),
        start: mStart,
        end: mEnd,
        prevStart: mPrev,
        prevEnd: mStart,
        today: last < today ? last : today,
        month: key.year + '-' + pad(key.month)
      };
    }
    var p = normalizePeriod(period);
    var end = addDays(today, 1);
    var start = addDays(today, -(p - 1));
    var prevStart = addDays(start, -p);
    return { period: p, prevDays: p, start: start, end: end, prevStart: prevStart, prevEnd: start, today: today, month: null };
  }

  /** "Last 30 days" for a period, "October 2026" for a month. */
  function windowLabel(r) {
    return r.month ? MONTHS_LONG[r.start.getMonth()] + ' ' + r.start.getFullYear() : periodLabel(r.period);
  }

  /** Where the event read has to start for every figure to be complete. */
  function loadFrom(now) {
    return addDays(startOfDay(now), -(LOAD_DAYS - 1));
  }

  function shortDate(date) {
    return MONTHS_SHORT[date.getMonth()] + ' ' + date.getDate();
  }

  function rangeLabel(start, endExclusive) {
    var last = addDays(endExclusive, -1);
    var a = shortDate(start);
    var b = shortDate(last);
    if (start.getFullYear() !== last.getFullYear()) {
      a += ', ' + start.getFullYear();
    }
    return a + ' – ' + b + ', ' + last.getFullYear();
  }

  /**
   * How one figure moved against the previous period. `pct` is null when the
   * previous period had nothing, because no percentage of zero is honest.
   */
  function change(cur, prev) {
    var c = Number(cur) || 0;
    var p = Number(prev) || 0;
    var diff = c - p;
    var pct = p > 0 ? (diff / p) * 100 : null;
    var dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    var text;
    if (p === 0 && c === 0) text = 'No change';
    else if (p === 0) text = 'New';
    else if (diff === 0) text = 'No change';
    else {
      var abs = Math.abs(pct);
      var shown = abs < 10 ? Math.round(abs * 10) / 10 : Math.round(abs);
      text = (diff > 0 ? '+' : '−') + shown + '%';
    }
    return { cur: c, prev: p, diff: diff, pct: pct, dir: dir, text: text };
  }

  function percentOf(part, whole) {
    if (!whole) return 0;
    return Math.round((part / whole) * 1000) / 10;
  }

  /** Whole numbers with thousands separators, the way both pages print counts. */
  function formatCount(n) {
    var s = String(Math.round(Number(n) || 0));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(Number(seconds) || 0));
    if (s < 60) return s + ' sec';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return rest ? h + ' h ' + rest + ' min' : h + ' h';
  }

  function hourLabel(h) {
    return pad(h) + ':00–' + pad((h + 1) % 24) + ':00';
  }

  function eventTime(ev) {
    var t = new Date(ev && ev.created_at).getTime();
    return isNaN(t) ? null : t;
  }

  function langName(code) {
    var c = String(code || '').toUpperCase();
    if (!c) return 'Not set';
    return LANG_NAMES[c] || c;
  }

  function sum(arr) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += arr[i];
    return t;
  }

  // Totals for one window: the figures the summary row prints.
  // `known` says whether a snippet id is still in the library: a deleted one
  // counts as an insert but not as one of the "different snippets used", so that
  // figure and the library-health share always agree.
  function windowTotals(list, days, startDate, known) {
    var perDay = {};
    var snippetsUsed = {};
    var fields = 0;
    var withFields = 0;
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      var k = dayKey(new Date(ev.t));
      perDay[k] = (perDay[k] || 0) + 1;
      if (ev.snippet_id && known(ev.snippet_id)) snippetsUsed[ev.snippet_id] = true;
      var f = Math.max(0, Number(ev.fields_filled) || 0);
      fields += f;
      if (f > 0) withFields++;
    }
    var best = null;
    var activeDays = 0;
    for (var d = 0; d < days; d++) {
      var day = addDays(startDate, d);
      var key = dayKey(day);
      var n = perDay[key] || 0;
      if (n > 0) activeDays++;
      // Ties go to the most recent day: it is the one a person remembers.
      if (n > 0 && (!best || n >= best.count)) best = { date: key, label: shortDate(day), count: n };
    }
    var uses = list.length;
    return {
      uses: uses,
      activeDays: activeDays,
      avgPerDay: Math.round((uses / days) * 10) / 10,
      avgPerActiveDay: activeDays ? Math.round((uses / activeDays) * 10) / 10 : 0,
      bestDay: best,
      snippetsUsed: Object.keys(snippetsUsed).length,
      fieldsFilled: fields,
      usesWithFields: withFields,
      avgFieldsPerUse: uses ? Math.round((fields / uses) * 10) / 10 : 0,
      secondsSaved: uses * SECONDS_PER_USE,
      perDay: perDay
    };
  }

  function rank(map, total, prevMap, describe) {
    var keys = Object.keys(map);
    var rows = keys.map(function (k) {
      var d = describe(k);
      return {
        key: k,
        title: d.title,
        detail: d.detail || '',
        uses: map[k],
        share: percentOf(map[k], total),
        change: change(map[k], prevMap ? prevMap[k] || 0 : 0)
      };
    });
    rows.sort(function (a, b) {
      if (b.uses !== a.uses) return b.uses - a.uses;
      return a.title.localeCompare(b.title);
    });
    return rows;
  }

  function streaks(dayHasUse, today, windowStart, periodStart) {
    // A streak is alive while today or yesterday has a use: nobody loses a
    // streak at 9 in the morning for not having worked yet today.
    var cursor = dayHasUse[dayKey(today)] ? today : addDays(today, -1);
    var current = 0;
    var atLeast = false;
    while (dayHasUse[dayKey(cursor)]) {
      current++;
      if (dayKey(cursor) === dayKey(windowStart)) { atLeast = true; break; }
      cursor = addDays(cursor, -1);
    }
    var longest = 0;
    var run = 0;
    for (var d = new Date(periodStart.getTime()); d <= today; d = addDays(d, 1)) {
      if (dayHasUse[dayKey(d)]) { run++; if (run > longest) longest = run; } else run = 0;
    }
    return { current: current, currentAtLeast: atLeast, longestInPeriod: longest };
  }

  /**
   * Every figure for one period. Pure: the same input always gives the same
   * answer, and nothing here reads the clock or the network.
   */
  function compute(input) {
    var inp = input || {};
    var now = Number(inp.now) || Date.now();
    var r = range(inp.period, now, inp.month);
    var p = r.period;
    var snippets = Array.isArray(inp.snippets) ? inp.snippets : [];
    var folders = Array.isArray(inp.folders) ? inp.folders : [];
    var lastUsed = inp.lastUsed || {};
    var loadStart = inp.loadedFrom ? startOfDay(new Date(inp.loadedFrom).getTime()) : loadFrom(now);

    var snipById = {};
    for (var s = 0; s < snippets.length; s++) if (snippets[s] && snippets[s].id) snipById[snippets[s].id] = snippets[s];
    var folderName = {};
    for (var f = 0; f < folders.length; f++) if (folders[f] && folders[f].id) folderName[folders[f].id] = folders[f].name || 'Untitled folder';

    var startMs = r.start.getTime();
    var endMs = r.end.getTime();
    var prevMs = r.prevStart.getTime();

    var cur = [];
    var prev = [];
    var dayHasUse = {};
    var lastSeen = {};
    var events = Array.isArray(inp.events) ? inp.events : [];
    for (var i = 0; i < events.length; i++) {
      var t = eventTime(events[i]);
      // A row stamped after now (a device clock running fast) is not counted yet.
      if (t === null || t >= endMs || t > now) continue;
      var ev = { t: t, snippet_id: events[i].snippet_id || null, fields_filled: events[i].fields_filled, lang: events[i].lang || null };
      if (t >= loadStart.getTime()) dayHasUse[dayKey(new Date(t))] = true;
      if (ev.snippet_id && (!lastSeen[ev.snippet_id] || t > lastSeen[ev.snippet_id])) lastSeen[ev.snippet_id] = t;
      if (t >= startMs) cur.push(ev);
      else if (t >= prevMs) prev.push(ev);
    }

    function known(id) { return !!snipById[id]; }
    var totals = windowTotals(cur, p, r.start, known);
    var prevTotals = windowTotals(prev, r.prevDays, r.prevStart, known);

    // Daily series, with the previous period's same day beside it and a
    // trailing 7-day average once a period is long enough for one to mean
    // something.
    var series = [];
    var trail = [];
    for (var d = 0; d < p; d++) {
      var day = addDays(r.start, d);
      var key = dayKey(day);
      var pday = addDays(r.prevStart, d);
      var count = totals.perDay[key] || 0;
      trail.push(count);
      if (trail.length > 7) trail.shift();
      series.push({
        date: key,
        label: shortDate(day),
        weekday: WEEKDAYS_SHORT[(day.getDay() + 6) % 7],
        count: count,
        prev: prevTotals.perDay[dayKey(pday)] || 0,
        avg7: p >= 30 && d >= 6 ? Math.round((sum(trail) / 7) * 10) / 10 : null
      });
    }

    // Ranking and movers.
    function keyOf(ev) { return ev.snippet_id && snipById[ev.snippet_id] ? ev.snippet_id : DELETED_KEY; }
    var curBy = {};
    var prevBy = {};
    for (var c1 = 0; c1 < cur.length; c1++) { var k1 = keyOf(cur[c1]); curBy[k1] = (curBy[k1] || 0) + 1; }
    for (var c2 = 0; c2 < prev.length; c2++) { var k2 = keyOf(prev[c2]); prevBy[k2] = (prevBy[k2] || 0) + 1; }
    function describeSnippet(k) {
      if (k === DELETED_KEY) return { title: 'Deleted snippet', detail: 'No longer in the library' };
      var sn = snipById[k];
      var detail = [];
      if (sn.shortcut) detail.push(sn.shortcut);
      if (sn.folder_id && folderName[sn.folder_id]) detail.push(folderName[sn.folder_id]);
      return { title: sn.title || sn.shortcut || 'Untitled snippet', detail: detail.join(' · ') };
    }
    var top = rank(curBy, totals.uses, prevBy, describeSnippet).slice(0, TOP_LIMIT);

    // Each top snippet's inserts per day across the period: its trend line.
    var perSnippetDay = {};
    for (var c3 = 0; c3 < cur.length; c3++) {
      var k3 = keyOf(cur[c3]);
      var dk3 = dayKey(new Date(cur[c3].t));
      if (!perSnippetDay[k3]) perSnippetDay[k3] = {};
      perSnippetDay[k3][dk3] = (perSnippetDay[k3][dk3] || 0) + 1;
    }
    for (var t1 = 0; t1 < top.length; t1++) {
      var byDay = perSnippetDay[top[t1].key] || {};
      top[t1].trend = series.map(function (pt) { return byDay[pt.date] || 0; });
    }

    var moverKeys = {};
    Object.keys(curBy).concat(Object.keys(prevBy)).forEach(function (k) { if (k !== DELETED_KEY) moverKeys[k] = true; });
    var movers = Object.keys(moverKeys).map(function (k) {
      var d2 = describeSnippet(k);
      return { key: k, title: d2.title, detail: d2.detail, uses: curBy[k] || 0, change: change(curBy[k] || 0, prevBy[k] || 0) };
    });
    var rising = movers.filter(function (m) { return m.change.diff > 0; })
      .sort(function (a, b) { return b.change.diff - a.change.diff || b.uses - a.uses || a.title.localeCompare(b.title); })
      .slice(0, MOVER_LIMIT);
    var falling = movers.filter(function (m) { return m.change.diff < 0; })
      .sort(function (a, b) { return a.change.diff - b.change.diff || a.title.localeCompare(b.title); })
      .slice(0, MOVER_LIMIT);

    // When: weekday by hour, Monday first, local time.
    var grid = [];
    for (var w = 0; w < 7; w++) { grid.push([]); for (var h = 0; h < 24; h++) grid[w].push(0); }
    var weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
    var hourTotals = [];
    for (var h2 = 0; h2 < 24; h2++) hourTotals.push(0);
    var gridMax = 0;
    for (var g = 0; g < cur.length; g++) {
      var dt = new Date(cur[g].t);
      var wd = (dt.getDay() + 6) % 7;
      var hr = dt.getHours();
      grid[wd][hr]++;
      weekdayTotals[wd]++;
      hourTotals[hr]++;
      if (grid[wd][hr] > gridMax) gridMax = grid[wd][hr];
    }
    function peak(arr) {
      var best = -1, at = -1;
      for (var q = 0; q < arr.length; q++) if (arr[q] > best) { best = arr[q]; at = q; }
      return best > 0 ? at : -1;
    }
    var pw = peak(weekdayTotals);
    var ph = peak(hourTotals);
    var patterns = {
      grid: grid,
      max: gridMax,
      weekdays: WEEKDAYS_SHORT.map(function (name, idx) { return { name: name, uses: weekdayTotals[idx], share: percentOf(weekdayTotals[idx], totals.uses) }; }),
      peakWeekday: pw === -1 ? null : { name: WEEKDAYS[pw], uses: weekdayTotals[pw], share: percentOf(weekdayTotals[pw], totals.uses) },
      peakHour: ph === -1 ? null : { hour: ph, label: hourLabel(ph), uses: hourTotals[ph], share: percentOf(hourTotals[ph], totals.uses) },
      workdayShare: percentOf(sum(weekdayTotals.slice(0, 5)), totals.uses),
      streak: streaks(dayHasUse, r.today, loadStart, r.start)
    };

    // Where the use goes: folders and languages, current and previous.
    function shareBy(list, keyFn) {
      var m = {};
      for (var z = 0; z < list.length; z++) { var kk = keyFn(list[z]); m[kk] = (m[kk] || 0) + 1; }
      return m;
    }
    function folderKey(ev) {
      var sn = ev.snippet_id && snipById[ev.snippet_id];
      if (!sn) return DELETED_KEY;
      return sn.folder_id && folderName[sn.folder_id] ? sn.folder_id : '__none__';
    }
    function langKey(ev) {
      var sn = ev.snippet_id && snipById[ev.snippet_id];
      return String((ev.lang || (sn && sn.lang) || '')).toUpperCase() || '__none__';
    }
    var byFolder = rank(shareBy(cur, folderKey), totals.uses, shareBy(prev, folderKey), function (k) {
      if (k === DELETED_KEY) return { title: 'Deleted snippets' };
      if (k === '__none__') return { title: 'No folder' };
      return { title: folderName[k] };
    });
    var byLanguage = rank(shareBy(cur, langKey), totals.uses, shareBy(prev, langKey), function (k) {
      return { title: k === '__none__' ? 'Not set' : langName(k), detail: k === '__none__' ? '' : k };
    });

    // Library health, against the whole history (lastUsed) and not only the
    // loaded window, so "never used" means never.
    var nowDay = r.today.getTime();
    var dormantCut = addDays(r.today, -DORMANT_DAYS).getTime();
    var never = [];
    var dormant = [];
    var usedInPeriod = 0;
    for (var s2 = 0; s2 < snippets.length; s2++) {
      var sn2 = snippets[s2];
      if (!sn2 || !sn2.id) continue;
      var fromServer = lastUsed[sn2.id] ? new Date(lastUsed[sn2.id]).getTime() : NaN;
      var last = Math.max(isNaN(fromServer) ? 0 : fromServer, lastSeen[sn2.id] || 0);
      if (curBy[sn2.id]) usedInPeriod++;
      var created = new Date(sn2.created_at).getTime();
      var row = { key: sn2.id, title: sn2.title || sn2.shortcut || 'Untitled snippet', detail: sn2.shortcut || '' };
      if (!last) {
        row.since = isNaN(created) ? null : created;
        row.days = isNaN(created) ? null : Math.max(0, Math.round((nowDay - startOfDay(created).getTime()) / 86400000));
        never.push(row);
      } else if (last < dormantCut) {
        row.since = last;
        row.days = Math.max(0, Math.round((nowDay - startOfDay(last).getTime()) / 86400000));
        dormant.push(row);
      }
    }
    function oldestFirst(a, b) { return (b.days || 0) - (a.days || 0) || a.title.localeCompare(b.title); }
    never.sort(oldestFirst);
    dormant.sort(oldestFirst);
    var library = snippets.length;
    var health = {
      library: library,
      usedInPeriod: usedInPeriod,
      usedShare: percentOf(usedInPeriod, library),
      neverUsed: never.length,
      neverUsedList: never.slice(0, LIST_LIMIT),
      dormant: dormant.length,
      dormantDays: DORMANT_DAYS,
      dormantList: dormant.slice(0, LIST_LIMIT),
      withShortcut: snippets.filter(function (x) { return x && String(x.shortcut || '').trim(); }).length,
      inFolder: snippets.filter(function (x) { return x && x.folder_id; }).length
    };

    return {
      period: p,
      label: windowLabel(r),
      rangeLabel: rangeLabel(r.start, r.end),
      prevRangeLabel: rangeLabel(r.prevStart, r.prevEnd),
      start: dayKey(r.start),
      prevStart: dayKey(r.prevStart),
      empty: totals.uses === 0 && prevTotals.uses === 0,
      totals: {
        uses: change(totals.uses, prevTotals.uses),
        activeDays: change(totals.activeDays, prevTotals.activeDays),
        snippetsUsed: change(totals.snippetsUsed, prevTotals.snippetsUsed),
        avgPerDay: change(totals.avgPerDay, prevTotals.avgPerDay),
        avgPerActiveDay: totals.avgPerActiveDay,
        secondsSaved: change(totals.secondsSaved, prevTotals.secondsSaved),
        fieldsFilled: change(totals.fieldsFilled, prevTotals.fieldsFilled),
        avgFieldsPerUse: totals.avgFieldsPerUse,
        usesWithFieldsShare: percentOf(totals.usesWithFields, totals.uses),
        bestDay: totals.bestDay,
        days: p
      },
      series: series,
      top: top,
      rising: rising,
      falling: falling,
      byFolder: byFolder,
      byLanguage: byLanguage,
      patterns: patterns,
      health: health
    };
  }

  /**
   * The line under a snippet or prompt in a team folder, from
   * shared_snippet_last_use() / shared_prompt_last_use():
   * "Last used by Anna on 30/10/2026 at 14:05", or "Never used" when nobody on
   * the team has used it yet. Local time, day first, 24-hour clock.
   */
  function lastUseLine(lastUse) {
    var d = lastUse && lastUse.used_at ? new Date(lastUse.used_at) : null;
    if (!d || isNaN(d.getTime())) return 'Never used';
    var name = lastUse.used_by_name ? String(lastUse.used_by_name) : 'a team member';
    return 'Last used by ' + name + ' on ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' at ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /**
   * The team table, from two reads of team_usage_by_member(): the period and
   * the one before it. A member who used nothing this period but did before
   * stays in the table at 0, because a drop is part of the picture. Uses count
   * shared snippets and shared prompts together; the person with the most this
   * period is the most active, unless two share the top (then nobody is).
   */
  function team(current, previous, myId) {
    var curRows = Array.isArray(current) ? current : [];
    var prevRows = Array.isArray(previous) ? previous : [];
    var byId = {};
    function add(rows, field) {
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row || !row.user_id) continue;
        var m = byId[row.user_id] || (byId[row.user_id] = { id: row.user_id, name: '', uses: 0, prevUses: 0, snippets: 0, prompts: 0 });
        if (row.member_name && !m.name) m.name = String(row.member_name);
        if (field === 'cur') {
          m.uses += Number(row.uses) || 0;
          m.snippets += Number(row.snippets) || 0;
          m.prompts += Number(row.prompts) || 0;
        } else m.prevUses += Number(row.uses) || 0;
      }
    }
    add(curRows, 'cur');
    add(prevRows, 'prev');
    var list = Object.keys(byId).map(function (k) { return byId[k]; });
    var total = sum(list.map(function (m) { return m.uses; }));
    var prevTotal = sum(list.map(function (m) { return m.prevUses; }));
    list.sort(function (a, b) { return b.uses - a.uses || b.prevUses - a.prevUses || a.name.localeCompare(b.name); });
    var topId = list.length && list[0].uses > 0 && !(list[1] && list[1].uses === list[0].uses) ? list[0].id : null;
    return {
      total: change(total, prevTotal),
      members: list.map(function (m, idx) {
        return {
          id: m.id,
          rank: idx + 1,
          name: m.name || 'Team member',
          isMe: !!myId && m.id === myId,
          mostActive: m.id === topId,
          uses: m.uses,
          snippets: m.snippets,
          prompts: m.prompts,
          share: percentOf(m.uses, total),
          change: change(m.uses, m.prevUses)
        };
      })
    };
  }

  // ── 80/20 ──────────────────────────────────────────────────────────────
  // Which few snippets (and, apart, which few prompts) did most of the work
  // in the period. Items are ranked by uses; the key group is the shortest run
  // from the top whose uses reach PARETO_TARGET percent of all uses, so it is
  // never padded and never short. Only items still in the library are ranked:
  // a deleted one cannot be acted on. Each row also says where its uses
  // happened, phone or computer, from the device the event carries; a row
  // logged before devices were recorded reads "Before tracking".
  var PARETO_TARGET = 80;
  var DEVICE_LABELS = { computer: 'Computer', phone: 'Phone', unknown: 'Before tracking' };
  var PARETO_NOUNS = { snippet: ['snippet', 'snippets'], prompt: ['prompt', 'prompts'] };

  function deviceOf(raw) {
    var d = String(raw || '').toLowerCase();
    return d === 'computer' || d === 'phone' ? d : 'unknown';
  }

  function deviceSplit(counts) {
    var total = counts.computer + counts.phone + counts.unknown;
    return {
      computer: counts.computer,
      phone: counts.phone,
      unknown: counts.unknown,
      computerShare: percentOf(counts.computer, total),
      phoneShare: percentOf(counts.phone, total),
      unknownShare: percentOf(counts.unknown, total)
    };
  }

  function noun(kind, n) {
    var pair = PARETO_NOUNS[kind] || PARETO_NOUNS.snippet;
    return n === 1 ? pair[0] : pair[1];
  }

  // One kind's 80/20. `uses` are { id, t, device } already inside the period;
  // `items` the library, `describe` turns an id into { title, detail }.
  function paretoOf(kind, uses, items, describe) {
    var byId = {};
    for (var i = 0; i < uses.length; i++) {
      var u = uses[i];
      var row = byId[u.id] || (byId[u.id] = { computer: 0, phone: 0, unknown: 0, uses: 0 });
      row[deviceOf(u.device)]++;
      row.uses++;
    }
    var total = 0;
    var ids = Object.keys(byId);
    for (var j = 0; j < ids.length; j++) total += byId[ids[j]].uses;

    var rows = ids.map(function (id) {
      var d = describe(id);
      var c = byId[id];
      return { key: id, title: d.title, detail: d.detail || '', uses: c.uses, share: percentOf(c.uses, total), device: deviceSplit(c) };
    });
    rows.sort(function (a, b) { return b.uses - a.uses || a.title.localeCompare(b.title); });

    var running = 0;
    var keyCount = 0;
    for (var r = 0; r < rows.length; r++) {
      running += rows[r].uses;
      rows[r].rank = r + 1;
      rows[r].cumShare = percentOf(running, total);
      if (!keyCount && running * 100 >= total * PARETO_TARGET) keyCount = r + 1;
    }

    var key = rows.slice(0, keyCount);
    var rest = rows.slice(keyCount);
    function group(list) {
      var c = { computer: 0, phone: 0, unknown: 0 };
      var n = 0;
      for (var g = 0; g < list.length; g++) {
        n += list[g].uses;
        c.computer += list[g].device.computer;
        c.phone += list[g].device.phone;
        c.unknown += list[g].device.unknown;
      }
      return { count: list.length, uses: n, share: percentOf(n, total), device: deviceSplit(c) };
    }
    var keyGroup = group(key);
    var restGroup = group(rest);
    var all = group(rows);
    var library = items.length;
    // Floor, so the headline never claims more than the key group did.
    var keyPct = total ? Math.floor((keyGroup.uses / total) * 100) : 0;
    var headline = total
      ? keyCount + ' ' + noun(kind, keyCount) + ' did ' + (keyPct === 100 ? 'all' : keyPct + '%') + ' of your work'
      : 'No ' + noun(kind, 2) + ' used in this period';
    var summary = total
      ? (library
        ? 'That is ' + keyCount + ' of the ' + formatCount(library) + ' ' + noun(kind, library) + ' in your library (' + percentOf(keyCount, library) + '%).'
        : '')
      : 'Use a few and the ones that matter most will show up here.';

    return {
      kind: kind,
      target: PARETO_TARGET,
      empty: total === 0,
      headline: headline,
      summary: summary,
      uses: total,
      library: library,
      used: rows.length,
      unused: Math.max(0, library - rows.length),
      key: key,
      rest: rest,
      keyGroup: keyGroup,
      restGroup: restGroup,
      device: all.device
    };
  }

  /**
   * The 80/20 of one period, for snippets and for prompts. Pure, like compute():
   *   events / snippets / folders   as compute() takes them; events may carry
   *                                 `device`
   *   promptEvents  { prompt_id, created_at, device } (public.prompt_events)
   *   prompts       { id, name, shortcut }; leave both out and `prompts` is null
   */
  function pareto(input) {
    var inp = input || {};
    var now = Number(inp.now) || Date.now();
    var r = range(inp.period, now, inp.month);
    var startMs = r.start.getTime();
    var endMs = r.end.getTime();

    function within(list, idField, known) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var t = eventTime(list[i]);
        if (t === null || t < startMs || t >= endMs || t > now) continue;
        var id = list[i][idField];
        if (!id || !known[id]) continue;
        out.push({ id: id, t: t, device: list[i].device });
      }
      return out;
    }

    var snippets = Array.isArray(inp.snippets) ? inp.snippets : [];
    var folders = Array.isArray(inp.folders) ? inp.folders : [];
    var snipById = {};
    for (var s = 0; s < snippets.length; s++) if (snippets[s] && snippets[s].id) snipById[snippets[s].id] = snippets[s];
    var folderName = {};
    for (var f = 0; f < folders.length; f++) if (folders[f] && folders[f].id) folderName[folders[f].id] = folders[f].name || 'Untitled folder';
    var snippetReport = paretoOf('snippet', within(Array.isArray(inp.events) ? inp.events : [], 'snippet_id', snipById), snippets, function (id) {
      var sn = snipById[id];
      var detail = [];
      if (sn.shortcut) detail.push(sn.shortcut);
      if (sn.folder_id && folderName[sn.folder_id]) detail.push(folderName[sn.folder_id]);
      return { title: sn.title || sn.shortcut || 'Untitled snippet', detail: detail.join(' · ') };
    });

    var promptReport = null;
    if (Array.isArray(inp.prompts) && Array.isArray(inp.promptEvents)) {
      var promptById = {};
      for (var p = 0; p < inp.prompts.length; p++) if (inp.prompts[p] && inp.prompts[p].id) promptById[inp.prompts[p].id] = inp.prompts[p];
      promptReport = paretoOf('prompt', within(inp.promptEvents, 'prompt_id', promptById), inp.prompts, function (id) {
        var pr = promptById[id];
        return { title: pr.name || pr.shortcut || 'Untitled prompt', detail: pr.shortcut || '' };
      });
    }

    return {
      period: r.period,
      label: windowLabel(r),
      rangeLabel: rangeLabel(r.start, r.end),
      snippets: snippetReport,
      prompts: promptReport
    };
  }

  // ── Suggestions ────────────────────────────────────────────────────────
  // What Fibonax notices on its own, from what the person already has. Nothing
  // new is collected and nothing leaves the device: the inputs are the same use
  // logs and library the rest of this file reads.
  //
  //   together  snippets (and, apart, prompts) used one after the other, again
  //             and again: a run is uses at most TOGETHER_GAP_MIN minutes
  //             apart, and a sequence must appear in TOGETHER_MIN runs within
  //             the last SUGGEST_DAYS days. A sequence is counted once per run.
  //   missing   a piece the library lacks, read from the words of its own
  //             items (MISSING_RULES). Each one names a starter library item,
  //             which is what the dashboard offers to add.
  //
  // "Not now" is passed in as `dismissed` ({ key: iso }), so a suggestion stays
  // hidden for DISMISS_DAYS on every surface that reads this.
  var SUGGEST_DAYS = 90;
  var TOGETHER_GAP_MIN = 10;
  var TOGETHER_MIN = 3;
  var TOGETHER_LIMIT = 3;
  var MISSING_LIMIT = 3;
  var DISMISS_DAYS = 30;

  // Words in English, Italian and Spanish, written without accents. A trailing
  // * matches the start of a word ("payment*" finds "payments").
  var W = {
    price: ['price*', 'pricing', 'cost', 'costs', 'payment*', 'pay', 'paying', 'paid', 'invoice*', 'quote*', 'fee', 'fees', 'deposit*', 'refund*', 'total',
      'prezz*', 'pagament*', 'fattur*', 'preventiv*', 'costo', 'costi', 'tariff*', 'rimbors*', 'acconto',
      'precio*', 'pago', 'pagos', 'pagar', 'factura*', 'presupuesto*', 'reembolso*', 'senal', 'anticipo'],
    terms: ['terms', 'conditions', 't&c', 'policy', 'policies', 'termini', 'condizioni', 'informativa', 'terminos', 'condiciones', 'politica*'],
    quote: ['quote', 'quotes', 'quotation*', 'estimate*', 'proposal*', 'offer', 'offers', 'preventiv*', 'offerta', 'offerte', 'proposta', 'presupuesto*', 'oferta*', 'propuesta*'],
    followup: ['follow up', 'following up', 'followup', 'checking in', 'any news', 'had a chance', 'ti ricontatto', 'hai avuto modo', 'novita', 'seguimiento', 'has podido', 'alguna novedad'],
    invoice: ['invoice*', 'fattur*', 'factura*'],
    reminder: ['reminder*', 'overdue', 'outstanding', 'unpaid', 'past due', 'sollecit*', 'scadut*', 'promemoria', 'recordatorio*', 'vencid*', 'pendiente*'],
    away: ['out of office', 'away until', 'on holiday', 'on vacation', 'on leave', 'back on', 'fuori ufficio', 'assente', 'in ferie', 'fuera de la oficina', 'ausente', 'de vacaciones'],
    answer: ['thank you for your message', 'thanks for your message', 'thank you for contacting', 'thanks for reaching out', 'your request', 'your question',
      'grazie per il tuo messaggio', 'grazie per averci', 'la tua richiesta', 'gracias por tu mensaje', 'gracias por contactar', 'tu solicitud', 'tu consulta'],
    reply: ['reply', 'replies', 'respond*', 'response', 'answer*', 'rispond*', 'rispost*', 'respuesta*', 'contesta*'],
    translate: ['translat*', 'tradu*'],
    facts: ['price*', 'opening hours', 'hours', 'address', 'phone', 'payment*', 'policy', 'policies', 'cancel*', 'refund*',
      'prezz*', 'orari*', 'indirizzo', 'telefono', 'pagament*', 'precio*', 'horario*', 'direccion'],
    factsBrain: ['facts', 'company', 'about us', 'business', 'azienda', 'chi siamo', 'empresa', 'quienes somos'],
    write: ['write', 'rewrite', 'draft', 'email', 'reply', 'scrivi', 'riscrivi', 'escribe', 'redacta', 'reescribe'],
    tone: ['tone', 'voice', 'style', 'brand', 'tono', 'stile', 'voce', 'estilo']
  };

  // In priority order, kinds mixed so the first few are not all snippets.
  // `found` returns the number the sentence prints, or 0 when the rule does not
  // apply. Every `libraryId` is a starter library item of that kind with that
  // exact `title` (src/__tests__/suggestions.test.ts pins it).
  var MISSING_RULES = [
    {
      key: 'terms', kind: 'snippet', libraryId: 'terms', title: 'Terms and conditions link',
      found: function (L) { var n = L.count('snippets', W.price); return n >= 2 && !L.any('snippets', W.terms) ? n : 0; },
      text: function (n) { return n + ' of your snippets talk about prices or payments, but none links to your terms and conditions.'; }
    },
    {
      key: 'company', kind: 'brain', libraryId: 'company', title: 'Company facts',
      found: function (L) { var n = L.count('snippets', W.facts); return n >= 3 && !L.any('brains', W.factsBrain) ? n : 0; },
      text: function (n) { return n + ' of your snippets hold prices, hours or policies. A Brain of company facts lets an AI answer with them.'; }
    },
    {
      key: 'reply', kind: 'prompt', libraryId: 'reply', title: 'Reply to a customer',
      found: function (L) { var n = L.count('snippets', W.answer); return n >= 3 && !L.any('prompts', W.reply) ? n : 0; },
      text: function (n) { return n + ' of your snippets answer messages. A prompt can draft a reply when none of them fits.'; }
    },
    {
      key: 'followquote', kind: 'snippet', libraryId: 'followquote', title: 'Follow-up on a quote',
      found: function (L) { var n = L.count('snippets', W.quote); return n >= 1 && !L.any('snippets', W.followup) ? n : 0; },
      text: function (n) {
        return n === 1 ? 'You have a snippet for quotes, but none to follow up on one.'
          : n + ' of your snippets are about quotes, but none follows up on one.';
      }
    },
    {
      key: 'translate', kind: 'prompt', libraryId: 'translate', title: 'Translate, keep the tone',
      found: function (L) { var n = L.languages(); return n >= 2 && !L.any('prompts', W.translate) ? n : 0; },
      text: function (n) { return 'Your snippets are in ' + n + ' languages. A prompt can translate a message and keep its tone.'; }
    },
    {
      key: 'overdue', kind: 'snippet', libraryId: 'overdue', title: 'Payment reminder',
      found: function (L) { var n = L.count('snippets', W.invoice); return n >= 1 && !L.any('snippets', W.reminder) ? n : 0; },
      text: function () { return 'You send invoices, but have no snippet to remind someone who has not paid.'; }
    },
    {
      key: 'tone', kind: 'brain', libraryId: 'tone', title: 'Tone of voice',
      found: function (L) { var n = L.count('prompts', W.write); return n >= 2 && !L.any('brains', W.tone) ? n : 0; },
      text: function (n) { return n + ' of your prompts write for you. A Tone of voice Brain helps the AI sound like you.'; }
    },
    {
      key: 'away', kind: 'snippet', libraryId: 'away', title: 'Out of office',
      found: function (L) { var n = L.size('snippets'); return n >= 10 && !L.any('snippets', W.away) ? n : 0; },
      text: function (n) { return 'You have ' + n + ' snippets, but none for the days you are away.'; }
    }
  ];

  /**
   * An item's words, ready to search: fields and formulas, markup, accents and
   * punctuation removed, lower case, one space between words and one at each end.
   */
  function plainWords(text) {
    var s = String(text || '').replace(/<[^>]*>/g, ' ');
    // Innermost tokens first, so a formula holding a field goes too.
    for (var i = 0; i < 4 && /\{[^{}]*\}/.test(s); i++) s = s.replace(/\{[^{}]*\}/g, ' ');
    if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();
    return s ? ' ' + s + ' ' : ' ';
  }

  function hasAny(words, list) {
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.charAt(w.length - 1) === '*') {
        if (words.indexOf(' ' + w.slice(0, -1)) !== -1) return true;
      } else if (words.indexOf(' ' + w + ' ') !== -1) return true;
    }
    return false;
  }

  function isDismissed(dismissed, key, now) {
    var at = dismissed && dismissed[key] ? new Date(dismissed[key]).getTime() : NaN;
    return !isNaN(at) && now - at < DISMISS_DAYS * 86400000;
  }

  // Uses of one kind cut into runs: the ids used one after the other, at most
  // TOGETHER_GAP_MIN minutes apart, between startMs and now. The same item
  // twice in a row is one step. An item `known` does not hold (one no longer in
  // the library) still ends a run: it sat between. Only runs of two or more.
  function runsOf(events, idField, known, startMs, now) {
    var uses = [];
    for (var e = 0; e < events.length; e++) {
      var t = eventTime(events[e]);
      if (t === null || t < startMs || t > now) continue;
      var id = events[e][idField];
      uses.push({ id: id && known(id) ? id : null, t: t });
    }
    uses.sort(function (a, b) { return a.t - b.t; });
    var gap = TOGETHER_GAP_MIN * 60000;
    var runs = [];
    var run = [];
    function cut() { if (run.length > 1) runs.push(run); run = []; }
    var lastT = null;
    for (var u = 0; u < uses.length; u++) {
      var use = uses[u];
      if (lastT !== null && use.t - lastT > gap) cut();
      lastT = use.t;
      if (use.id === null) { cut(); continue; }
      if (run.length && run[run.length - 1] === use.id) continue;
      run.push(use.id);
    }
    cut();
    return runs;
  }

  // One kind's "used together": `items` are { id, title, words, body }, where
  // `body` is the text alone, without the title.
  function togetherOf(kind, events, idField, items, startMs, now) {
    var byId = {};
    for (var i = 0; i < items.length; i++) byId[items[i].id] = items[i];
    var counts = {};
    runsOf(events, idField, function (id) { return !!byId[id]; }, startMs, now).forEach(function (run) {
      var seen = {};
      for (var a = 0; a < run.length - 1; a++) {
        for (var len = 2; len <= 3 && a + len <= run.length; len++) {
          var ids = run.slice(a, a + len);
          if (len === 3 && ids[0] === ids[2]) continue;
          var k = ids.join('>');
          if (seen[k]) continue;
          seen[k] = true;
          counts[k] = (counts[k] || 0) + 1;
        }
      }
    });

    function setKey(ids) { return ids.slice().sort().join('|'); }
    var cands = Object.keys(counts)
      .filter(function (k) { return counts[k] >= TOGETHER_MIN; })
      .map(function (k) { return { ids: k.split('>'), count: counts[k] }; });
    function byStrength(a, b) {
      return b.count - a.count || b.ids.length - a.ids.length || a.ids.join('>').localeCompare(b.ids.join('>'));
    }
    cands.sort(byStrength);

    // Three in a row first, then pairs. A pair is folded into a chosen chain of
    // three that holds it when the three go together at least half as often as
    // the two do; otherwise the pair is the stronger habit and stays.
    var picked = [];
    var pickedSets = {};
    [3, 2].forEach(function (len) {
      for (var c = 0; c < cands.length; c++) {
        var cand = cands[c];
        if (cand.ids.length !== len) continue;
        var sk = setKey(cand.ids);
        if (pickedSets[sk]) continue;
        var folded = picked.some(function (p) {
          return p.ids.length === 3 && cand.ids.every(function (x) { return p.ids.indexOf(x) !== -1; }) && p.count * 2 >= cand.count;
        });
        if (folded) continue;
        picked.push(cand);
        pickedSets[sk] = true;
      }
    });

    // Already joined: another item's text holds the text of every one of them.
    function joined(ids) {
      var parts = ids.map(function (x) { return byId[x].body; });
      if (parts.some(function (w) { return w.trim() === ''; })) return false;
      return items.some(function (it) {
        if (ids.indexOf(it.id) !== -1) return false;
        return parts.every(function (w) { return it.body.indexOf(w.trim()) !== -1; });
      });
    }

    return picked.filter(function (p) { return !joined(p.ids); }).map(function (p) {
      return {
        key: kind + ':' + p.ids.join('>'),
        kind: kind,
        ids: p.ids,
        titles: p.ids.map(function (x) { return byId[x].title; }),
        count: p.count,
        text: 'You used these one after the other ' + p.count + ' times in the last ' + SUGGEST_DAYS + ' days.'
      };
    });
  }

  /**
   * What usually comes next after each snippet, for "Add Firma after it" in
   * the fill windows: the snippet used right after it in the most runs (the
   * same runs as "used together"), at least TOGETHER_MIN of them in the last
   * SUGGEST_DAYS days. A tie goes to the id that sorts first, so every surface
   * picks the same one. Pure:
   *   events   uses { snippet_id, created_at }
   *   ids      the snippets still in the library; leave out to take every id
   *   idField  'snippet_id' unless given
   *   now      a timestamp
   * Returns { fromId: { id: nextId, count } }.
   */
  function nextAfter(input) {
    var inp = input || {};
    var now = Number(inp.now) || Date.now();
    var startMs = addDays(startOfDay(now), -(SUGGEST_DAYS - 1)).getTime();
    var known = function () { return true; };
    if (Array.isArray(inp.ids)) {
      var set = {};
      inp.ids.forEach(function (id) { set[id] = true; });
      known = function (id) { return !!set[id]; };
    }
    var counts = {};
    runsOf(Array.isArray(inp.events) ? inp.events : [], inp.idField || 'snippet_id', known, startMs, now).forEach(function (run) {
      var seen = {};
      for (var i = 0; i < run.length - 1; i++) {
        var k = run[i] + '>' + run[i + 1];
        if (seen[k]) continue;
        seen[k] = true;
        counts[k] = (counts[k] || 0) + 1;
      }
    });
    var best = {};
    Object.keys(counts).sort().forEach(function (k) {
      var n = counts[k];
      if (n < TOGETHER_MIN) return;
      var pair = k.split('>');
      if (!best[pair[0]] || n > best[pair[0]].count) best[pair[0]] = { id: pair[1], count: n };
    });
    return best;
  }

  /**
   * Suggestions for one person. Pure, like compute():
   *   events        snippet uses { snippet_id, created_at }
   *   promptEvents  prompt uses { prompt_id, created_at }
   *   snippets      { id, title, text, lang }   text: the body, any form;
   *                 `langs` (a list) in place of `lang` for a snippet that
   *                 holds several languages
   *   prompts       { id, name, text }
   *   brains        { name, description }
   *   dismissed     { key: iso } from "Not now"
   *   now           a timestamp
   */
  function suggest(input) {
    var inp = input || {};
    var now = Number(inp.now) || Date.now();
    var startMs = addDays(startOfDay(now), -(SUGGEST_DAYS - 1)).getTime();
    var dismissed = inp.dismissed || {};

    function list(v) { return Array.isArray(v) ? v.filter(function (x) { return x && x.id; }) : []; }
    var snippets = list(inp.snippets).map(function (s) {
      return {
        id: s.id, title: s.title || s.shortcut || 'Untitled snippet', langs: Array.isArray(s.langs) ? s.langs : [s.lang],
        words: plainWords((s.title || '') + ' ' + (s.text || '')), body: plainWords(s.text)
      };
    });
    var prompts = list(inp.prompts).map(function (p) {
      return {
        id: p.id, title: p.name || p.shortcut || 'Untitled prompt',
        words: plainWords((p.name || '') + ' ' + (p.text || '')), body: plainWords(p.text)
      };
    });
    var brains = (Array.isArray(inp.brains) ? inp.brains : []).filter(Boolean).map(function (b) {
      return { title: b.name || '', words: plainWords((b.name || '') + ' ' + (b.description || '')) };
    });
    var lib = { snippets: snippets, prompts: prompts, brains: brains };

    var together = togetherOf('snippet', Array.isArray(inp.events) ? inp.events : [], 'snippet_id', snippets, startMs, now)
      .concat(togetherOf('prompt', Array.isArray(inp.promptEvents) ? inp.promptEvents : [], 'prompt_id', prompts, startMs, now))
      .filter(function (s) { return !isDismissed(dismissed, s.key, now); })
      .sort(function (a, b) { return b.count - a.count || b.ids.length - a.ids.length || a.key.localeCompare(b.key); })
      .slice(0, TOGETHER_LIMIT);

    var L = {
      count: function (kind, words) { return lib[kind].filter(function (x) { return hasAny(x.words, words); }).length; },
      any: function (kind, words) { return lib[kind].some(function (x) { return hasAny(x.words, words); }); },
      size: function (kind) { return lib[kind].length; },
      languages: function () {
        var seen = {};
        snippets.forEach(function (s) {
          s.langs.forEach(function (l) {
            var c = String(l || '').toUpperCase();
            if (c && c !== 'MULTI') seen[c] = true;
          });
        });
        return Object.keys(seen).length;
      }
    };
    var KIND_LIST = { snippet: 'snippets', prompt: 'prompts', brain: 'brains' };
    var missing = [];
    for (var m = 0; m < MISSING_RULES.length && missing.length < MISSING_LIMIT; m++) {
      var rule = MISSING_RULES[m];
      var key = 'missing:' + rule.key;
      if (isDismissed(dismissed, key, now)) continue;
      // Already there under the library's own name: added before, kept.
      var named = rule.title.toLowerCase();
      if (lib[KIND_LIST[rule.kind]].some(function (x) { return String(x.title).trim().toLowerCase() === named; })) continue;
      var n = rule.found(L);
      if (!n) continue;
      missing.push({ key: key, kind: rule.kind, libraryId: rule.libraryId, title: rule.title, text: rule.text(n) });
    }

    return {
      days: SUGGEST_DAYS,
      together: together,
      missing: missing,
      empty: together.length === 0 && missing.length === 0
    };
  }

  var API = {
    PERIODS: PERIODS,
    DEFAULT_PERIOD: DEFAULT_PERIOD,
    SECONDS_PER_USE: SECONDS_PER_USE,
    LOAD_DAYS: LOAD_DAYS,
    DORMANT_DAYS: DORMANT_DAYS,
    normalizePeriod: normalizePeriod,
    periodLabel: periodLabel,
    range: range,
    loadFrom: loadFrom,
    change: change,
    formatCount: formatCount,
    formatDuration: formatDuration,
    hourLabel: hourLabel,
    PARETO_TARGET: PARETO_TARGET,
    DEVICE_LABELS: DEVICE_LABELS,
    compute: compute,
    pareto: pareto,
    SUGGEST_DAYS: SUGGEST_DAYS,
    DISMISS_DAYS: DISMISS_DAYS,
    MISSING_RULES: MISSING_RULES.map(function (r) { return { key: r.key, kind: r.kind, libraryId: r.libraryId, title: r.title }; }),
    suggest: suggest,
    nextAfter: nextAfter,
    team: team,
    lastUseLine: lastUseLine
  };

  // UMD: browser globals, CommonJS (the node gate), AMD.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else if (typeof define === 'function' && define.amd) {
    define(function () { return API; });
  } else {
    root.SBUsageAnalytics = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
