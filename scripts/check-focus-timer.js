#!/usr/bin/env node
// POMODORO TIMER gate.
//
// The Pomodoro timer's rules live once in extension/shared/focus-timer.js. This
// gate runs them over the cases that matter and pins how the extension uses
// them:
//
//   1. the rules: a whole block, an extra break, a skip, a pause, a computer
//      that slept through a phase, the streak, the warnings, the counts
//   2. the wiring: the background is the only writer and keeps the alarm, the
//      chime plays from an offscreen page, the break screen and the popup read
//      the module, and the manifest asks for no permission that shows a warning
//
// Run: node scripts/check-focus-timer.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const F = require(path.join(ROOT, 'extension', 'shared', 'focus-timer.js'));

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error('X ' + name + '\n    expected ' + e + '\n    got      ' + a); failed++; return; }
  console.log('  ok  ' + name);
}

// Windows checkouts can hold CRLF while every committed blob is LF.
function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

const MIN = 60000;
const HOUR = 3600000;
// Local times, so the checks hold in any time zone. 28 October 2026 is a Wednesday.
const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime();
const SUNDAY = new Date(2026, 10, 1, 10, 0, 0).getTime();
const FRIDAY = new Date(2026, 9, 30, 10, 0, 0).getTime();
const TODAY = F.dayKey(T0);

function act(state, action, at) { return F.reduce(state, action, at); }

// ── 1. reading a state ─────────────────────────────────────────────
const empty = F.normalize(undefined);
check('nothing stored reads as the defaults and no run', [empty.settings, empty.run, empty.last, empty.days],
  [{ workMin: 25, breakMin: 5, sessions: 4, longMin: 15, detoxDay: 0, chime: true }, null, null, {}]);
check('values outside the choices land on the defaults, chime off stays off',
  F.normalizeSettings({ workMin: 0, breakMin: '10', sessions: 1000, longMin: 'x', detoxDay: 7, chime: false }),
  { workMin: 25, breakMin: 10, sessions: 4, longMin: 15, detoxDay: 0, chime: false });
