#!/usr/bin/env node
// Monthly recap email gate.
//
// services/supabase/functions/monthly-recap/recap-email.js decides the words
// and numbers of the recap email from the shared usage analytics run with
// `month`. This runs a fixed October over it and pins what the email says:
// the figures, the month grid, the milestone rules, the change wording, and
// that a snippet title cannot put markup into the email.
//
//   node scripts/check-monthly-recap.js            the checks
//   node scripts/check-monthly-recap.js --out FILE  also write the sample HTML
process.env.TZ = 'Europe/Rome';

const fs = require('fs');
const path = require('path');
const UA = require(path.join(__dirname, '..', 'extension', 'shared', 'usage-analytics.js'));
const { buildRecapModel, renderRecapEmail } = require(path.join(__dirname, '..', 'services', 'supabase', 'functions', 'monthly-recap', 'recap-email.js'));

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

function at(y, m, d, h, min) { return new Date(y, m - 1, d, h, min || 0).toISOString(); }
const NOW = new Date(2026, 10, 1, 9).getTime();
const format = { count: UA.formatCount, duration: UA.formatDuration };

const snippets = [
  { id: 'a', title: 'Price quote', shortcut: '::quote', folder_id: 'f1', lang: 'EN', created_at: at(2026, 1, 1, 9) },
  { id: 'b', title: 'Order confirmed <b>today</b>', shortcut: '::ok', folder_id: 'f1', lang: 'EN', created_at: at(2026, 1, 1, 9) },
  { id: 'c', title: 'Follow-up after a call', shortcut: '::fu', folder_id: null, lang: 'IT', created_at: at(2026, 2, 1, 9) },
  { id: 'd', title: 'Opening hours', shortcut: '::hours', folder_id: null, lang: 'EN', created_at: at(2026, 2, 1, 9) },
];
const folders = [{ id: 'f1', name: 'Replies' }];
const prompts = [{ id: 'p1', name: 'Summarise this thread', shortcut: 'sum' }];

// October 2026: a × 12, b × 7, c × 4, d × 1 across 20 days; 14 October is the
// busiest (5) and 12 to 16 the longest run. September has 20 inserts on 10 days.
const events = [];
function add(id, day, hour, n, device, fields) {
  for (let i = 0; i < n; i++) events.push({ snippet_id: id, created_at: at(2026, 10, day, hour, i), fields_filled: fields || 0, device });
}
add('a', 1, 9, 1, 'computer', 2); add('a', 2, 9, 1, 'computer'); add('b', 5, 10, 1, 'computer');
add('a', 6, 9, 1, 'phone'); add('a', 7, 9, 1, 'computer'); add('b', 8, 9, 1, 'computer');
add('a', 9, 9, 1, 'computer'); add('a', 12, 9, 1, 'computer'); add('b', 13, 9, 1, 'phone');
add('a', 14, 9, 3, 'computer', 1); add('b', 14, 11, 2, 'computer'); add('c', 15, 9, 1, 'computer');
add('a', 16, 9, 1, 'computer'); add('c', 19, 9, 1, 'phone'); add('a', 20, 9, 1, 'computer');
add('b', 21, 9, 1, 'computer'); add('c', 22, 9, 1, 'computer'); add('a', 23, 9, 1, 'computer');
add('d', 26, 9, 1, 'computer'); add('b', 27, 9, 1, 'phone'); add('c', 28, 9, 1, 'computer');
for (let day = 1; day <= 10; day++) events.push({ snippet_id: 'a', created_at: at(2026, 9, day, 9), fields_filled: 0, device: 'computer' }, { snippet_id: 'b', created_at: at(2026, 9, day, 10), fields_filled: 0, device: 'computer' });
const promptEvents = [
  { prompt_id: 'p1', created_at: at(2026, 10, 3, 9), device: 'computer' },
  { prompt_id: 'p1', created_at: at(2026, 10, 9, 9), device: 'phone' },
];

const base = { now: NOW, month: '2026-10', events, snippets, folders, prompts, promptEvents };
const report = UA.compute(base);
const pareto = UA.pareto(base);

const model = buildRecapModel({
  report, pareto, format,
  allTimeBefore: 980, allTimeAfter: 1004, bestMonthBefore: 30,
  stopUrl: 'https://example.test/stop?token=abc',
});

check('subject and month', [model.subject, model.monthName, model.year, model.monthKey], ['Your October Fibonax recap', 'October', 2026, '2026-10']);
check('headline figures', [model.headline.uses, model.headline.delta, model.headline.timeSaved],
  ['24', { text: '▲ 4', dir: 'up', suffix: 'vs September' }, '12 min']);
