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
  [{ user_id: 'u1', member_name: 'Ana', uses: 10, snippets: 4, prompts: 1 }, { user_id: 'u2', member_name: 'Ben', uses: 30, snippets: 6 }],
  [{ user_id: 'u1', member_name: 'Ana', uses: 20 }, { user_id: 'u3', member_name: 'Cy', uses: 5 }],
  'u1',
);
check('team ranking', t.members.map((m) => [m.rank, m.name, m.uses, m.snippets, m.prompts, m.share, m.change.text, m.isMe, m.mostActive]), [
  [1, 'Ben', 30, 6, 0, 75, 'New', false, true],
  [2, 'Ana', 10, 4, 1, 25, '−50%', true, false],
  [3, 'Cy', 0, 0, 0, 0, '−100%', false, false],
]);
check('team total', [t.total.cur, t.total.prev, t.total.text], [40, 25, '+60%']);
check('a tie at the top has no most active',
  UA.team([{ user_id: 'u1', member_name: 'Ana', uses: 5 }, { user_id: 'u2', member_name: 'Ben', uses: 5 }], [], null).members.map((m) => m.mostActive),
  [false, false]);
check('nobody is most active with no use',
  UA.team([], [{ user_id: 'u1', member_name: 'Ana', uses: 5 }], null).members.map((m) => m.mostActive), [false]);

// The line under a team snippet or prompt.
check('last use line', UA.lastUseLine({ used_at: at(2026, 10, 25, 2, 30), used_by_name: 'Ana' }), 'Last used by Ana on 25/10/2026 at 02:30');
check('last use line without a name', UA.lastUseLine({ used_at: at(2026, 1, 5, 9, 7) }), 'Last used by a team member on 05/01/2026 at 09:07');
check('never used', [UA.lastUseLine(null), UA.lastUseLine({ used_at: 'not a date', used_by_name: 'Ana' })], ['Never used', 'Never used']);

// 80/20. Ten uses in the 7-day window: a×6 (2 phone, 3 computer, 1 untagged),
// b×2, c×1, plus a deleted snippet and one before the window, neither ranked.
const pev = (id, iso, device) => ({ snippet_id: id, created_at: iso, fields_filled: 0, device });
const pe = UA.pareto({
  now: NOW,
  period: 7,
  snippets,
  folders,
  events: [
    pev('a', at(2026, 10, 28, 9), 'phone'), pev('a', at(2026, 10, 27, 9), 'phone'),
    pev('a', at(2026, 10, 26, 9), 'computer'), pev('a', at(2026, 10, 25, 9), 'computer'),
    pev('a', at(2026, 10, 24, 9), 'computer'), pev('a', at(2026, 10, 23, 9)),
    pev('b', at(2026, 10, 23, 10), 'computer'), pev('b', at(2026, 10, 22, 10), 'tablet'),
    pev('c', at(2026, 10, 22, 11), 'phone'),
    pev('gone', at(2026, 10, 24, 18), 'phone'),
    pev('a', at(2026, 10, 21, 9), 'phone'),
  ],
  prompts: [{ id: 'p1', name: 'Summary', shortcut: 'sum' }, { id: 'p2', name: '', shortcut: 'tidy' }],
  promptEvents: [
    { prompt_id: 'p2', created_at: at(2026, 10, 28, 8), device: 'phone' },
    { prompt_id: 'gone', created_at: at(2026, 10, 28, 8), device: 'phone' },
  ],
});
const ps = pe.snippets;
check('pareto ranks only the library, in the period', [ps.uses, ps.used, ps.library, ps.unused], [9, 3, 5, 2]);
check('pareto key group is the shortest run reaching 80%', [ps.key.map((x) => x.key), ps.rest.map((x) => x.key)], [['a', 'b'], ['c']]);
check('pareto cumulative shares', ps.key.concat(ps.rest).map((x) => [x.rank, x.share, x.cumShare]), [[1, 66.7, 66.7], [2, 22.2, 88.9], [3, 11.1, 100]]);
check('pareto headline floors the share', [ps.headline, ps.summary], ['2 snippets did 88% of your work', 'That is 2 of the 5 snippets in your library (40%).']);
check('pareto device per row, unknown device reads Before tracking', [ps.key[0].device, ps.key[1].device.unknown],
  [{ computer: 3, phone: 2, unknown: 1, computerShare: 50, phoneShare: 33.3, unknownShare: 16.7 }, 1]);
