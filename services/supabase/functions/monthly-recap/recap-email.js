// The monthly recap email, decided once.
//
// buildRecapModel() turns one person's month (a compute() report and a
// pareto() report from the shared usage analytics, both run with `month`) into
// the words and numbers the email shows. renderRecapEmail() turns that model
// into the subject, the HTML and the plain-text version. Nothing here reads
// the clock, the network or the database, so the server function and the node
// gate (scripts/check-monthly-recap.js) render exactly the same email.
//
// Plain ES module, no imports: Deno loads it beside index.ts and node loads it
// from the gate. Colours are the design system's tokens written out, because
// an email cannot load a stylesheet (docs/DESIGN_SYSTEM.md: ink, ink-muted,
// ink-subtle, line, bg-alt, primary, primary-bg, the activity scale).

const DASHBOARD_ANALYTICS = 'https://app.fibonax.com/analytics';
const HELP_URL = 'https://docs.fibonax.com/settings/account#monthly-recap-email';

/** All-time inserts a person is told about the month they pass one. */
const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAYS_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WEEKDAYS_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The activity scale: no inserts, then four steps up to the busiest day. */
const LEVEL_BG = ['#EBEDF0', '#C7D8FF', '#8FAEF6', '#4E7AEA', '#1B4FD8'];
const LEVEL_INK = ['#6E6E73', '#1C1C1E', '#1C1C1E', '#FFFFFF', '#FFFFFF'];