check('any day of the week can be the detox day, listed from Monday', [F.OPTIONS.detoxDay.map((d) => F.DAY_NAMES[d]), F.normalizeSettings({ detoxDay: '5' }).detoxDay],
  [['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], 5]);
check('a run that cannot be read is no run', F.normalize({ run: { kind: 'nap', session: 1, endsAt: T0, streakFrom: T0 } }).run, null);

// ── 2. a whole block: two sessions, short break, long break ────────
const two = { settings: { workMin: 25, breakMin: 5, sessions: 2, longMin: 15, chime: true } };
let r = act(two, { type: 'start' }, T0);
check('Start opens session 1 for the work length', [r.changed, r.state.run.kind, r.state.run.session, r.state.run.endsAt - T0],
  [true, 'work', 1, 25 * MIN]);
let s = r.state;
check('a tick before the end changes nothing', act(s, { type: 'tick' }, T0 + 10 * MIN).changed, false);
check('Start while running changes nothing', act(s, { type: 'start' }, T0 + MIN).changed, false);

r = act(s, { type: 'tick' }, T0 + 25 * MIN); s = r.state;
check('the session ends: a short break, a chime, one session done',
  [r.chime, s.run.kind, s.run.endsAt - (T0 + 25 * MIN), s.days[TODAY].done, s.run.breaks], [true, 'short', 5 * MIN, 1, 1]);
check('the break screen shows, with the first idea', [F.view(s, T0 + 26 * MIN).onBreak, F.view(s, T0 + 26 * MIN).suggestion],
  [true, F.SUGGESTIONS[0]]);

r = act(s, { type: 'tick' }, T0 + 30 * MIN); s = r.state;
check('the break ends: session 2, a chime', [r.chime, s.run.kind, s.run.session], [true, 'work', 2]);
check('the last session says the long break is next', F.view(s, T0 + 31 * MIN).next, 'Session 2 of 2. A 15 minute long break comes next.');

r = act(s, { type: 'tick' }, T0 + 55 * MIN); s = r.state;
check('the last session ends: the long break', [s.run.kind, s.run.endsAt - (T0 + 55 * MIN), s.days[TODAY].done], ['long', 15 * MIN, 2]);
check('the second break shows the second idea', F.view(s, T0 + 56 * MIN).suggestion, F.SUGGESTIONS[1]);

r = act(s, { type: 'tick' }, T0 + 70 * MIN); s = r.state;
check('the long break ends the block, with a chime', [r.chime, s.run, s.last.reason, s.last.sessions], [true, null, 'block', 2]);
check('the popup says the block is done', F.view(s, T0 + 71 * MIN).note, "Block done: 2 sessions. Start again when you're ready.");

// ── 3. "I need a break now" ─────────────────────────────────────────
s = act({}, { type: 'start' }, T0).state;
check('only 1, 2 or 5 minutes', act(s, { type: 'extra', minutes: 3 }, T0 + 10 * MIN).changed, false);
r = act(s, { type: 'extra', minutes: 2 }, T0 + 10 * MIN); s = r.state;
check('an extra break is counted and keeps the work time left, without a chime',
  [r.chime, s.run.kind, s.run.resumeMs, s.run.endsAt - (T0 + 10 * MIN), s.days[TODAY].extra], [false, 'extra', 15 * MIN, 2 * MIN, 1]);
check('the extra break says what comes back', F.view(s, T0 + 11 * MIN).next, 'Session 1 goes on after the break, with 15 minutes left.');
check('no extra break during a break', act(s, { type: 'extra', minutes: 1 }, T0 + 11 * MIN).changed, false);
check('no pause during a break', act(s, { type: 'pause' }, T0 + 11 * MIN).changed, false);
r = act(s, { type: 'tick' }, T0 + 12 * MIN); s = r.state;
check('after the extra break, the same session goes on with the time it had', [s.run.kind, s.run.session, s.run.endsAt - (T0 + 12 * MIN)],
  ['work', 1, 15 * MIN]);

// ── 4. Skip ─────────────────────────────────────────────────────────
s = act(act({}, { type: 'start' }, T0).state, { type: 'tick' }, T0 + 25 * MIN).state;
check('no skip during work', act(act({}, { type: 'start' }, T0).state, { type: 'skip' }, T0 + MIN).changed, false);
r = act(s, { type: 'skip' }, T0 + 26 * MIN);
check('Skip ends the break now, is counted, and does not chime',
  [r.chime, r.state.run.kind, r.state.run.session, r.state.days[TODAY].skipped, r.state.run.endsAt - (T0 + 26 * MIN)],
  [false, 'work', 2, 1, 25 * MIN]);
s = act(act({}, { type: 'start' }, T0).state, { type: 'extra', minutes: 5 }, T0 + 5 * MIN).state;
r = act(s, { type: 'skip' }, T0 + 6 * MIN);
check('skipping an extra break goes back to the same session', [r.state.run.kind, r.state.run.session, r.state.run.endsAt - (T0 + 6 * MIN)],
  ['work', 1, 20 * MIN]);

// ── 5. Pause and Resume ─────────────────────────────────────────────
s = act(act({}, { type: 'start' }, T0).state, { type: 'pause' }, T0 + 10 * MIN).state;
check('Pause keeps the time left', [s.run.paused, s.run.leftMs, s.run.endsAt], [true, 15 * MIN, null]);
check('a paused timer does not move on', act(s, { type: 'tick' }, T0 + 5 * HOUR).changed, false);
check('the header says Paused', F.pillText(F.view(s, T0 + 11 * MIN)), 'Paused');
r = act(s, { type: 'resume' }, T0 + 40 * MIN);
check('Resume gives back the time left, and a 30 minute pause keeps the streak',
  [r.state.run.paused, r.state.run.endsAt - (T0 + 40 * MIN), r.state.run.streakFrom], [false, 15 * MIN, T0]);
check('a pause longer than 30 minutes starts a new streak', act(s, { type: 'resume' }, T0 + 41 * MIN).state.run.streakFrom, T0 + 41 * MIN);
check('Stop while paused counts the stop from the pause', act(s, { type: 'stop' }, T0 + 2 * HOUR).state.last.stoppedAt, T0 + 10 * MIN);

// ── 6. away: a phase long overdue stops the timer ──────────────────
s = act({}, { type: 'start' }, T0).state;
r = act(s, { type: 'tick' }, T0 + 25 * MIN + 30 * MIN);
check('30 minutes late still moves on', [r.state.run.kind, r.chime], ['short', true]);
r = act(s, { type: 'tick' }, T0 + 25 * MIN + 31 * MIN);
check('more than 30 minutes late: stopped, no chime, no session counted',
  [r.state.run, r.state.last.reason, r.state.last.stoppedAt, r.chime, r.state.days[TODAY]], [null, 'away', T0 + 25 * MIN, false, undefined]);
check('the popup says so', F.view(r.state, T0 + 2 * HOUR).note, 'The timer stopped while you were away.');

// ── 7. the streak and the warnings ──────────────────────────────────
s = act(act({}, { type: 'start' }, T0).state, { type: 'stop' }, T0 + HOUR).state;
check('Start within 30 minutes of a stop keeps the streak', act(s, { type: 'start' }, T0 + HOUR + 20 * MIN).state.run.streakFrom, T0);
check('Start later begins a new one', act(s, { type: 'start' }, T0 + HOUR + 40 * MIN).state.run.streakFrom, T0 + HOUR + 40 * MIN);
const long = { run: { kind: 'work', session: 3, endsAt: T0 + 7 * HOUR, streakFrom: T0, breaks: 2 } };
check('under 6 hours, no warning', F.view(long, T0 + 6 * HOUR - MIN).warnings, []);
check('6 hours straight: the warning', F.view(long, T0 + 6 * HOUR + MIN).warnings,
  ["You've been at the computer for 6 hours straight. Your time is precious: enjoy your life."]);
check('working on the detox day, Sunday unless changed: the warning', F.view({ run: { kind: 'work', session: 1, endsAt: SUNDAY + HOUR, streakFrom: SUNDAY } }, SUNDAY).warnings,
  ["It's Sunday, your detox day. Your time is precious: enjoy your life."]);
check('no warning on the detox day without a running timer', F.view({}, SUNDAY).warnings, []);
check('both at once: one sentence, said once', F.view({ run: { kind: 'work', session: 5, endsAt: SUNDAY + HOUR, streakFrom: SUNDAY - 7 * HOUR } }, SUNDAY).warnings,
  ["It's Sunday, your detox day, and you've been at the computer for 7 hours straight. Your time is precious: enjoy your life."]);
const fridayOff = { settings: { detoxDay: 5 }, run: { kind: 'work', session: 1, endsAt: FRIDAY + HOUR, streakFrom: FRIDAY } };
check('a Friday detox day warns on Friday', F.view(fridayOff, FRIDAY).warnings, ["It's Friday, your detox day. Your time is precious: enjoy your life."]);
check('and Sunday is then an ordinary day', F.view(Object.assign({}, fridayOff, { run: { kind: 'work', session: 1, endsAt: SUNDAY + HOUR, streakFrom: SUNDAY } }), SUNDAY).warnings, []);
check('a new detox day is saved', act({}, { type: 'settings', settings: { detoxDay: 6 } }, T0).state.settings.detoxDay, 6);
check('the detox day is read from the settings', [F.isDetoxDay({}, SUNDAY), F.isDetoxDay({}, FRIDAY), F.isDetoxDay({ settings: { detoxDay: 5 } }, FRIDAY)], [true, false, true]);
check('the call names the day', [F.detoxTitle({}), F.detoxTitle({ settings: { detoxDay: 6 } })],
  ["It's Sunday, your detox day.", "It's Saturday, your detox day."]);
check('the pictures never ride in the timer state every tab reads',
  [F.PHOTO_KEY !== F.STORAGE_KEY, Object.keys(act({ photo: 'x', dataUrl: 'x', items: [] }, { type: 'start' }, T0).state).sort().join()], [true, 'days,last,run,settings']);

// ── 7b. the detox day pictures: up to 5, kept in order ──────────────
const IMG = (n) => 'data:image/jpeg;base64,AAAA' + n;
const saved = (n) => F.addPhotos(null, Array.from({ length: n }, (_, i) => IMG(i)), T0).stored;
check('only saved images count as pictures, and an item needs an id',
  F.photoUrls({ items: [{ id: 'a', dataUrl: IMG(1) }, { id: 'b', dataUrl: 'https://example.com/a.jpg' }, { id: 'c', dataUrl: 'data:text/html;base64,AAAA' }, { dataUrl: IMG(2) }, { id: 'd', dataUrl: IMG(3) }] }),
  [IMG(1), IMG(3)]);
check('nothing, or the wrong shape, is no pictures', [F.photoUrls(null), F.photoUrls({}), F.photoUrls({ items: 'x' }), F.photoUrls('x')], [[], [], [], []]);
let added = F.addPhotos(null, [IMG(1), IMG(2), IMG(3)], T0);
check('pictures are added in order, each with its own id',
  [added.added, added.duplicates, added.full, F.photoUrls(added.stored), new Set(F.photoItems(added.stored).map((p) => p.id)).size], [3, 0, 0, [IMG(1), IMG(2), IMG(3)], 3]);
check('a picture that is already saved is skipped, and counted', (() => { const r = F.addPhotos(added.stored, [IMG(2), IMG(4)], T0 + 1); return [r.added, r.duplicates, F.photoUrls(r.stored).length]; })(), [1, 1, 4]);
check('the limit is 5 (8 was too many), and what does not fit is counted, never half saved', (() => { const r = F.addPhotos(saved(3), [IMG(10), IMG(11), IMG(12), IMG(13)], T0); return [F.PHOTO_MAX, r.added, r.full, F.photoUrls(r.stored).length]; })(), [5, 2, 2, 5]);
check('a stored list longer than the limit reads as the first 5', F.photoUrls({ items: Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, dataUrl: IMG(i) })) }).length, 5);
check('anything that is not an image address is ignored when adding', (() => { const r = F.addPhotos(null, ['x', 5, null, 'https://a.b/c.jpg', IMG(1)], T0); return [r.added, r.full, r.duplicates]; })(), [1, 0, 0]);
check('a picture is removed by its id, the others keep their place', (() => {
  const s = saved(3); const mid = F.photoItems(s)[1].id;
  return [F.photoUrls(F.removePhoto(s, mid)), F.photoUrls(F.removePhoto(s, 'nope')).length, F.photoUrls(F.removePhoto(F.removePhoto(F.removePhoto(s, F.photoItems(s)[0].id), mid), F.photoItems(s)[2].id))];
})(), [[IMG(0), IMG(2)], 3, []]);
check('ids stay unique when pictures are added at the same moment', (() => { const s1 = F.addPhotos(null, [IMG(1)], T0).stored; const s2 = F.addPhotos(s1, [IMG(2)], T0).stored; return new Set(F.photoItems(s2).map((p) => p.id)).size; })(), 2);
check('the page says what happened in plain words', [
  F.photoNote({ added: 1, duplicates: 0, unreadable: 0, full: 0 }),
  F.photoNote({ added: 3, duplicates: 1, unreadable: 0, full: 0 }),
  F.photoNote({ added: 0, duplicates: 2, unreadable: 1, full: 0 }),
  F.photoNote({ added: 2, duplicates: 0, unreadable: 2, full: 1 })
], [
  'Picture added.',
  '3 pictures added. One was already saved.',
  "2 were already saved. One file isn't a picture or can't be opened.",
  "2 pictures added. 2 files aren't pictures or can't be opened. The limit is 5 pictures, so one picture was left out."
]);

