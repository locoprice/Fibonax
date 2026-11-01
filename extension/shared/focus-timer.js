// focus-timer.js: the Pomodoro timer's rules, decided once.
//
// A Pomodoro timer in the extension: work sessions, a short break after each,
// and a long break after the last session of a block. Three places use it:
//
//   extension/background/background.js   the only writer: every change goes
//                                        through reduce(), the alarm sits on
//                                        the end of the current phase, and the
//                                        chime plays through offscreen/chime.html
//   extension/popup/popup.js             the Pomodoro timer pane and the header button
//   extension/content/focus-break.js     the break screen on every web page
//
// Everything here is pure: a state and a time go in, a state comes out. The
// state lives in chrome.storage.local under STORAGE_KEY, on this device only;
// nothing is sent anywhere. scripts/check-focus-timer.js runs these rules over
// the cases that matter: a whole block, an extra break, a skip, a pause, a
// computer that slept through a phase, the six-hour and detox day warnings.
(function(root) {
  'use strict';

  var STORAGE_KEY = 'sb_focus';
  var ALARM_NAME = 'sb_focus_alarm';

  var MIN_MS = 60000;
  var HOUR_MS = 3600000;

  // The choices the Pomodoro timer pane offers. A stored value outside them lands
  // on the default, so an old or hand-edited value can never make a zero-minute
  // break or a block of a thousand sessions.
  var OPTIONS = {
    workMin: [15, 20, 25, 30, 45, 50, 60],
    breakMin: [3, 5, 10, 15],
    sessions: [2, 3, 4, 5, 6, 8, 10],
    longMin: [10, 15, 20, 30],
    // The detox day: the person's day off from screens, as Date.getDay() counts
    // (0 is Sunday), listed from Monday. People keep different days off, so it
    // is theirs to pick; Sunday until they do.
    detoxDay: [1, 2, 3, 4, 5, 6, 0]
  };
  var DEFAULTS = { workMin: 25, breakMin: 5, sessions: 4, longMin: 15, detoxDay: 0, chime: true };
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // "I need a break now" offers these lengths, in minutes.
  var EXTRA_MIN = [1, 2, 5];

  var LONG_HOURS = 6;          // the "enjoy your life" warning, in hours of one streak
  var GAP_MS = 30 * MIN_MS;    // a stop or a pause longer than this ends the streak
  var STALE_MS = 30 * MIN_MS;  // a phase overdue by more than this: the person was away
  var KEEP_DAYS = 14;          // daily counts kept, for the "Last 7 days" row

  var KINDS = ['work', 'short', 'long', 'extra'];

  // One idea per break, in turn, so every open tab shows the same one.
  var SUGGESTIONS = [
    'Get some fresh air',
    'Do 20 push-ups',
    'Eat a snack, away from your desk',
    'Read a few pages of a book that has nothing to do with work',
    'Drink a glass of water',
    'Stretch your neck, back and shoulders'
  ];
  var BREAK_LEAD = 'Step away from the screen. One idea:';
  var PHONE_RULE = 'No social media and no phone. Calling your mum is allowed.';
  var DILUTION_NOTE = 'Extra and skipped breaks are cutting into many of your sessions. A shorter work time may suit you better.';

  // The detox day pictures: up to 5 pictures of what the person loves (their
  // family, a sunset, their dog), shown as a carousel when they try to work on
  // their detox day. Each is resized before it is saved, they stay on this
  // device, and they live under their own key, so the timer state that every
  // open tab reads on each change stays small. The limit was 8 at first; the
  // owners found that too many (2026-11-01). 5 is a Fibonacci number, and at
  // about 300 KB a picture it is well inside the extension's storage.
  var PHOTO_KEY = 'sb_focus_photos';
  var PHOTO_MAX = 5;
  var PHOTO_MAX_SIDE = 1280;
  var IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,/;

  // The call when someone starts the timer on their detox day anyway.
  var DETOX_LINE = 'Your time is precious. Spend it offline, with the people and things you love.';

  function plain(value) {
    return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  }

  function num(value) {
    var n = Number(value);
    return (value === null || value === undefined || value === '' || !isFinite(n)) ? null : n;
  }

  function count(value) {
    var n = Math.floor(Number(value));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function isBreak(kind) {
    return kind === 'short' || kind === 'long' || kind === 'extra';
  }

  // The local calendar date, YYYY-MM-DD: "today" is the person's today.
  function dayKey(nowMs) {
    var d = new Date(nowMs);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // The date keys of the last n days, today first. Steps the calendar, not a
  // fixed 24 hours, so a daylight saving change never skips or repeats a day.
  function lastDays(nowMs, n) {
    var d = new Date(nowMs);
    var keys = [];
    for (var i = 0; i < n; i++) {
      keys.push(dayKey(d.getTime()));
      d.setDate(d.getDate() - 1);
    }
    return keys;
  }

  function normalizeSettings(raw) {
    var s = plain(raw);
    var out = {};
    Object.keys(OPTIONS).forEach(function(k) {
      var n = num(s[k]);
      out[k] = OPTIONS[k].indexOf(n) >= 0 ? n : DEFAULTS[k];
    });
    out.chime = s.chime !== false;
    return out;
  }

  // A run that cannot be read is no run: the timer shows Start again rather
  // than counting down to a time that means nothing.
  function normalizeRun(raw) {
    var r = plain(raw);
    if (KINDS.indexOf(r.kind) < 0) return null;
    var session = count(r.session);
    var streakFrom = num(r.streakFrom);
    if (session < 1 || !(streakFrom > 0)) return null;
    var paused = r.paused === true && r.kind === 'work';
    var endsAt = num(r.endsAt);
    var leftMs = num(r.leftMs);
    if (paused ? !(leftMs >= 0) : !(endsAt > 0)) return null;
    return {
      kind: r.kind,
      session: session,
      paused: paused,
      endsAt: paused ? null : endsAt,
      leftMs: paused ? leftMs : null,
      pausedAt: paused ? (num(r.pausedAt) || null) : null,
      resumeMs: r.kind === 'extra' ? Math.max(0, num(r.resumeMs) || 0) : null,
      breaks: count(r.breaks),
      streakFrom: streakFrom
    };
  }

  function normalizeLast(raw) {
    var l = plain(raw);
    var stoppedAt = num(l.stoppedAt);
    if (!(stoppedAt > 0)) return null;
    return {
      stoppedAt: stoppedAt,
      streakFrom: num(l.streakFrom) || stoppedAt,
      reason: ['stop', 'block', 'away'].indexOf(l.reason) >= 0 ? l.reason : 'stop',
      sessions: count(l.sessions)
    };
  }

  function normalizeDays(raw) {
    var src = plain(raw);
    var out = {};
    Object.keys(src).forEach(function(k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      var d = plain(src[k]);
      out[k] = { done: count(d.done), extra: count(d.extra), skipped: count(d.skipped) };
    });
    return out;
  }

  function normalize(raw) {
    var s = plain(raw);
    return {
      settings: normalizeSettings(s.settings),
      run: normalizeRun(s.run),
      last: normalizeLast(s.last),
      days: normalizeDays(s.days)
    };
  }

  function copy(st, patch) {
    return {
      settings: 'settings' in patch ? patch.settings : st.settings,
      run: 'run' in patch ? patch.run : st.run,
      last: 'last' in patch ? patch.last : st.last,
      days: 'days' in patch ? patch.days : st.days
    };
  }

  // One more of `field` today; days older than KEEP_DAYS are dropped.
  function bump(days, nowMs, field) {
    var keep = lastDays(nowMs, KEEP_DAYS);
    var out = {};
    Object.keys(days).forEach(function(k) {
      if (keep.indexOf(k) >= 0) out[k] = days[k];
    });
    var today = dayKey(nowMs);
    var d = out[today] || { done: 0, extra: 0, skipped: 0 };
    var next = { done: d.done, extra: d.extra, skipped: d.skipped };
    next[field] += 1;
    out[today] = next;
    return out;
  }

  function newRun(prev, patch) {
    return {
      kind: patch.kind,
      session: 'session' in patch ? patch.session : prev.session,
      paused: false,
      endsAt: patch.endsAt,
      leftMs: null,
      pausedAt: null,
      resumeMs: patch.kind === 'extra' ? patch.resumeMs : null,
      breaks: 'breaks' in patch ? patch.breaks : prev.breaks,
      streakFrom: 'streakFrom' in patch ? patch.streakFrom : prev.streakFrom
    };
  }

  function stopped(st, run, atMs, reason) {
    return copy(st, {
      run: null,
      last: { stoppedAt: atMs, streakFrom: run.streakFrom, reason: reason, sessions: run.session }
    });
  }

  // A work session reached its end: it counts as done, and a break begins. The
  // last session of the block gets the long break.
  function workEnds(st, nowMs) {
    var run = st.run;
    var s = st.settings;
    var lastOne = run.session >= s.sessions;
    return copy(st, {
      days: bump(st.days, nowMs, 'done'),
      run: newRun(run, {
        kind: lastOne ? 'long' : 'short',
        endsAt: nowMs + (lastOne ? s.longMin : s.breakMin) * MIN_MS,
        breaks: run.breaks + 1
      })
    });
  }

  // A break is over, by time or by Skip. An extra break hands back the work
  // time that was left; a short break opens the next session; the long break
  // ends the block.
  function breakEnds(st, nowMs) {
    var run = st.run;
    if (run.kind === 'extra') {
      return copy(st, { run: newRun(run, { kind: 'work', endsAt: nowMs + run.resumeMs }) });
    }
    if (run.kind === 'short') {
      return copy(st, {
        run: newRun(run, { kind: 'work', session: run.session + 1, endsAt: nowMs + st.settings.workMin * MIN_MS })
      });
    }
    return stopped(st, run, nowMs, 'block');
  }

  function sameSettings(a, b) {
    return Object.keys(DEFAULTS).every(function(k) { return a[k] === b[k]; });
  }

  // The one way the timer changes. Returns the next state, whether to chime,
  // and whether anything changed at all (an action that does not apply, such
  // as Pause during a break, changes nothing).
  //
  //   {type:'start'} {type:'pause'} {type:'resume'} {type:'stop'}
  //   {type:'extra', minutes}   "I need a break now", during work only
  //   {type:'skip'}             ends the break now, counted
  //   {type:'tick'}             moves on when the current phase is over
  //   {type:'settings', settings}
  function reduce(raw, action, nowMs) {
    var st = normalize(raw);
    var a = plain(action);
    var run = st.run;
    var same = { state: st, chime: false, changed: false };
    function next(state, chime) { return { state: state, chime: !!chime, changed: true }; }

    switch (a.type) {
      case 'start': {
        if (run) return same;
        var l = st.last;
        var streakFrom = (l && nowMs - l.stoppedAt <= GAP_MS && l.streakFrom <= nowMs) ? l.streakFrom : nowMs;
        return next(copy(st, {
          last: null,
          run: {
            kind: 'work', session: 1, paused: false,
            endsAt: nowMs + st.settings.workMin * MIN_MS,
            leftMs: null, pausedAt: null, resumeMs: null,
            breaks: 0, streakFrom: streakFrom
          }
        }));
      }
      case 'pause': {
        if (!run || run.kind !== 'work' || run.paused) return same;
        return next(copy(st, {
          run: {
            kind: 'work', session: run.session, paused: true,
            endsAt: null, leftMs: Math.max(0, run.endsAt - nowMs), pausedAt: nowMs,
            resumeMs: null, breaks: run.breaks, streakFrom: run.streakFrom
          }
        }));
      }
      case 'resume': {
        if (!run || !run.paused) return same;
        var longPause = run.pausedAt !== null && nowMs - run.pausedAt > GAP_MS;
        return next(copy(st, {
          run: newRun(run, {
            kind: 'work',
            endsAt: nowMs + run.leftMs,
            streakFrom: longPause ? nowMs : run.streakFrom
          })
        }));
      }
      case 'stop': {
        if (!run) return same;
        // Paused, the person stopped working when they paused.
        return next(stopped(st, run, run.paused && run.pausedAt ? run.pausedAt : nowMs, 'stop'));
      }
      case 'extra': {
        var minutes = num(a.minutes);
        if (!run || run.kind !== 'work' || run.paused || EXTRA_MIN.indexOf(minutes) < 0) return same;
        return next(copy(st, {
          days: bump(st.days, nowMs, 'extra'),
          run: newRun(run, {
            kind: 'extra',
            endsAt: nowMs + minutes * MIN_MS,
            resumeMs: Math.max(0, run.endsAt - nowMs),
            breaks: run.breaks + 1
          })
        }));
      }
      case 'skip': {
        if (!run || !isBreak(run.kind)) return same;
        return next(breakEnds(copy(st, { days: bump(st.days, nowMs, 'skipped') }), nowMs));
      }
      case 'tick': {
        if (!run || run.paused || nowMs < run.endsAt) return same;
        // Overdue by more than half an hour: the computer slept or Chrome was
        // closed. Starting a break or a session now would greet someone who
        // just came back with the wrong screen, so the timer stops instead.
        if (nowMs - run.endsAt > STALE_MS) return next(stopped(st, run, run.endsAt, 'away'));
        return next(run.kind === 'work' ? workEnds(st, nowMs) : breakEnds(st, nowMs), true);
      }
      case 'settings': {
        var settings = normalizeSettings(Object.assign({}, st.settings, plain(a.settings)));
        if (sameSettings(settings, st.settings)) return same;
        return next(copy(st, { settings: settings }));
      }
      default:
        return same;
    }
  }

  // 25:00, 4:12, 1:05:00. Rounded up, so a fresh 25 minute session reads 25:00
  // and the clock reaches 0:00 exactly when the phase ends.
  function clock(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s);
  }

  function minutesLeft(ms) {
    var m = Math.ceil(ms / MIN_MS);
    if (ms < MIN_MS) return 'less than a minute left';
    return m + (m === 1 ? ' minute left' : ' minutes left');
  }

  // Six hours in one streak, or a timer running on the detox day. Both at once
  // make one sentence, so "enjoy your life" is said once.
  function warnings(st, nowMs) {
    if (!st.run) return [];
    // A pause does not add hours at the computer.
    var until = st.run.paused && st.run.pausedAt ? st.run.pausedAt : nowMs;
    var hours = Math.floor((until - st.run.streakFrom) / HOUR_MS);
    var long = hours >= LONG_HOURS;
    var detox = new Date(nowMs).getDay() === st.settings.detoxDay;
    if (!long && !detox) return [];
    var atComputer = 'at the computer for ' + hours + ' hours straight.';
    var today = "It's " + DAY_NAMES[st.settings.detoxDay] + ', your detox day';
    var opening = today + '.';
    if (long && detox) opening = today + ", and you've been " + atComputer;
    else if (long) opening = "You've been " + atComputer;
    return [opening + ' Your time is precious: enjoy your life.'];
  }

  function idleLine(s) {
    return s.workMin + ' minutes of work, then a ' + s.breakMin + ' minute break. After ' +
      s.sessions + ' sessions, a ' + s.longMin + ' minute long break.';
  }

  // What every surface shows, in words, from one state at one moment.
  function view(raw, nowMs) {
    var st = normalize(raw);
    var s = st.settings;
    var run = st.run;
    var base = {
      settings: s,
      session: run ? run.session : 0,
      sessions: s.sessions,
      warnings: warnings(st, nowMs),
      suggestion: null,
      note: null
    };

    if (!run) {
      var l = st.last;
      var note = null;
      if (l && dayKey(l.stoppedAt) === dayKey(nowMs)) {
        if (l.reason === 'block') note = 'Block done: ' + l.sessions + (l.sessions === 1 ? ' session' : ' sessions') + ". Start again when you're ready.";
        if (l.reason === 'away') note = 'The timer stopped while you were away.';
      }
      return Object.assign(base, {
        mode: 'idle', kind: null, title: 'Ready', onBreak: false,
        leftMs: s.workMin * MIN_MS, clock: clock(s.workMin * MIN_MS),
        next: idleLine(s), note: note
      });
    }

    var of = 'Session ' + run.session + ' of ' + s.sessions;

    if (run.paused) {
      return Object.assign(base, {
        mode: 'paused', kind: 'work', title: 'Paused', onBreak: false,
        leftMs: run.leftMs, clock: clock(run.leftMs),
        next: of + ' is paused.'
      });
    }

    var left = Math.max(0, run.endsAt - nowMs);

    if (run.kind === 'work') {
      var lastOne = run.session >= s.sessions;
      return Object.assign(base, {
        mode: 'work', kind: 'work', title: 'Working', onBreak: false,
        leftMs: left, clock: clock(left),
        next: of + '. ' + (lastOne
          ? 'A ' + s.longMin + ' minute long break comes next.'
          : 'A ' + s.breakMin + ' minute break comes next.')
      });
    }

    var titles = { short: 'Break', long: 'Long break', extra: 'Extra break' };
    var nexts = {
      short: 'Session ' + (run.session + 1) + ' of ' + s.sessions + ' starts after the break.',
      long: 'The block is done after this break.',
      extra: 'Session ' + run.session + ' goes on after the break, with ' + minutesLeft(run.resumeMs || 0) + '.'
    };
    return Object.assign(base, {
      mode: 'break', kind: run.kind, title: titles[run.kind], onBreak: true,
      leftMs: left, clock: clock(left), next: nexts[run.kind],
      suggestion: SUGGESTIONS[(Math.max(1, run.breaks) - 1) % SUGGESTIONS.length]
    });
  }

  function isDetoxDay(raw, nowMs) {
    return new Date(nowMs).getDay() === normalizeSettings(plain(raw).settings).detoxDay;
  }

  function detoxTitle(raw) {
    return "It's " + DAY_NAMES[normalizeSettings(plain(raw).settings).detoxDay] + ', your detox day.';
  }

  // The saved pictures, in the order they were added: [{id, dataUrl, savedAt}].
  // Anything that is not a saved image, or past the limit, is left out.
  function photoItems(stored) {
    var list = plain(stored).items;
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length && out.length < PHOTO_MAX; i++) {
      var it = plain(list[i]);
      if (typeof it.id !== 'string' || !it.id) continue;
      if (typeof it.dataUrl !== 'string' || !IMAGE_URL.test(it.dataUrl)) continue;
      out.push({ id: it.id, dataUrl: it.dataUrl, savedAt: num(it.savedAt) || 0 });
    }
    return out;
  }

  // Just the addresses an <img> can show, for the carousel.
  function photoUrls(stored) {
    return photoItems(stored).map(function(it) { return it.dataUrl; });
  }

  function newPhotoId(items, nowMs) {
    var base = 'p' + Math.floor(nowMs).toString(36);
    var id = base;
    var n = 0;
    while (items.some(function(it) { return it.id === id; })) { n++; id = base + '-' + n; }
    return id;
  }

  // Adds pictures to what is saved. A picture that is already there is skipped,
  // and what does not fit under the limit is counted, never half saved.
  function addPhotos(stored, urls, nowMs) {
    var items = photoItems(stored);
    var added = 0, duplicates = 0, full = 0;
    (Array.isArray(urls) ? urls : []).forEach(function(url) {
      if (typeof url !== 'string' || !IMAGE_URL.test(url)) return;
      if (items.some(function(it) { return it.dataUrl === url; })) { duplicates++; return; }
      if (items.length >= PHOTO_MAX) { full++; return; }
      items.push({ id: newPhotoId(items, nowMs), dataUrl: url, savedAt: nowMs });
      added++;
    });
    return { stored: { items: items }, added: added, duplicates: duplicates, full: full };
  }

  function removePhoto(stored, id) {
    return { items: photoItems(stored).filter(function(it) { return it.id !== id; }) };
  }

  // What the picture page says after pictures were chosen, in one place.
  function photoNote(r) {
    var parts = [];
    if (r.added) parts.push(r.added === 1 ? 'Picture added.' : r.added + ' pictures added.');
    if (r.duplicates) parts.push(r.duplicates === 1 ? 'One was already saved.' : r.duplicates + ' were already saved.');
    if (r.unreadable) {
      parts.push(r.unreadable === 1 ? "One file isn't a picture or can't be opened." : r.unreadable + " files aren't pictures or can't be opened.");
    }
    if (r.full) {
      parts.push('The limit is ' + PHOTO_MAX + ' pictures, so ' + (r.full === 1 ? 'one picture was' : r.full + ' pictures were') + ' left out.');
    }
    return parts.join(' ');
  }

  // The header button's label while the timer runs, empty while it does not.
  function pillText(v) {
    if (v.mode === 'work') return v.clock;
    if (v.mode === 'paused') return 'Paused';
    if (v.mode === 'break') return 'Break ' + v.clock;
    return '';
  }

  // Today and the last 7 days, and whether extra and skipped breaks are eating
  // into the sessions: at least 4 sessions in the week, and one cut for every
  // two sessions or more.
  function stats(raw, nowMs) {
    var st = normalize(raw);
    var keys = lastDays(nowMs, 7);
    var zero = { done: 0, extra: 0, skipped: 0 };
    var today = st.days[keys[0]] || zero;
    var week = { done: 0, extra: 0, skipped: 0 };
    keys.forEach(function(k) {
      var d = st.days[k];
      if (!d) return;
      week.done += d.done;
      week.extra += d.extra;
      week.skipped += d.skipped;
    });
    return {
      today: { done: today.done, extra: today.extra, skipped: today.skipped },
      week: week,
      diluted: week.done >= 4 && (week.extra + week.skipped) * 2 >= week.done
    };
  }

  var API = {
    STORAGE_KEY: STORAGE_KEY,
    ALARM_NAME: ALARM_NAME,
    OPTIONS: OPTIONS,
    DEFAULTS: DEFAULTS,
    EXTRA_MIN: EXTRA_MIN,
    LONG_HOURS: LONG_HOURS,
    GAP_MS: GAP_MS,
    STALE_MS: STALE_MS,
    KEEP_DAYS: KEEP_DAYS,
    SUGGESTIONS: SUGGESTIONS,
    BREAK_LEAD: BREAK_LEAD,
    PHONE_RULE: PHONE_RULE,
    DILUTION_NOTE: DILUTION_NOTE,
    DAY_NAMES: DAY_NAMES,
    PHOTO_KEY: PHOTO_KEY,
    PHOTO_MAX: PHOTO_MAX,
    PHOTO_MAX_SIDE: PHOTO_MAX_SIDE,
    DETOX_LINE: DETOX_LINE,
    isDetoxDay: isDetoxDay,
    detoxTitle: detoxTitle,
    photoItems: photoItems,
    photoUrls: photoUrls,
    addPhotos: addPhotos,
    removePhoto: removePhoto,
    photoNote: photoNote,
    dayKey: dayKey,
    normalize: normalize,
    normalizeSettings: normalizeSettings,
    reduce: reduce,
    view: view,
    pillText: pillText,
    stats: stats,
    clock: clock
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBFocus = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