check('pareto groups', [ps.keyGroup.count, ps.keyGroup.uses, ps.keyGroup.share, ps.restGroup.uses, ps.device.phone], [2, 8, 88.9, 1, 3]);
check('pareto prompts', [pe.prompts.headline, pe.prompts.key[0].title, pe.prompts.uses, pe.prompts.unused], ['1 prompt did all of your work', 'tidy', 1, 1]);
check('pareto without prompts', UA.pareto({ now: NOW, period: 7, snippets, folders, events: [] }).prompts, null);
const pEmpty = UA.pareto({ now: NOW, period: 30, snippets: [], folders: [], events: [], prompts: [], promptEvents: [] });
check('pareto empty', [pEmpty.snippets.empty, pEmpty.snippets.headline, pEmpty.prompts.headline, pEmpty.snippets.key.length],
  [true, 'No snippets used in this period', 'No prompts used in this period', 0]);
check('device labels', UA.DEVICE_LABELS, { computer: 'Computer', phone: 'Phone', unknown: 'Before tracking' });

// A calendar month (the monthly recap email): October against September, which
// is a day shorter. The month's last day is "today" for the streak, and a
// month still running is cut at the real today.
const monthEvents = [
  ev('a', at(2026, 10, 2, 9), 1), ev('b', at(2026, 10, 3, 9)), ev('a', at(2026, 10, 31, 23, 30)),
  ev('a', at(2026, 9, 30, 23, 59)), ev('c', at(2026, 9, 1, 0, 0)),
  ev('a', at(2026, 8, 31, 23, 59)),
];
const mo = UA.compute({ now: new Date(2026, 11, 1, 9).getTime(), month: '2026-10', events: monthEvents, snippets, folders });
check('month window', [mo.period, mo.label, mo.rangeLabel, mo.prevRangeLabel, mo.start, mo.prevStart, mo.series.length],
  [31, 'October 2026', 'Oct 1 – Oct 31, 2026', 'Sep 1 – Sep 30, 2026', '2026-10-01', '2026-09-01', 31]);
check('month totals against the month before', [mo.totals.uses.cur, mo.totals.uses.prev, mo.totals.uses.text, mo.totals.activeDays.cur, mo.totals.activeDays.prev, mo.totals.days],
  [3, 2, '+50%', 3, 2, 31]);
check('month streak runs to the month end', mo.patterns.streak.longestInPeriod, 2);
check('month series ends on the 31st', [mo.series[30].date, mo.series[30].count, mo.series[0].prev], ['2026-10-31', 1, 1]);
const running = UA.compute({ now: NOW, month: '2026-10', events: monthEvents, snippets, folders });
check('an unfinished month is cut at today', [running.totals.uses.cur, running.patterns.streak.current], [2, 0]);
check('a bad month falls back to the period', UA.compute({ now: NOW, month: '2026-13', period: 7, events: [], snippets, folders }).label, 'Last 7 days');
const moP = UA.pareto({ now: new Date(2026, 11, 1, 9).getTime(), month: '2026-10', events: monthEvents, snippets, folders });
check('pareto by month', [moP.label, moP.snippets.uses, moP.snippets.headline], ['October 2026', 3, '2 snippets did all of your work']);

