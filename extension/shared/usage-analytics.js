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

  /** The two windows a period compares, as Dates (start inclusive, end exclusive). */
  function range(period, now) {
    var p = normalizePeriod(period);
    var today = startOfDay(now);
    var end = addDays(today, 1);
    var start = addDays(today, -(p - 1));
    var prevStart = addDays(start, -p);
    return { period: p, start: start, end: end, prevStart: prevStart, prevEnd: start, today: today };
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
    var r = range(inp.period, now);
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
    var prevTotals = windowTotals(prev, p, r.prevStart, known);

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
      label: periodLabel(p),
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
   * The team table, from two reads of team_usage_by_member(): the period and
   * the one before it. A member who used nothing this period but did before
   * stays in the table at 0, because a drop is part of the picture.
   */
  function team(current, previous, myId) {
    var curRows = Array.isArray(current) ? current : [];
    var prevRows = Array.isArray(previous) ? previous : [];
    var byId = {};
    function add(rows, field) {
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row || !row.user_id) continue;
        var m = byId[row.user_id] || (byId[row.user_id] = { id: row.user_id, name: '', uses: 0, prevUses: 0, snippets: 0 });
        if (row.member_name && !m.name) m.name = String(row.member_name);
        if (field === 'cur') { m.uses += Number(row.uses) || 0; m.snippets += Number(row.snippets) || 0; }
        else m.prevUses += Number(row.uses) || 0;
      }
    }
    add(curRows, 'cur');
    add(prevRows, 'prev');
    var list = Object.keys(byId).map(function (k) { return byId[k]; });
    var total = sum(list.map(function (m) { return m.uses; }));
    var prevTotal = sum(list.map(function (m) { return m.prevUses; }));
    list.sort(function (a, b) { return b.uses - a.uses || b.prevUses - a.prevUses || a.name.localeCompare(b.name); });
    return {
      total: change(total, prevTotal),
      members: list.map(function (m, idx) {
        return {
          id: m.id,
          rank: idx + 1,
          name: m.name || 'Team member',
          isMe: !!myId && m.id === myId,
          uses: m.uses,
          snippets: m.snippets,
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
    var r = range(inp.period, now);
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
      label: periodLabel(r.period),
      rangeLabel: rangeLabel(r.start, r.end),
      snippets: snippetReport,
      prompts: promptReport
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
    team: team
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