// ── 7c. the carousel: the rules every surface shares ────────────────
const C = require(path.join(ROOT, 'extension', 'shared', 'focus-carousel.js'));
check('the carousel wraps round at both ends', [C.stepIndex(0, 3, -1), C.stepIndex(2, 3, 1), C.stepIndex(1, 3, 1), C.stepIndex(1, 3, -1)], [2, 0, 2, 0]);
check('a bad index counts as the first picture', [C.stepIndex(7, 3, 1), C.stepIndex(-1, 3, 1), C.stepIndex('x', 3, -1), C.stepIndex(0, 0, 1)], [1, 1, 2, 0]);
check('one picture stays where it is', [C.stepIndex(0, 1, 1), C.stepIndex(0, 1, -1)], [0, 0]);
check('each picture says where it is in the gallery', C.slideLabel(1, 5), 'Picture 2 of 5');
check('an empty gallery is no gallery', C.create([], {}), null);
check('the gallery moves on by itself every 7 seconds', C.AUTOPLAY_MS, 7000);
check('a pause adds no hours', F.view({ run: { kind: 'work', session: 3, paused: true, leftMs: MIN, pausedAt: T0 + 5 * HOUR, streakFrom: T0 } }, T0 + 9 * HOUR).warnings, []);

// ── 8. counts, the 7 day row and the dilution note ─────────────────
const days = {};
days[F.dayKey(T0)] = { done: 2, extra: 1, skipped: 0 };
days[F.dayKey(T0 - 3 * 24 * HOUR)] = { done: 2, extra: 0, skipped: 1 };
days[F.dayKey(T0 - 9 * 24 * HOUR)] = { done: 9, extra: 9, skipped: 9 };
let st = F.stats({ days: days }, T0);
check('today and the last 7 days, older days left out', [st.today, st.week], [{ done: 2, extra: 1, skipped: 0 }, { done: 4, extra: 1, skipped: 1 }]);
check('one cut for every two sessions: the dilution note', st.diluted, true);
days[F.dayKey(T0)] = { done: 2, extra: 0, skipped: 0 };
check('fewer cuts: no note', F.stats({ days: days }, T0).diluted, false);
const old = {};
old[F.dayKey(T0 - 20 * 24 * HOUR)] = { done: 1, extra: 0, skipped: 0 };
check('counts older than 14 days are dropped when a day is counted', Object.keys(act(act({ days: old }, { type: 'start' }, T0).state, { type: 'tick' }, T0 + 25 * MIN).state.days),
  [TODAY]);