// Suggestions: snippets and prompts used one after the other, and pieces the
// library lacks. The window is the last 90 days ending today.
const sSnips = [
  { id: 's1', title: 'Price reply', text: 'The price is {formtext: name=TOTAL; type=number} EUR. Payment by card.', lang: 'EN' },
  { id: 's2', title: 'Payment details', text: 'You can pay by bank transfer to the account below.', lang: 'EN' },
  { id: 's3', title: 'Terms link', text: 'Read our terms here: https://example.com/terms', lang: 'EN' },
  { id: 's4', title: 'Hello', text: 'Hi there', lang: 'IT' },
];
function sev(id, d, h, min) { return { snippet_id: id, created_at: at(2026, 10, d, h, min) }; }
const runs = [];
[20, 21, 22].forEach((d) => runs.push(sev('s1', d, 9, 0), sev('s2', d, 9, 3), sev('s3', d, 9, 5)));
runs.push(sev('s1', 23, 9, 0), sev('s1', 23, 9, 1), sev('s2', 23, 9, 2));  // the same snippet twice is one step
runs.push(sev('s4', 24, 9, 0), sev('s1', 24, 9, 30));                       // 30 minutes apart: not together
runs.push(sev('s4', 25, 9, 0), sev('s1', 25, 9, 2), sev('s4', 26, 9, 0), sev('s1', 26, 9, 2)); // twice only
runs.push({ snippet_id: 's1', created_at: at(2026, 7, 1, 9, 0) }, { snippet_id: 's2', created_at: at(2026, 7, 1, 9, 1) }); // older than 90 days
const sPrompts = [{ id: 'p1', name: 'Summarise', text: 'Summarise this thread.' }, { id: 'p2', name: 'Action list', text: 'Turn notes into actions.' }];
const pRuns = [];
[10, 11, 12].forEach((d) => pRuns.push({ prompt_id: 'p1', created_at: at(2026, 10, d, 15, 0) }, { prompt_id: 'p2', created_at: at(2026, 10, d, 15, 4) }));

const sg = UA.suggest({ now: NOW, events: runs, promptEvents: pRuns, snippets: sSnips, prompts: sPrompts, brains: [] });
check('together: a chain of three, its pairs folded in, prompts apart',
  sg.together.map((s) => [s.key, s.count, s.titles.join(' > ')]),
  [['snippet:s1>s2>s3', 3, 'Price reply > Payment details > Terms link'], ['prompt:p1>p2', 3, 'Summarise > Action list']]);
check('together sentence', sg.together[0].text, 'You used these one after the other 3 times in the last 90 days.');
const strongPair = runs.concat([27, 27].map((d, i) => sev('s1', d, 10 + i * 2, 0)).concat([sev('s2', 27, 10, 1), sev('s2', 27, 12, 1)]));
check('a pair used far more often than its chain of three stays on its own',
  UA.suggest({ now: NOW, events: strongPair.concat([sev('s1', 28, 8, 0), sev('s2', 28, 8, 1)]), snippets: sSnips }).together.map((s) => [s.key, s.count]),
  [['snippet:s1>s2', 7], ['snippet:s1>s2>s3', 3]]);
const fiveDaysAgo = new Date(NOW - 5 * 86400000).toISOString();
const fortyDaysAgo = new Date(NOW - 40 * 86400000).toISOString();
check('Not now hides a suggestion for 30 days',
  [UA.suggest({ now: NOW, events: runs, snippets: sSnips, dismissed: { 'snippet:s1>s2>s3': fiveDaysAgo } }).together.length,
    UA.suggest({ now: NOW, events: runs, snippets: sSnips, dismissed: { 'snippet:s1>s2>s3': fortyDaysAgo } }).together.length],
  [0, 1]);
const joinedSnips = sSnips.concat([{ id: 's5', title: 'All in one', text: sSnips[0].text + '\n\n' + sSnips[1].text + '\n\n' + sSnips[2].text }]);
check('a chain already joined into one snippet is not suggested again',
  UA.suggest({ now: NOW, events: runs, snippets: joinedSnips }).together.length, 0);