const COLOR = {
  ink: '#1C1C1E',
  muted: '#6E6E73',
  subtle: '#6B6B70',
  line: '#E5E5EA',
  bg: '#FAFAFA',
  bgAlt: '#F2F2F7',
  card: '#FFFFFF',
  primary: '#1B4FD8',
  primaryBg: '#EEF2FF',
  primarySoft: '#C7D8FF',
  upInk: '#15803D',
  upBg: '#F0FDF4',
  downInk: '#B42318',
  downBg: '#FEF2F2',
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseDay(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

/** Monday-first weekday index of a calendar day, without touching the local clock. */
function weekdayOf(year, month, day) {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The month as a grid of weeks, Monday first. Each cell is null (outside the
 * month) or { day, count, level, best }. Levels step with the busiest day, so
 * a quiet month still shows its own shape.
 */
function calendarOf(report) {
  const start = parseDay(report.start);
  const counts = {};
  let max = 0;
  for (const point of report.series) {
    const d = parseDay(point.date);
    if (!d || d.month !== start.month) continue;
    counts[d.day] = point.count;
    if (point.count > max) max = point.count;
  }
  const bestDay = report.totals.bestDay ? parseDay(report.totals.bestDay.date) : null;
  const total = daysInMonth(start.year, start.month);
  const weeks = [];
  let week = [];
  for (let blank = 0; blank < weekdayOf(start.year, start.month, 1); blank++) week.push(null);
  for (let day = 1; day <= total; day++) {
    const count = counts[day] || 0;
    const level = count === 0 ? 0 : Math.max(1, Math.ceil((count / max) * 4));
    week.push({ day, count, level, best: !!bestDay && bestDay.day === day });
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function longDate(key) {
  const d = parseDay(key);
  if (!d) return '';
  return WEEKDAYS_LONG[weekdayOf(d.year, d.month, d.day)] + ' ' + d.day + ' ' + MONTHS_LONG[d.month - 1];
}

function shortDate(key) {
  const d = parseDay(key);
  if (!d) return '';
  return WEEKDAYS_ABBR[weekdayOf(d.year, d.month, d.day)] + ' ' + d.day + ' ' + MONTHS_SHORT[d.month - 1];
}

/** How a count moved against the month before, in words a reader does not have to decode. */
function deltaOf(change, prevMonthName, count) {
  if (change.prev === 0 && change.cur === 0) return { text: 'Nothing yet', dir: 'flat' };
  if (change.prev === 0) return { text: 'First month with inserts', dir: 'flat' };
  if (change.diff === 0) return { text: 'Same as ' + prevMonthName, dir: 'flat' };
  const arrow = change.diff > 0 ? '▲' : '▼';
  return { text: arrow + ' ' + count(Math.abs(change.diff)), dir: change.diff > 0 ? 'up' : 'down', suffix: 'vs ' + prevMonthName };
}

/**
 * The milestone line at the top, in this order: an all-time threshold passed
 * this month, then the busiest month so far, then plainly where the all-time
 * count stands. Every account gets one; the first month gets the plain one.
 */
function milestoneOf(input, uses, count) {
  const before = Math.max(0, Number(input.allTimeBefore) || 0);
  const after = Math.max(before, Number(input.allTimeAfter) || 0);
  const best = Math.max(0, Number(input.bestMonthBefore) || 0);
  let crossed = 0;
  for (const m of MILESTONES) if (before < m && m <= after) crossed = m;
  if (crossed) {
    return {
      lead: 'Milestone:',
      text: 'in ' + input.monthName + ' you passed ' + count(crossed) + ' snippets inserted since you started. That is a lot of typing you did not do.',
    };
  }
  if (uses > 0 && best > 0 && uses > best) {
    return {
      lead: 'Your busiest month so far:',
      text: count(uses) + ' snippets inserted, more than in any month before.',
    };
  }
  return {
    lead: 'Since you started:',
    text: count(after) + ' snippets inserted with Fibonax.',
  };
}

/**
 * One person's month, ready to render.
 *
 *   report           compute({ month })      from the shared usage analytics
 *   pareto           pareto({ month })       the 80/20 of the same month
 *   allTimeBefore    inserts before the month started, all time
 *   allTimeAfter     inserts up to the end of the month, all time
 *   bestMonthBefore  the most inserts in any earlier calendar month
 *   stopUrl          the one-click link that turns the recap off
 *   format           { count, duration } from the shared module
 */
export function buildRecapModel(input) {
  const report = input.report;
  const pareto = input.pareto;
  const count = input.format.count;
  const duration = input.format.duration;
  const start = parseDay(report.start);
  const monthName = MONTHS_LONG[start.month - 1];
  const prevStart = parseDay(report.prevStart);
  const prevMonthName = MONTHS_LONG[prevStart.month - 1];
  const totals = report.totals;
  const uses = totals.uses.cur;

  const snippetsPareto = pareto.snippets;
  const promptsPareto = pareto.prompts;
  const promptUses = promptsPareto ? promptsPareto.uses : 0;
  const lead = snippetsPareto.uses > 0 ? snippetsPareto : promptUses > 0 ? promptsPareto : null;
  const insight = lead
    ? {
      headline: lead.headline + '.',
      summary: lead.summary,
      rows: lead.key.slice(0, 3).map((row) => ({ title: row.title, uses: count(row.uses) })),
    }
    : {
      headline: 'A quiet month.',
      summary: 'Nothing was inserted in ' + monthName + '. The next recap is there when you are.',
      rows: [],
    };

  const device = snippetsPareto.device;
  const tracked = device.computer + device.phone;
  const phoneLine = tracked > 0
    ? Math.round((device.phone / tracked) * 100) + '% of your inserts were from your phone.'
    : null;

  const best = totals.bestDay;
  const calendarCaption = best
    ? 'Darker days had more inserts. Your busiest day was ' + longDate(best.date) + ', with ' + count(best.count) + '.'
    : 'No inserts this month.';

  return {
    monthName,
    year: start.year,
    monthKey: report.start.slice(0, 7),
    subject: 'Your ' + monthName + ' Fibonax recap',
    preheader: uses > 0
      ? 'In ' + monthName + ' you inserted ' + count(uses) + ' snippets and saved about ' + duration(totals.secondsSaved.cur) + '. Here is your month.'
      : 'Your ' + monthName + ' with Fibonax, in one page.',
    milestone: milestoneOf({ ...input, monthName }, uses, count),
    headline: {
      uses: count(uses),
      delta: deltaOf(totals.uses, prevMonthName, count),
      timeSaved: duration(totals.secondsSaved.cur),
      timeNote: 'An estimate, at 30 seconds per insert',
    },
    figures: [
      { value: count(totals.activeDays.cur), label: 'active days' },
      { value: report.patterns.streak.longestInPeriod + (report.patterns.streak.longestInPeriod === 1 ? ' day' : ' days'), label: 'longest streak' },
      { value: count(totals.snippetsUsed.cur), label: 'different snippets used' },
      { value: count(promptUses), label: 'prompts used' },
      { value: count(totals.fieldsFilled.cur), label: 'fields filled in' },
      { value: best ? count(best.count) : '0', label: best ? 'on ' + shortDate(best.date) + ', your busiest day' : 'on your busiest day' },
    ],
    calendar: calendarOf(report),
    calendarCaption,
    insight,
    phoneLine,
    dashboardUrl: DASHBOARD_ANALYTICS,
    stopUrl: String(input.stopUrl || ''),
    helpUrl: HELP_URL,
  };
}

function cell(c) {
  if (!c) return '<td style="padding:3px;"></td>';
  const bg = LEVEL_BG[c.level];
  const ink = LEVEL_INK[c.level];
  const weight = c.best ? 'font-weight:700;' : '';
  return '<td align="center" style="padding:3px;"><div style="width:34px;height:34px;line-height:34px;border-radius:8px;background:' + bg + ';color:' + ink + ';font-size:13px;' + weight + 'margin:0 auto;">' + c.day + '</div></td>';
}

function figureCell(f) {
  return '<td class="half" width="33%" valign="top" style="padding:16px 0;border-top:1px solid ' + COLOR.line + ';">'
    + '<div class="num" style="font-size:26px;font-weight:700;letter-spacing:-0.02em;color:' + COLOR.ink + ';">' + escapeHtml(f.value) + '</div>'
    + '<div style="margin-top:3px;font-size:13px;color:' + COLOR.muted + ';">' + escapeHtml(f.label) + '</div>'
    + '</td>';
}

function deltaHtml(delta) {
  const bg = delta.dir === 'up' ? COLOR.upBg : delta.dir === 'down' ? COLOR.downBg : COLOR.bgAlt;
  const ink = delta.dir === 'up' ? COLOR.upInk : delta.dir === 'down' ? COLOR.downInk : COLOR.muted;
  const chip = '<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:' + bg + ';color:' + ink + ';font-weight:600;">' + escapeHtml(delta.text) + '</span>';
  return delta.suffix ? chip + '&nbsp;' + escapeHtml(delta.suffix) : chip;
}

/** The subject, the HTML and the plain text of one recap. */
export function renderRecapEmail(model) {
  const m = model;
  const weekdayRow = WEEKDAYS_SHORT.map((w) => '<td align="center" style="padding-bottom:6px;">' + w + '</td>').join('');
  const weeks = m.calendar.map((week) => '<tr>' + week.map(cell).join('') + '</tr>').join('\n');
  const figures = '<tr>' + m.figures.slice(0, 3).map(figureCell).join('') + '</tr><tr>' + m.figures.slice(3, 6).map(figureCell).join('') + '</tr>';
  const insightRows = m.insight.rows.map((row) =>
    '<tr><td style="padding:10px 0;border-top:1px solid ' + COLOR.line + ';font-size:14px;color:' + COLOR.ink + ';">' + escapeHtml(row.title) + '</td>'
    + '<td align="right" class="num" style="padding:10px 0;border-top:1px solid ' + COLOR.line + ';font-size:14px;color:' + COLOR.muted + ';">' + escapeHtml(row.uses) + '</td></tr>').join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(m.subject)}</title>
<style>
  body { margin:0; padding:0; background:${COLOR.bgAlt}; -webkit-font-smoothing:antialiased; }
  table { border-collapse:collapse; }
  a { color:${COLOR.primary}; }
  .num { font-variant-numeric: tabular-nums; }
  @media (max-width: 480px) {
    .wrap { width:100% !important; }
    .pad { padding-left:21px !important; padding-right:21px !important; }
    .col { display:block !important; width:100% !important; box-sizing:border-box !important; }
    .half { display:inline-block !important; width:48% !important; box-sizing:border-box !important; vertical-align:top; }
    .col-gap { display:none !important; }
    .big { font-size:44px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLOR.bgAlt};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:${COLOR.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(m.preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bgAlt};">
<tr><td align="center" style="padding:34px 13px;">

<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">

  <tr><td class="pad" style="padding:0 8px 21px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${COLOR.ink};">
        <span style="display:inline-block;width:13px;height:13px;border-radius:3px;background:${COLOR.primary};vertical-align:-1px;margin-right:8px;"></span>Fibonax
      </td>
      <td align="right" style="font-size:13px;color:${COLOR.muted};">Monthly recap</td>
    </tr></table>
  </td></tr>

  <tr><td style="background:${COLOR.card};border:1px solid ${COLOR.line};border-radius:21px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td class="pad" style="padding:42px 42px 34px;">
        <div style="font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLOR.primary};">${escapeHtml(m.monthName + ' ' + m.year)}</div>
        <div style="margin-top:8px;font-size:34px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${COLOR.ink};">Your month<br>with Fibonax</div>
        <div style="margin-top:21px;padding:13px 16px;background:${COLOR.primaryBg};border-radius:13px;font-size:15px;line-height:1.5;color:${COLOR.ink};">
          <strong>${escapeHtml(m.milestone.lead)}</strong> ${escapeHtml(m.milestone.text)}
        </div>
      </td></tr>

      <tr><td class="pad" style="padding:0 42px 13px;">
        <div style="font-size:13px;font-weight:600;color:${COLOR.muted};">Your month in review</div>
      </td></tr>

      <tr><td class="pad" style="padding:0 42px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td class="col" width="62%" valign="top" style="background:${COLOR.bg};border:1px solid ${COLOR.line};border-radius:13px;padding:21px;">
              <div style="font-size:13px;color:${COLOR.muted};">Snippets inserted</div>
              <div class="big num" style="margin-top:8px;font-size:55px;line-height:1;font-weight:700;letter-spacing:-0.03em;color:${COLOR.ink};">${escapeHtml(m.headline.uses)}</div>
              <div style="margin-top:13px;font-size:13px;color:${COLOR.muted};">${deltaHtml(m.headline.delta)}</div>
            </td>
            <td class="col-gap" width="13" style="width:13px;"></td>
            <td class="col" width="38%" valign="top" style="background:${COLOR.primary};border-radius:13px;padding:21px;color:${COLOR.card};">
              <div style="font-size:13px;color:${COLOR.primarySoft};">Time saved</div>
              <div class="num" style="margin-top:8px;font-size:30px;line-height:1;font-weight:700;letter-spacing:-0.02em;white-space:nowrap;">${escapeHtml(m.headline.timeSaved)}</div>
              <div style="margin-top:13px;font-size:12px;line-height:1.4;color:${COLOR.primarySoft};">${escapeHtml(m.headline.timeNote)}</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td class="pad" style="padding:13px 42px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${figures}</table>
      </td></tr>

      <tr><td class="pad" style="padding:21px 42px 0;">
        <div style="font-size:13px;font-weight:600;color:${COLOR.muted};">Your days in ${escapeHtml(m.monthName)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:13px;">
          <tr style="font-size:11px;color:${COLOR.muted};">${weekdayRow}</tr>
${weeks}
        </table>
        <div style="margin-top:8px;font-size:12px;color:${COLOR.subtle};">${escapeHtml(m.calendarCaption)}</div>
      </td></tr>

      <tr><td class="pad" style="padding:34px 42px 0;">
        <div style="font-size:13px;font-weight:600;color:${COLOR.muted};">Your monthly insight</div>
        <div style="margin-top:8px;font-size:21px;line-height:1.35;font-weight:600;letter-spacing:-0.01em;color:${COLOR.ink};">${escapeHtml(m.insight.headline)}</div>
        <div style="margin-top:5px;font-size:15px;line-height:1.5;color:${COLOR.muted};">${escapeHtml(m.insight.summary)}</div>
        ${insightRows ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:13px;">\n' + insightRows + '\n        </table>' : ''}
        ${m.phoneLine ? '<div style="margin-top:13px;font-size:13px;color:' + COLOR.subtle + ';">' + escapeHtml(m.phoneLine) + '</div>' : ''}
      </td></tr>

      <tr><td class="pad" align="center" style="padding:34px 42px 42px;">
        <a href="${escapeHtml(m.dashboardUrl)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:${COLOR.primary};color:${COLOR.card};font-size:15px;font-weight:600;text-decoration:none;">See the full picture</a>
        <div style="margin-top:10px;font-size:12px;color:${COLOR.subtle};">Opens your Analytics page on the dashboard</div>
      </td></tr>
    </table>
  </td></tr>

  <tr><td class="pad" align="center" style="padding:26px 21px 0;font-size:12px;line-height:1.6;color:${COLOR.subtle};">
    You get this once a month because you have a Fibonax account.<br>
    <a href="${escapeHtml(m.stopUrl)}" style="color:${COLOR.subtle};">Stop the monthly recap</a> &nbsp;&middot;&nbsp; <a href="${escapeHtml(m.helpUrl)}" style="color:${COLOR.subtle};">Help</a>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>
`;

  const lines = [
    'Fibonax, monthly recap',
    '',
    m.monthName + ' ' + m.year + ': your month with Fibonax',
    '',
    m.milestone.lead + ' ' + m.milestone.text,
    '',
    'Your month in review',
    'Snippets inserted: ' + m.headline.uses + ' (' + m.headline.delta.text + (m.headline.delta.suffix ? ' ' + m.headline.delta.suffix : '') + ')',
    'Time saved: ' + m.headline.timeSaved + ' (' + m.headline.timeNote.toLowerCase() + ')',
  ];
  for (const f of m.figures) lines.push(f.value + ' ' + f.label);
  lines.push('', m.calendarCaption, '', 'Your monthly insight', m.insight.headline, m.insight.summary);
  for (const row of m.insight.rows) lines.push('- ' + row.title + ': ' + row.uses);
  if (m.phoneLine) lines.push('', m.phoneLine);
  lines.push('', 'See the full picture: ' + m.dashboardUrl, '', 'You get this once a month because you have a Fibonax account.', 'Stop the monthly recap: ' + m.stopUrl, 'Help: ' + m.helpUrl);

  return { subject: m.subject, html, text: lines.join('\n') + '\n' };
}
