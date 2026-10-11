#!/usr/bin/env node
// SANTO DEL GIORNO + CHRISTMAS COUNTDOWN gate.
//
// Both footers (dashboard and popup) show the saint of the day and the days to
// Christmas. The rules are decided once in extension/shared/saint-of-day.js and
// copied for the dashboard in app/src/lib/saintOfDay.ts, so this gate pins what
// the two surfaces share:
//
//   1. the module: keys, label, 24 hour and same-day-in-Rome freshness, the
//      Christmas arithmetic, over the shared case table scripts/saint-cases.json
//   2. where it is stored: chrome.storage.local in the popup, localStorage on
//      the dashboard, never chrome.storage.sync
//   3. the dashboard copy: same constants, same answer for every case
//   4. the footers: the saint sits between the version and the links, the
//      countdown right after it, and the countdown has no switch anywhere
//   5. the server function: one name on both surfaces, a signed-in caller only,
//      no service-role key, one fixed source address
//
// Run: node scripts/check-saint-of-day.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'extension', 'shared', 'saint-of-day.js');
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'saint-cases.json'), 'utf8'));
const FUNCTION_DIR = path.join(ROOT, 'services', 'supabase', 'functions', 'saint-of-the-day');

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error('X ' + name + '\n    expected ' + e + '\n    got      ' + a); failed++; return; }
  console.log('  ok  ' + name);
}

// Windows checkouts can hold CRLF while every committed blob is LF.
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function before(text, first, then) {
  const a = text.indexOf(first), b = text.indexOf(then);
  return a !== -1 && b !== -1 && a < b;
}

// The source of one function: from its declaration to the next declaration at
// the same indent.
function fnSource(text, decl, indent) {
  const start = text.indexOf(decl);
  if (start === -1) return '';
  const next = text.indexOf('\n' + indent + 'function ', start + decl.length);
  return text.slice(start, next === -1 ? undefined : next);
}

const MODULE_SRC = readText(MODULE_PATH);
const S = require(MODULE_PATH);

// ── the cases, run over any surface that offers the same ten answers ───────
function localTime(parts) {
  return new Date(parts[0], parts[1] - 1, parts[2], parts[3]).getTime();
}

function entryOf(row) {
  if (Object.prototype.hasOwnProperty.call(row, 'entryRaw')) return row.entryRaw;
  const e = Object.assign({}, row.entry);
  if (e.fetchedAtIso) { e.fetchedAt = Date.parse(e.fetchedAtIso); delete e.fetchedAtIso; }
  return e;
}

function runCases(prefix, api) {
  check(prefix + ': switch is on until turned off',
    CASES.isOn.map((r) => api.isOn(r[0])), CASES.isOn.map((r) => r[1]));
  check(prefix + ': names are cleaned the same way',
    CASES.cleanName.map((r) => api.cleanName(r[0])), CASES.cleanName.map((r) => r[1]));
  check(prefix + ': the server answer is read the same way',
    CASES.readResponse.map((r) => api.readResponse(r[0])), CASES.readResponse.map((r) => r[1]));
  check(prefix + ': the day in Rome',
    CASES.romeDay.map((r) => api.romeDay(Date.parse(r[0]))), CASES.romeDay.map((r) => r[1]));
  CASES.fresh.forEach((row) => {
    check(prefix + ': ' + row.name, api.isFresh(entryOf(row), Date.parse(row.nowIso)), row.fresh);
  });
  check(prefix + ': the label', CASES.label.map((r) => api.label(r[0])), CASES.label.map((r) => r[1]));
  CASES.christmas.forEach((row) => {
    const days = api.daysToChristmas(localTime(row.local));
    check(prefix + ': days to Christmas from ' + row.local.join('-'), days, row.days);
    check(prefix + ': Christmas label from ' + row.local.join('-'), api.christmasLabel(days), row.label);
  });
  check(prefix + ': Christmas label for odd input',
    CASES.christmasLabelOnly.map((r) => api.christmasLabel(r[0])), CASES.christmasLabelOnly.map((r) => r[1]));
  const reading = { name: 'San Luca', date: '2026-10-11' };
  check(prefix + ': a new cache entry carries the time it was read',
    api.makeEntry(reading, 1234), { name: 'San Luca', date: '2026-10-11', fetchedAt: 1234 });
  check(prefix + ': a damaged entry reads as nothing',
    [null, 'x', {}, { name: 'San Luca' }].map(api.readEntry), [null, null, null, null]);
}