// ── 9. settings and the clock ───────────────────────────────────────
s = act({}, { type: 'start' }, T0).state;
r = act(s, { type: 'settings', settings: { workMin: 45 } }, T0 + MIN);
check('a new work length is saved and leaves the running session alone', [r.changed, r.state.settings.workMin, r.state.run.endsAt], [true, 45, T0 + 25 * MIN]);
check('the same settings change nothing', act(r.state, { type: 'settings', settings: { workMin: 45 } }, T0 + MIN).changed, false);
check('an unknown action changes nothing', act(s, { type: 'nap' }, T0).changed, false);
check('the clock reads like a clock', [F.clock(25 * MIN), F.clock(1), F.clock(0), F.clock(HOUR), F.clock(4 * MIN + 12000)],
  ['25:00', '0:01', '0:00', '1:00:00', '4:12']);
check('the header shows the time in work and in a break', [F.pillText(F.view(s, T0 + MIN)), F.pillText(F.view(act(s, { type: 'tick' }, T0 + 25 * MIN).state, T0 + 26 * MIN))],
  ['24:00', 'Break 4:00']);
check('nothing in the header while the timer is off', F.pillText(F.view({}, T0)), '');

// ── 10. wording ─────────────────────────────────────────────────────
const MODULE = readText('extension/shared/focus-timer.js');
check('no brand names in the ideas', /nutella/i.test(MODULE), false);
check('the phone rule allows the call home', F.PHONE_RULE, 'No social media and no phone. Calling your mum is allowed.');
check('no long dashes in the module', /[–—]/.test(MODULE), false);