const mLib = [
  { id: 'x1', title: 'Quote', text: 'Your quote total is {formtext: name=TOTAL; type=number} EUR.' },
  { id: 'x2', title: 'Deposit', text: 'Please pay the deposit within a week.' },
];
const mg = UA.suggest({ now: NOW, snippets: mLib, prompts: [], brains: [] });
check('missing: terms link and quote follow-up',
  mg.missing.map((s) => [s.key, s.kind, s.libraryId, s.title]),
  [['missing:terms', 'snippet', 'terms', 'Terms and conditions link'], ['missing:followquote', 'snippet', 'followquote', 'Follow-up on a quote']]);
check('missing sentences', mg.missing.map((s) => s.text),
  ['2 of your snippets talk about prices or payments, but none links to your terms and conditions.', 'You have a snippet for quotes, but none to follow up on one.']);
check('words in another language and with accents count',
  UA.suggest({ now: NOW, snippets: mLib.concat([{ id: 'x3', title: 'Condiciones', text: 'Consulta nuestros términos.' }]) }).missing.map((s) => s.key),
  ['missing:followquote']);
check('an item with the library name is already there',
  UA.suggest({ now: NOW, snippets: mLib.concat([{ id: 'x4', title: 'Terms and conditions link', text: 'Here.' }]) }).missing.map((s) => s.key),
  ['missing:followquote']);
check('Not now hides a missing piece', UA.suggest({ now: NOW, snippets: mLib, dismissed: { 'missing:terms': fiveDaysAgo } }).missing.map((s) => s.key),
  ['missing:followquote']);
const factLib = [
  { id: 'f1', title: 'Prices', text: 'Our prices start at 10 EUR.', lang: 'EN' },
  { id: 'f2', title: 'Hours', text: 'Opening hours: 9 to 18.', lang: 'IT' },
  { id: 'f3', title: 'Cancel', text: 'You can cancel up to two days before.', lang: 'ES' },
];
check('Brains and prompts get missing pieces, in rule order',
  UA.suggest({ now: NOW, snippets: factLib }).missing.map((s) => [s.key, s.kind]),
  [['missing:company', 'brain'], ['missing:translate', 'prompt']]);
check('three missing pieces at most',
  UA.suggest({ now: NOW, snippets: factLib.concat(mLib) }).missing.map((s) => s.key),
  ['missing:terms', 'missing:company', 'missing:followquote']);
check('a Brain about the company covers it',
  UA.suggest({ now: NOW, snippets: factLib, brains: [{ name: 'About us', description: 'Who we are' }] }).missing.map((s) => s.key),
  ['missing:translate']);
check('a library with nothing to suggest is empty', [UA.suggest({ now: NOW }).empty, UA.suggest({ now: NOW }).days], [true, 90]);
check('every rule names a library item', UA.MISSING_RULES.map((r) => r.key + ':' + r.kind),
  ['terms:snippet', 'company:brain', 'reply:prompt', 'followquote:snippet', 'translate:prompt', 'overdue:snippet', 'tone:brain', 'away:snippet']);

// What usually comes next, for "Add Firma after it" in the fill windows.
const nx = UA.nextAfter({ now: NOW, events: runs });
check('next after each snippet, from the same runs', nx, { s1: { id: 's2', count: 4 }, s2: { id: 's3', count: 3 } });
check('a pair seen twice is not enough', UA.nextAfter({ now: NOW, events: runs }).s4, undefined);
check('a snippet no longer in the library breaks the run',
  UA.nextAfter({ now: NOW, events: runs, ids: ['s1', 's3'] }), {});
const tie = [];
[10, 11, 12].forEach((d) => tie.push(sev('a', d, 9, 0), sev('c', d, 9, 1)));
[13, 14, 15].forEach((d) => tie.push(sev('a', d, 9, 0), sev('b', d, 9, 1)));
check('a tie goes to the id that sorts first', UA.nextAfter({ now: NOW, events: tie }).a, { id: 'b', count: 3 });
check('prompts read through idField', UA.nextAfter({ now: NOW, events: pRuns, idField: 'prompt_id' }), { p1: { id: 'p2', count: 3 } });

if (failed) {
  console.error('\n' + failed + ' usage analytics check(s) failed');
  process.exit(1);
}
console.log('\nusage analytics: all checks passed');