// ── 1. the module ─────────────────────────────────────────────────────────
check('keys', [S.ENABLED_KEY, S.CACHE_KEY], ['sb_saint_of_day_enabled', 'sb_saint_of_day_cache']);
check('function name', S.FUNCTION_NAME, 'saint-of-the-day');
check('label', S.LABEL, 'Santo del Giorno');
check('cache lives for 24 hours', S.TTL_MS, 24 * 60 * 60 * 1000);
runCases('extension', S);

// ── 2. where it is stored ─────────────────────────────────────────────────
function memoryLocalStorage() {
  const data = {};
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

function chromeStorage(area) {
  return {
    get: (keys, cb) => {
      const out = {};
      [].concat(keys).forEach((k) => { if (Object.prototype.hasOwnProperty.call(area, k)) out[k] = area[k]; });
      cb(out);
    },
    set: (obj, cb) => { Object.assign(area, obj); if (cb) cb(); },
    remove: () => {},
  };
}

function runModule(host) {
  const sandbox = Object.assign({ console }, host);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SRC, sandbox);
  return sandbox.SBSaintOfDay;
}

function got(load) {
  let value;
  load((v) => { value = v; });
  return value;
}

{
  const area = {};
  const page = memoryLocalStorage();
  const api = runModule({
    localStorage: page,
    chrome: { runtime: { id: 'extension', lastError: null }, storage: { local: chromeStorage(area) } },
  });
  check('extension: on before anything is stored', got(api.loadEnabled), true);
  api.saveEnabled(false);
  check('extension: off is kept as a boolean in chrome.storage.local', area[S.ENABLED_KEY], false);
  check('extension: reads back off', got(api.loadEnabled), false);
  api.saveEnabled(true);
  check('extension: reads back on', got(api.loadEnabled), true);
  check('extension: no saint stored yet', got(api.loadCache), null);
  const entry = { name: 'San Luca', date: '2026-10-11', fetchedAt: 1760000000000 };
  api.saveCache(entry);
  check('extension: the saint is kept in chrome.storage.local', area[S.CACHE_KEY], entry);
  check('extension: the saint reads back', got(api.loadCache), entry);
  area[S.CACHE_KEY] = { name: '<b>', date: 'x' };
  check('extension: a damaged saint reads as nothing', got(api.loadCache), null);
  check('extension: nothing is written to the page', Object.keys(page.data), []);
}
{
  const api = runModule({});
  check('outside the extension: on, with no saint', [got(api.loadEnabled), got(api.loadCache)], [true, null]);
}