check('secondary figures', model.figures.map((f) => [f.value, f.label]), [
  ['20', 'active days'], ['5 days', 'longest streak'], ['4', 'different snippets used'],
  ['2', 'prompts used'], ['5', 'fields filled in'], ['5', 'on Wed 14 Oct, your busiest day'],
]);
check('milestone: a threshold passed this month wins', model.milestone, { lead: 'Milestone:', text: 'in October you passed 1,000 snippets inserted since you started. That is a lot of typing you did not do.' });
check('calendar: October 2026 starts on a Thursday and has 31 days', [
  model.calendar.length, model.calendar[0].slice(0, 3), model.calendar[0][3].day, model.calendar[4][5].day, model.calendar[4][6],
], [5, [null, null, null], 1, 31, null]);
check('calendar levels step with the busiest day', [
  model.calendar[2][2], model.calendar[0][3].level, model.calendar[0][6].level,
], [{ day: 14, count: 5, level: 4, best: true }, 1, 0]);
check('calendar caption', model.calendarCaption, 'Darker days had more inserts. Your busiest day was Wednesday 14 October, with 5.');
check('insight is the 80/20 with the top three', [model.insight.headline, model.insight.rows],
  ['3 snippets did 95% of your work.', [{ title: 'Price quote', uses: '12' }, { title: 'Order confirmed <b>today</b>', uses: '7' }, { title: 'Follow-up after a call', uses: '4' }]]);
check('phone share from tracked inserts', model.phoneLine, '17% of your inserts were from your phone.');

const email = renderRecapEmail(model);
check('rendered subject', email.subject, 'Your October Fibonax recap');
check('a snippet title cannot put markup in the email', [email.html.includes('<b>today</b>'), email.html.includes('Order confirmed &lt;b&gt;today&lt;/b&gt;')], [false, true]);
check('nothing undefined or NaN in the email', [/undefined|NaN/.test(email.html), /undefined|NaN/.test(email.text)], [false, false]);
check('the stop link and the dashboard link are in both versions', [
  email.html.includes('href="https://example.test/stop?token=abc"'), email.text.includes('https://example.test/stop?token=abc'),
  email.html.includes('https://app.fibonax.com/analytics'), email.text.includes('https://app.fibonax.com/analytics'),
], [true, true, true, true]);
check('every day of the month is drawn once', (email.html.match(/line-height:34px;border-radius:8px/g) || []).length, 31);
check('no location in the footer', /Ibiza|Spain|Italy/.test(email.html), false);
check('the footer ends on the two links', [
  /Help<\/a>\s*<\/td>/.test(email.html), email.text.trimEnd().endsWith('Help: https://docs.fibonax.com/settings/account#monthly-recap-email'),
], [true, true]);

// Milestone rules, in order.
const quiet = { report, pareto, format, stopUrl: '' };
check('milestone: busiest month so far', buildRecapModel({ ...quiet, allTimeBefore: 500, allTimeAfter: 524, bestMonthBefore: 20 }).milestone.lead, 'Your busiest month so far:');
check('milestone: plain all-time count otherwise', buildRecapModel({ ...quiet, allTimeBefore: 500, allTimeAfter: 524, bestMonthBefore: 30 }).milestone,
  { lead: 'Since you started:', text: '524 snippets inserted with Fibonax.' });
check('milestone: the first month reads the plain count', buildRecapModel({ ...quiet, allTimeBefore: 0, allTimeAfter: 24, bestMonthBefore: 0 }).milestone.text, '24 snippets inserted with Fibonax.');

// Change wording.
const sameEvents = events.filter((e) => e.created_at < at(2026, 10, 1, 0)).concat(
  events.filter((e) => e.created_at < at(2026, 10, 1, 0)).map((e) => ({ ...e, created_at: e.created_at.replace('2026-09', '2026-10') })),
);
const same = UA.compute({ ...base, events: sameEvents });
check('same as the month before', buildRecapModel({ report: same, pareto: UA.pareto({ ...base, events: sameEvents }), format, stopUrl: '' }).headline.delta, { text: 'Same as September', dir: 'flat' });
const first = UA.compute({ ...base, events: events.filter((e) => e.created_at >= at(2026, 10, 1, 0)) });
check('a first month has no comparison', buildRecapModel({ report: first, pareto, format, stopUrl: '' }).headline.delta, { text: 'First month with inserts', dir: 'flat' });
const fewer = UA.compute({ ...base, events: events.filter((e) => !(e.snippet_id === 'a' && e.created_at >= at(2026, 10, 1, 0))) });
check('a drop', buildRecapModel({ report: fewer, pareto, format, stopUrl: '' }).headline.delta, { text: '▼ 8', dir: 'down', suffix: 'vs September' });

// A month with prompts only still has an insight; a month with nothing says so.
const promptsOnly = { ...base, events: [] };
const po = buildRecapModel({ report: UA.compute(promptsOnly), pareto: UA.pareto(promptsOnly), format, stopUrl: '' });
check('prompts carry the insight when no snippet was used', [po.insight.headline, po.phoneLine, po.figures[3].value], ['1 prompt did all of your work.', null, '2']);
const nothing = { ...base, events: [], promptEvents: [] };
const no = buildRecapModel({ report: UA.compute(nothing), pareto: UA.pareto(nothing), format, stopUrl: '' });
check('an empty month', [no.insight.headline, no.insight.rows.length, no.calendarCaption, no.headline.delta.text], ['A quiet month.', 0, 'No inserts this month.', 'Nothing yet']);

const outAt = process.argv.indexOf('--out');
if (outAt !== -1 && process.argv[outAt + 1]) {
  fs.writeFileSync(process.argv[outAt + 1], email.html);
  console.log('wrote ' + process.argv[outAt + 1]);
}

if (failed) {
  console.error('\n' + failed + ' monthly recap check(s) failed');
  process.exit(1);
}
console.log('\nmonthly recap: all checks passed');
