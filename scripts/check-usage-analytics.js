#!/usr/bin/env node
// Usage analytics gate.
//
// extension/shared/usage-analytics.js decides every figure the dashboard's and
// the phone's Analytics pages print. The dashboard loads that file at runtime
// and the phone carries a generated copy (scripts/sync-usage-analytics.js), so
// this is the one place the arithmetic is pinned. The clock and the time zone
// are fixed so a day boundary, the clock change of 25 October 2026 in Madrid,
// and every comparison read the same on any machine.
process.env.TZ = 'Europe/Madrid';

const path = require('path');
const UA = require(path.join(__dirname, '..', 'extension', 'shared', 'usage-analytics.js'));

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error('X ' + name + '\n    expected ' + e + '\n    got      ' + a);
    failed++;
    return;
  }
  console.log('  ok  ' + name);
}

// Wednesday 28 October 2026, 12:00 in Madrid (CET, after the clock change).
const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
function at(y, m, d, h, min) { return new Date(y, m - 1, d, h, min || 0).toISOString(); }
function ev(id, iso, fields) { return { snippet_id: id, created_at: iso, fields_filled: fields || 0 }; }

const snippets = [
  { id: 'a', title: 'Welcome reply', shortcut: '::hi', folder_id: 'f1', lang: 'EN', created_at: at(2026, 1, 1, 9) },
  { id: 'b', title: 'Price estimate', shortcut: '::est', folder_id: 'f2', lang: 'IT', created_at: at(2026, 1, 1, 9) },
  { id: 'c', title: 'Follow-up', shortcut: '', folder_id: null, lang: 'ES', created_at: at(2026, 2, 1, 9) },
  { id: 'd', title: 'Never touched', shortcut: '::nt', folder_id: 'f1', lang: 'EN', created_at: at(2026, 3, 1, 9) },
  { id: 'e', title: 'Old one', shortcut: '::old', folder_id: 'f2', lang: 'EN', created_at: at(2025, 1, 1, 9) },
];
const folders = [{ id: 'f1', name: 'Sales' }, { id: 'f2', name: 'Support' }];

// Current 7-day window: 22 Oct .. 28 Oct. Previous: 15 Oct .. 21 Oct.
const events = [
  ev('a', at(2026, 10, 28, 10), 2),
  ev('a', at(2026, 10, 28, 11), 0),
  ev('a', at(2026, 10, 27, 9), 1),
  ev('b', at(2026, 10, 26, 0, 30)),      // Monday just after midnight
  ev('b', at(2026, 10, 25, 2, 30)),      // the clock-change night (repeated hour)
  ev('gone', at(2026, 10, 24, 18), 3),    // a snippet since deleted
  ev('c', at(2026, 10, 22, 0, 0)),       // first instant of the window
  ev('c', at(2026, 10, 21, 23, 59)),     // last minute of the previous window
  ev('b', at(2026, 10, 20, 14)),
  ev('b', at(2026, 10, 19, 14)),
  ev('a', at(2026, 10, 16, 8)),
  ev('a', at(2026, 10, 28, 13)),         // after "now": ignored
  { snippet_id: 'a', created_at: 'not a date' },
];
const lastUsed = { e: at(2026, 6, 1, 9) };

const r = UA.compute({ now: NOW, period: 7, events, snippets, folders, lastUsed });

check('period label', [r.period, r.label, r.rangeLabel, r.prevRangeLabel],
  [7, 'Last 7 days', 'Oct 22 – Oct 28, 2026', 'Oct 15 – Oct 21, 2026']);
check('uses vs previous', [r.totals.uses.cur, r.totals.uses.prev, r.totals.uses.text], [7, 4, '+75%']);
check('active days', [r.totals.activeDays.cur, r.totals.activeDays.prev], [6, 4]);
// The deleted snippet's insert counts in the totals, not among the snippets used.
check('snippets used', [r.totals.snippetsUsed.cur, r.totals.snippetsUsed.prev, r.health.usedInPeriod], [3, 3, 3]);
check('fields filled', [r.totals.fieldsFilled.cur, r.totals.avgFieldsPerUse, r.totals.usesWithFieldsShare], [6, 0.9, 42.9]);
check('time saved', [r.totals.secondsSaved.cur, UA.formatDuration(r.totals.secondsSaved.cur)], [210, '4 min']);
check('best day (ties go to the latest)', r.totals.bestDay, { date: '2026-10-28', label: 'Oct 28', count: 2 });
check('series is one point per day', [r.series.length, r.series[0].date, r.series[6].date, r.series[6].count, r.series[0].prev],
  [7, '2026-10-22', '2026-10-28', 2, 0]);
check('clock-change day counted once', r.series.filter((p) => p.date === '2026-10-25').map((p) => p.count), [1]);
check('no 7-day average on a 7-day period', r.series.every((p) => p.avg7 === null), true);
check('top ranking', r.top.map((t) => [t.title, t.uses, t.share, t.change.text]), [
  ['Welcome reply', 3, 42.9, '+200%'],
  ['Price estimate', 2, 28.6, 'No change'],
  ['Deleted snippet', 1, 14.3, 'New'],
  ['Follow-up', 1, 14.3, 'No change'],
]);
check('top trend is one count per day of the period', [r.top[0].trend, r.top[2].trend],
  [[0, 0, 0, 0, 0, 1, 2], [0, 0, 1, 0, 0, 0, 0]]);