// ── 3. the dashboard copy ─────────────────────────────────────────────────
async function dashboardCopy() {
  const ts = await import(pathToFileURL(path.join(ROOT, 'app', 'src', 'lib', 'saintOfDay.ts')).href);
  check('dashboard: same keys', [ts.SAINT_ENABLED_KEY, ts.SAINT_CACHE_KEY], [S.ENABLED_KEY, S.CACHE_KEY]);
  check('dashboard: same function name', ts.SAINT_FUNCTION, S.FUNCTION_NAME);
  check('dashboard: same label', ts.SAINT_LABEL, S.LABEL);
  check('dashboard: same lifetime', ts.SAINT_TTL_MS, S.TTL_MS);
  check('dashboard: same longest name', ts.SAINT_MAX_NAME, S.MAX_NAME);
  runCases('dashboard', {
    isOn: ts.isSaintOn,
    cleanName: ts.cleanSaintName,
    readResponse: ts.readSaintResponse,
    romeDay: ts.romeDay,
    isFresh: ts.isSaintFresh,
    label: ts.saintLabel,
    daysToChristmas: ts.daysToChristmas,
    christmasLabel: ts.christmasLabel,
    makeEntry: ts.makeSaintEntry,
    readEntry: ts.readSaintEntry,
  });

  const quiet = console.error;
  const page = memoryLocalStorage();
  globalThis.window = { localStorage: page };
  try {
    check('dashboard: on before anything is stored', ts.loadSaintEnabled(), true);
    check('dashboard: saving reports success', ts.saveSaintEnabled(false), true);
    check('dashboard: off is kept as a string under the shared key', page.data[S.ENABLED_KEY], 'false');
    check('dashboard: reads back off', ts.loadSaintEnabled(), false);
    check('dashboard: no saint stored yet', ts.loadSaintCache(), null);
    const entry = { name: 'San Luca', date: '2026-10-11', fetchedAt: 1760000000000 };
    check('dashboard: saving the saint reports success', ts.saveSaintCache(entry), true);
    check('dashboard: the saint reads back', ts.loadSaintCache(), entry);
    page.data[S.CACHE_KEY] = '{not json';
    console.error = () => {};
    check('dashboard: a damaged saint reads as nothing', ts.loadSaintCache(), null);

    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    globalThis.window = { localStorage: blocked };
    check('dashboard: a blocked store still shows the saint (on)', ts.loadSaintEnabled(), true);
    check('dashboard: a blocked store has no saint', ts.loadSaintCache(), null);
    check('dashboard: a blocked store reports the failed save', ts.saveSaintEnabled(false), false);
  } finally {
    console.error = quiet;
    delete globalThis.window;
  }
}

// ── 4. the footers ────────────────────────────────────────────────────────
const POPUP_HTML = readText(path.join(ROOT, 'extension', 'popup', 'popup.html'));
const POPUP_JS = readText(path.join(ROOT, 'extension', 'popup', 'popup.js'));
check('popup.html loads the module before popup.js',
  before(POPUP_HTML, '<script src="../shared/saint-of-day.js"></script>', '<script src="popup.js"></script>'), true);
check('popup footer order: version, saint, Christmas, Open Dashboard',
  before(POPUP_HTML, 'id="ver-btn"', 'id="saint"') &&
  before(POPUP_HTML, 'id="saint"', 'id="xmas"') &&
  before(POPUP_HTML, 'id="xmas"', 'id="bdash"'), true);
check('popup: a divider sits between the saint and the Christmas line, hidden with the saint',
  before(POPUP_HTML, 'id="saint"', 'id="saint-sep"') && before(POPUP_HTML, 'id="saint-sep"', 'id="xmas"') &&
  /id="saint-sep"[^>]*\shidden/.test(POPUP_HTML) &&
  fnSource(POPUP_JS, 'function renderSaint(', '').indexOf("gi('saint-sep')") !== -1, true);
check('popup: the saint starts hidden and the Christmas line does not',
  /id="saint"[^>]*\shidden/.test(POPUP_HTML) && !/id="xmas"[^>]*\shidden/.test(POPUP_HTML), true);
check('popup: the saint is marked as Italian text', /id="saint"[^>]*lang="it"/.test(POPUP_HTML), true);
check('popup: the Christmas line has no switch', /id="[^"]*xmas[^"]*"[^>]*type="checkbox"|type="checkbox"[^>]*id="[^"]*xmas/.test(POPUP_HTML), false);
check('popup: the saint has its switch in Settings', POPUP_HTML.indexOf('id="tcfg-saint"') !== -1, true);
const renderXmas = fnSource(POPUP_JS, 'function renderXmas(', '');
check('popup: the Christmas line is drawn from the module', renderXmas.indexOf('SBSaintOfDay.christmasLabel(') !== -1, true);
check('popup: the Christmas line never looks at the switch', /saintOn|loadEnabled|\.hidden/.test(renderXmas), false);
check('popup: the saint is read by the shared function name',
  POPUP_JS.indexOf("'/functions/v1/' + SBSaintOfDay.FUNCTION_NAME") !== -1, true);