// ── 11. the wiring ──────────────────────────────────────────────────
const manifest = JSON.parse(readText('extension/manifest.json'));
const js = manifest.content_scripts[0].js;
check('the manifest asks for offscreen and for nothing that shows a warning',
  [manifest.permissions.indexOf('offscreen') !== -1, manifest.permissions.indexOf('notifications'), manifest.permissions.indexOf('tabs')], [true, -1, -1]);
check('pages load the module before the break screen',
  js.indexOf('shared/focus-timer.js') !== -1 && js.indexOf('shared/focus-timer.js') < js.indexOf('content/focus-break.js'), true);

const BG = readText('extension/background/background.js');
check('the background loads the module', BG.indexOf("importScripts('../shared/focus-timer.js');") !== -1, true);
check('the background answers the popup and the break screen', /msg\.type !== 'sb_focus'/.test(BG) && /SBFocus\.reduce\(/.test(BG), true);
check('the background keeps the alarm on the end of the phase', /chrome\.alarms\.create\(SBFocus\.ALARM_NAME, \{ when: /.test(BG), true);
check('the background moves the timer on when the alarm fires', /alarm\.name === SBFocus\.ALARM_NAME/.test(BG), true);
check('the background checks the timer when Chrome starts and after an update',
  (BG.match(/sbFocusApply\(\{ type: 'tick' \}\)/g) || []).length >= 3, true);
check('the chime plays from the offscreen page', /createDocument\(\{[\s\S]*?url: SB_CHIME_PAGE/.test(BG) && BG.indexOf("var SB_CHIME_PAGE = 'offscreen/chime.html';") !== -1, true);
check('the offscreen page loads its script', /<script src="chime\.js"><\/script>/.test(readText('extension/offscreen/chime.html')), true);

const BREAK = readText('extension/content/focus-break.js');
check('the break screen reads the timer through the module', /F\.view\(/.test(BREAK) && /F\.STORAGE_KEY/.test(BREAK), true);
check('the break screen is a modal dialog, so the page underneath takes nothing', /\.showModal\(\)/.test(BREAK), true);
check('Escape does not close the break screen, and a closed one reopens', /e\.key === 'Escape'\) e\.preventDefault\(\)/.test(BREAK) && /if \(!dialog\.open\) openModal\(\)/.test(BREAK), true);
check('the break screen words come from the module', /F\.BREAK_LEAD/.test(BREAK) && /F\.PHONE_RULE/.test(BREAK) && !/mum/.test(BREAK), true);
check('Skip goes through the background', /type: 'skip'/.test(BREAK), true);

const POPUP_HTML = readText('extension/popup/popup.html');
const POPUP_JS = readText('extension/popup/popup.js');
check('popup.html loads the module before popup.js',
  POPUP_HTML.indexOf('<script src="../shared/focus-timer.js"></script>') !== -1 &&
  POPUP_HTML.indexOf('<script src="../shared/focus-timer.js"></script>') < POPUP_HTML.indexOf('<script src="popup.js"></script>'), true);
check('the popup has the header button and the pane', POPUP_HTML.indexOf('id="bfocus"') !== -1 && POPUP_HTML.indexOf('id="pane-focus"') !== -1, true);
check('the popup sends every change to the background', /type: 'sb_focus'/.test(POPUP_JS) && !/chrome\.storage\.local\.set\(\{\s*sb_focus/.test(POPUP_JS), true);
check('the popup draws through the module', /SBFocus\.view\(/.test(POPUP_JS) && /SBFocus\.stats\(/.test(POPUP_JS), true);
check('Start on the detox day shows the call with the picture first',
  /act === 'start' && SBFocus\.isDetoxDay\(focusState, Date\.now\(\)\)\) \{\s*openDetoxCall\(\);\s*return;/.test(POPUP_JS) &&
  POPUP_HTML.indexOf('id="fo-call-off">Take the day off</button>') !== -1 && POPUP_HTML.indexOf('id="fo-call-go">Start anyway</button>') !== -1, true);
check('the popup opens the picture page in a tab, never a file picker of its own',
  /chrome\.runtime\.getURL\('focus\/photo\.html'\)/.test(POPUP_JS) && !/type="file"/.test(POPUP_HTML), true);
check('the break screen shows the pictures on the detox day only', /if \(F\.isDetoxDay\(current, Date\.now\(\)\)\) showPhotos\(\);/.test(BREAK), true);
const PHOTO_PAGE = readText('extension/focus/photo.html');
const PHOTO_JS = readText('extension/focus/photo.js');
const CAROUSEL = readText('extension/shared/focus-carousel.js');
check('the picture page takes several pictures, shrinks each, and saves under its own key on this device',
  /type="file"[^>]*\bmultiple\b/.test(PHOTO_PAGE) && /F\.addPhotos\(/.test(PHOTO_JS) && /F\.PHOTO_MAX_SIDE/.test(PHOTO_JS) && /toDataURL\('image\/jpeg'/.test(PHOTO_JS) &&
  /patch\[F\.PHOTO_KEY\] = next/.test(PHOTO_JS) && !/fetch\(|XMLHttpRequest|sendMessage/.test(PHOTO_JS) &&
  PHOTO_PAGE.indexOf('The pictures stay on this computer. Fibonax never uploads them.') !== -1, true);
check('the picture page opens one file at a time, so many large pictures cannot fill the memory', /files\.reduce\(function\(chain, file\)/.test(PHOTO_JS) && !/Promise\.all\(/.test(PHOTO_JS), true);
check('the picture page shows what is saved in the shared carousel, and removes the one on screen',
  /SBFocusCarousel\.create\(urls/.test(PHOTO_JS) && /gallery\.index\(\)/.test(PHOTO_JS) && /F\.removePhoto\(stored, target\.id\)/.test(PHOTO_JS), true);
check('the popup call, the break screen and the picture page all use the one carousel',
  /SBFocusCarousel\.create\(focusPhotos\)/.test(POPUP_JS) && /SBFocusCarousel\.create\(urls/.test(BREAK) && /SBFocusCarousel\.create\(urls/.test(PHOTO_JS), true);
check('no surface keeps a carousel of its own', [POPUP_JS, BREAK, PHOTO_JS].some((text) => /setInterval\([^)]*slide|sbc-slide/.test(text)), false);
check('the carousel module loads before every page that draws it',
  js.indexOf('shared/focus-carousel.js') !== -1 && js.indexOf('shared/focus-carousel.js') < js.indexOf('content/focus-break.js') &&
  POPUP_HTML.indexOf('<script src="../shared/focus-carousel.js"></script>') < POPUP_HTML.indexOf('<script src="popup.js"></script>') &&
  PHOTO_PAGE.indexOf('<script src="../shared/focus-carousel.js"></script>') < PHOTO_PAGE.indexOf('<script src="photo.js"></script>'), true);
check('the break screen hands Left and Right to the carousel, and stops it when the screen goes',
  /gallery && gallery\.handleKey\(e\)/.test(BREAK) && /gallery\.destroy\(\)/.test(BREAK), true);
check('the carousel draws only with the design tokens, in words a screen reader can use',
  !/#[0-9a-fA-F]{3,8}\b/.test(CAROUSEL) && !/rgba?\(/.test(CAROUSEL) && /aria-roledescription/.test(CAROUSEL) && /'Pause slideshow'/.test(CAROUSEL) &&
  /prefers-reduced-motion/.test(CAROUSEL) && !/[–—]/.test(CAROUSEL), true);
check('the settings carry the Detox day, its days named by the module',
  POPUP_HTML.indexOf('<label for="fo-detox">Detox day</label>') !== -1 && /data-key="detoxDay"/.test(POPUP_HTML) && /SBFocus\.DAY_NAMES\[n\]/.test(POPUP_JS), true);

// ── 12. the name and the credit ─────────────────────────────────────
// The owners' naming (2026-11-01): people read "Pomodoro timer", after the
// technique Francesco Cirillo created; "focus" stays the name inside the code.
const PAGE = readText('user-docs/pomodoro-timer.mdx');
check('the pane and the header button say Pomodoro timer',
  POPUP_HTML.indexOf('<span class="set-title">Pomodoro timer</span>') !== -1 && POPUP_HTML.indexOf('title="Pomodoro timer" aria-label="Pomodoro timer"') !== -1, true);
check('the line under the title says where the technique comes from',
  POPUP_HTML.indexOf('<span class="fo-sub">The Italian way to boost productivity</span>') > POPUP_HTML.indexOf('<span class="set-title">Pomodoro timer</span>'), true);
check('the footer of the pane credits Francesco Cirillo, with the trademark',
  POPUP_HTML.indexOf('The Pomodoro® Technique was created by Francesco Cirillo in the 1980s. Pomodoro® is a registered trademark.') !== -1, true);
check('the manual page is named the same and carries the credit',
  /^title: "Pomodoro timer"/m.test(PAGE) && PAGE.indexOf('Francesco Cirillo') !== -1 && PAGE.indexOf('Pomodoro® is a registered trademark') !== -1, true);
check('nothing a person reads still says Focus timer',
  [POPUP_HTML, POPUP_JS, PAGE, readText('user-docs/install-extension.mdx'), readText('app/public/landing/legal/privacy-policy.html')]
    .some((text) => /focus timer/i.test(text)), false);

if (failed) {
  console.error('\n' + failed + ' Pomodoro timer check(s) failed');
  process.exit(1);
}
console.log('\nPomodoro timer checks passed');