check('rising', r.rising.map((m) => [m.title, m.change.diff]), [['Welcome reply', 2]]);
check('falling', r.falling.map((m) => [m.title, m.change.diff]), []);
check('by folder', r.byFolder.map((f) => [f.title, f.uses, f.share]), [
  ['Sales', 3, 42.9], ['Support', 2, 28.6], ['Deleted snippets', 1, 14.3], ['No folder', 1, 14.3],
]);
check('by language', r.byLanguage.map((f) => [f.title, f.uses]), [
  ['English', 3], ['Italian', 2], ['Not set', 1], ['Spanish', 1],
]);
check('peak weekday and hour', [r.patterns.peakWeekday.name, r.patterns.peakWeekday.uses, r.patterns.peakHour.label],
  ['Wednesday', 2, '00:00–01:00']);
check('weekday by hour grid', [r.patterns.grid[2][10], r.patterns.grid[0][0], r.patterns.grid[6][2], r.patterns.max], [1, 1, 1, 1]);
check('workday share', r.patterns.workdayShare, 71.4);
// 23 October has no use, so the run is 24..28 October.
check('streak', r.patterns.streak, { current: 5, currentAtLeast: false, longestInPeriod: 5 });
check('health', [r.health.library, r.health.usedInPeriod, r.health.neverUsed, r.health.dormant,
  r.health.neverUsedList.map((x) => x.title), r.health.dormantList.map((x) => [x.title, x.days])],
  [5, 3, 1, 1, ['Never touched'], [['Old one', 149]]]);

// Change wording.
check('change from nothing', UA.change(5, 0).text, 'New');
check('nothing to nothing', UA.change(0, 0).text, 'No change');
check('small drop keeps a decimal', UA.change(97, 100).text, '−3%');
check('drop', UA.change(1, 4).text, '−75%');
check('decimal under 10%', UA.change(105.5, 100).text, '+5.5%');
check('formatCount', UA.formatCount(1234567), '1,234,567');
check('formatDuration hours', UA.formatDuration(3 * 3600 + 30 * 60), '3 h 30 min');
check('unknown period falls back', UA.normalizePeriod(12), 30);

// A streak running back to the first loaded day is reported as "at least".
const allDays = [];
for (let d = 0; d < 40; d++) allDays.push(ev('a', new Date(2026, 9, 28 - d, 10).toISOString()));
const s = UA.compute({ now: NOW, period: 30, events: allDays, snippets, folders, loadedFrom: new Date(2026, 9, 1).toISOString() });
check('streak capped at the loaded window', [s.patterns.streak.current, s.patterns.streak.currentAtLeast], [28, true]);
check('30-day period draws a 7-day average', [s.series[5].avg7, s.series[6].avg7], [null, 1]);

// A streak survives a morning with no use yet.
const y = UA.compute({ now: NOW, period: 7, events: [ev('a', at(2026, 10, 27, 9)), ev('a', at(2026, 10, 26, 9))], snippets, folders });
check('streak alive through today', y.patterns.streak.current, 2);

// Empty account.
const e = UA.compute({ now: NOW, period: 90, events: [], snippets: [], folders: [] });
check('empty', [e.empty, e.totals.uses.text, e.top.length, e.patterns.peakHour, e.health.usedShare, e.series.length],
  [true, 'No change', 0, null, 0, 90]);

// 12 months compares with the year before.
const yr = UA.compute({ now: NOW, period: 365, events: [ev('a', at(2025, 10, 30, 9)), ev('a', at(2025, 10, 28, 9))], snippets, folders });
check('12 months', [yr.label, yr.totals.uses.cur, yr.totals.uses.prev, yr.series.length], ['Last 12 months', 1, 1, 365]);

// Team table.
const t = UA.team(
  [{ user_id: 'u1', member_name: 'Ana', uses: 10, snippets: 4 }, { user_id: 'u2', member_name: 'Ben', uses: 30, snippets: 6 }],
  [{ user_id: 'u1', member_name: 'Ana', uses: 20 }, { user_id: 'u3', member_name: 'Cy', uses: 5 }],
  'u1',
);
check('team ranking', t.members.map((m) => [m.rank, m.name, m.uses, m.share, m.change.text, m.isMe]), [
  [1, 'Ben', 30, 75, 'New', false],
  [2, 'Ana', 10, 25, '−50%', true],
  [3, 'Cy', 0, 0, '−100%', false],
]);
check('team total', [t.total.cur, t.total.prev, t.total.text], [40, 25, '+60%']);

if (failed) {
  console.error('\n' + failed + ' usage analytics check(s) failed');
  process.exit(1);
}
console.log('\nusage analytics: all checks passed');