check('popup: the saint is drawn through the module label',
  fnSource(POPUP_JS, 'function renderSaint(', '').indexOf('SBSaintOfDay.label(') !== -1, true);
check('popup: stored with chrome.storage.local only', /chrome\.storage\.sync\.set\([^)]*(sb_saint|SBSaintOfDay)/.test(POPUP_JS), false);

const LAYOUT = readText(path.join(ROOT, 'app', 'src', 'routes', 'DashboardLayout.tsx'));
check('dashboard footer order: version, saint, Christmas, Support',
  before(LAYOUT, '{APP_VERSION}', '<SaintOfDay') &&
  before(LAYOUT, '<SaintOfDay', '<ChristmasCountdown') &&
  before(LAYOUT, '<ChristmasCountdown', 'Support'), true);
const SAINT_VIEW = readText(path.join(ROOT, 'app', 'src', 'components', 'layout', 'SaintOfDay.tsx'));
const XMAS_VIEW = readText(path.join(ROOT, 'app', 'src', 'components', 'layout', 'ChristmasCountdown.tsx'));
check('dashboard: the saint follows the switch', /useUiStore\(\(s\) => s\.saintOfDayEnabled\)/.test(SAINT_VIEW), true);
check('dashboard: the saint is marked as Italian text', /lang="it"/.test(SAINT_VIEW), true);
check('dashboard: the divider follows the saint and only exists with it',
  before(SAINT_VIEW, 'if (!name) return null', 'saintLabel(name)') && before(SAINT_VIEW, 'saintLabel(name)', 'w-px'), true);
check('dashboard: the Christmas line never looks at a switch', /saintOfDayEnabled|useUiStore|enabled/i.test(XMAS_VIEW), false);
check('dashboard: the Christmas line is drawn from the shared copy', XMAS_VIEW.indexOf('christmasLabel(') !== -1, true);
const API = readText(path.join(ROOT, 'app', 'src', 'lib', 'api', 'saintApi.ts'));
check('dashboard: the saint is read by the shared function name', API.indexOf('SAINT_FUNCTION') !== -1, true);
const PANEL = readText(path.join(ROOT, 'app', 'src', 'features', 'settings', 'SaintOfDayPanel.tsx'));
check('dashboard: Settings carries the saint switch and no Christmas switch',
  PANEL.indexOf('saintOfDayEnabled') !== -1 && !/christmas/i.test(PANEL), true);

// ── 5. the server function ────────────────────────────────────────────────
const FN = readText(path.join(FUNCTION_DIR, 'index.ts'));
check('the function folder carries the shared name', path.basename(FUNCTION_DIR), S.FUNCTION_NAME);
check('function: only a signed-in caller', FN.indexOf('auth.getUser()') !== -1 && FN.indexOf("'unauthorized'") !== -1, true);
check('function: no service-role key', /SERVICE_ROLE/i.test(FN), false);
check('function: one fixed source address',
  FN.indexOf("const SOURCE_URL = 'https://www.vaticannews.va/it/santo-del-giorno.html';") !== -1, true);
check('function: answers with the keys both surfaces read', /ok: true, date: .*name/.test(FN), true);

dashboardCopy().then(() => {
  if (failed) {
    console.error('\nX Santo del Giorno gate: ' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('OK Santo del Giorno gate');
}).catch((e) => {
  console.error('X Santo del Giorno gate crashed: ' + (e && e.stack || e));
  process.exit(1);
});
