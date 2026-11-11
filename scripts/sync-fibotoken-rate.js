#!/usr/bin/env node
// The FiboToken exchange rate lives in one file:
//
//   app/src/config/fiboTokenRate.json
//
// The dashboard imports it. Three other places cannot, so each carries a copy
// that this script writes:
//
//   app/public/mobile/index.html     a generated FIBOTOKEN_RATE block
//   app/public/landing/index.html    [data-rate] slots in the pill and its window
//   scripts/templates/pricing.html   the PRICING object and its [data-pricing] slots
//
// plus the Italian and Spanish spellings of those numbers and dates in
// app/public/landing/locales/*.json, so a new rate never leaves a stale
// translation behind.
//
// To change the rate (about every three months): edit the JSON file, then run
//
//   node scripts/sync-fibotoken-rate.js
//
// It rewrites every copy and rebuilds the translated landing pages. With
// --check it changes nothing and fails when a copy disagrees (the CI gate).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'app', 'src', 'config', 'fiboTokenRate.json');
const MOBILE = path.join(ROOT, 'app', 'public', 'mobile', 'index.html');
const LANDING = path.join(ROOT, 'app', 'public', 'landing', 'index.html');
const PRICING = path.join(ROOT, 'scripts', 'templates', 'pricing.html');
const LOCALES = path.join(ROOT, 'app', 'public', 'landing', 'locales');
const DASHBOARD_TEXT = path.join(ROOT, 'app', 'src', 'lib', 'fiboTokenRate.ts');

const BEGIN = '<!-- FIBOTOKEN_RATE:BEGIN (generated from app/src/config/fiboTokenRate.json by scripts/sync-fibotoken-rate.js, do not edit) -->';
const END = '<!-- FIBOTOKEN_RATE:END -->';

const LOCALE_TAGS = { en: 'en-US', it: 'it-IT', es: 'es-ES' };

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

// Windows checkouts can hold these files with CRLF while every string built
// here is LF. Normalize on read; every write is pure LF.
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function tag(lang) {
  if (!LOCALE_TAGS[lang]) throw new Error(`[${lang}] add its locale tag to LOCALE_TAGS`);
  return LOCALE_TAGS[lang];
}

// "€0.01": two decimals at least, four at most, so a rate such as 0.0125 is
// never rounded on screen.
function formatRate(value, lang = 'en') {
  return '€' + value.toLocaleString(tag(lang), { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatEuros(value, lang = 'en') {
  return '€' + value.toLocaleString(tag(lang));
}

// Italian groups every thousand ("2.500"); Spanish leaves four digits alone
// ("2500", then "11.000"), as the translated pricing page already wrote them.
function formatCount(value, lang = 'en') {
  return value.toLocaleString(tag(lang), { useGrouping: lang === 'it' ? 'always' : 'auto' });
}

function formatDate(iso, lang = 'en') {
  const options = lang === 'en'
    ? { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
    : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(tag(lang), options);
}

function wholeTokens(euros, rate, what) {
  const tokens = Math.round(euros / rate);
  if (Math.abs(tokens * rate - euros) > 1e-9) throw new Error(`${what}: €${euros} is not a whole number of FiboTokens at ${rate}`);
  return tokens;
}

function loadRate() {
  const rate = JSON.parse(readText(SOURCE));
  const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (!(typeof rate.euroPerFiboToken === 'number' && rate.euroPerFiboToken > 0)) throw new Error('euroPerFiboToken must be a number above 0');
  if (!(Number.isInteger(rate.exampleEuros) && rate.exampleEuros > 0)) throw new Error('exampleEuros must be a whole number above 0');
  if (!isDay(rate.rateSetOn)) throw new Error('rateSetOn must be a day written YYYY-MM-DD');
  if (!isDay(rate.packsFrom)) throw new Error('packsFrom must be a day written YYYY-MM-DD');
  wholeTokens(rate.exampleEuros, rate.euroPerFiboToken, 'exampleEuros');
  return rate;
}

// ── Phone ────────────────────────────────────────────────────────────────
function syncMobile(rate, check, report) {
  const html = readText(MOBILE);
  const desired = `${BEGIN}\n<script>\nvar FIBOTOKEN_RATE = ${JSON.stringify(rate)};\n</script>\n${END}`;
  const start = html.indexOf(BEGIN);
  const stop = html.indexOf(END);
  if (start === -1 || stop === -1) return report(MOBILE, 'has no FIBOTOKEN_RATE block');
  if (html.slice(start, stop + END.length) === desired) return report(MOBILE);
  if (check) return report(MOBILE, 'FIBOTOKEN_RATE block has drifted');
  fs.writeFileSync(MOBILE, html.slice(0, start) + desired + html.slice(stop + END.length));
  report(MOBILE, null, true);
}

// ── Landing homepage ─────────────────────────────────────────────────────
// What each [data-rate] slot shows, per language.
function landingSlots(rate, lang) {
  return {
    rate: formatRate(rate.euroPerFiboToken, lang),
    exampleEuros: formatEuros(rate.exampleEuros, lang),
    exampleTokens: formatCount(wholeTokens(rate.exampleEuros, rate.euroPerFiboToken, 'exampleEuros'), lang),
    setOn: formatDate(rate.rateSetOn, lang),
    packsFrom: formatDate(rate.packsFrom, lang),
  };
}

const LANDING_SLOT = /data-rate="([A-Za-z]+)"( data-iso="[^"]*")?>([^<]*)</g;

function landingSlotHtml(key, text, rate) {
  const iso = key === 'packsFrom' ? ` data-iso="${rate.packsFrom}"` : '';
  return `data-rate="${key}"${iso}>${text}<`;
}

function syncLanding(rate, check, report) {
  const html = readText(LANDING);
  const english = landingSlots(rate, 'en');
  const seen = new Set();
  const next = html.replace(LANDING_SLOT, (match, key) => {
    if (!(key in english)) throw new Error(`${rel(LANDING)}: unknown slot data-rate="${key}"`);
    seen.add(key);
    return landingSlotHtml(key, english[key], rate);
  });
  for (const key of Object.keys(english)) {
    if (!seen.has(key)) return report(LANDING, `shows no data-rate="${key}" slot`);
  }
  if (next === html) return report(LANDING);
  if (check) return report(LANDING, 'rate slots have drifted');
  fs.writeFileSync(LANDING, next);
  report(LANDING, null, true);
}

// The locale entries for the homepage slots, one per slot whose spelling
// differs from English. This script owns them: they sit together at the end
// of `entries`.
function landingLocaleEntries(rate, lang, html) {
  const english = landingSlots(rate, 'en');
  const local = landingSlots(rate, lang);
  const entries = [];
  for (const key of Object.keys(english)) {
    if (english[key] === local[key]) continue;
    const find = landingSlotHtml(key, english[key], rate);
    entries.push({ find, replace: landingSlotHtml(key, local[key], rate), count: html.split(find).length - 1 });
  }
  return entries;
}

// ── Pricing page ─────────────────────────────────────────────────────────
// The PRICING keys that follow from the rate, and how each is written.
function pricingValues(rate, pricing) {
  const tokens = (euros, bonus) => Math.round(wholeTokens(pricing[euros], rate.euroPerFiboToken, euros) * (1 + (bonus ? pricing[bonus] : 0) / 100));
  return {
    euroPerFiboToken: rate.euroPerFiboToken,
    fiboTokensPerTopUp: tokens('topUpEuros'),
    pack50Tokens: tokens('pack50Euros', 'pack50BonusPercent'),
    pack100Tokens: tokens('pack100Euros', 'pack100BonusPercent'),
    rateSetOn: rate.rateSetOn,
  };
}

const PRICING_TEXT = {
  euroPerFiboToken: formatRate,
  fiboTokensPerTopUp: formatCount,
  pack50Tokens: formatCount,
  pack100Tokens: formatCount,
  rateSetOn: formatDate,
};

function readPricingObject(html) {
  const match = html.match(/var PRICING = (\{[\s\S]*?\n\});/);
  if (!match) throw new Error(`${rel(PRICING)}: PRICING object not found`);
  return new Function(`return ${match[1]}`)();
}

// Returns the new template and, per key, the English text it showed before
// and shows now: what the locale entries are found by and moved to.
function pricingPlan(rate, html) {
  const pricing = readPricingObject(html);
  if (pricing.topUpEuros !== rate.exampleEuros) {
    throw new Error(`exampleEuros (${rate.exampleEuros}) must be the first pack, PRICING.topUpEuros (${pricing.topUpEuros})`);
  }
  const values = pricingValues(rate, pricing);
  let next = html;
  const moves = [];
  for (const key of Object.keys(values)) {
    const literal = typeof values[key] === 'string' ? `'${values[key]}'` : String(values[key]);
    const line = new RegExp(`(\\n  ${key}: )[^,\\n]+(,?\\n)`);
    if (!line.test(next)) throw new Error(`${rel(PRICING)}: PRICING.${key} not found`);
    next = next.replace(line, `$1${literal}$2`);
    const was = PRICING_TEXT[key](pricing[key], 'en');
    const now = PRICING_TEXT[key](values[key], 'en');
    const slot = new RegExp(`(data-pricing="${key}"[^>]*>)[^<]*<`, 'g');
    next = next.replace(slot, `$1${now}<`);
    moves.push({ key, was, now, value: values[key] });
  }
  return { next, moves };
}

// ── Locale files ─────────────────────────────────────────────────────────
function listLocales() {
  return fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json')).map((f) => path.basename(f, '.json')).sort();
}

function syncLocale(lang, rate, landingHtml, moves, check, report) {
  const file = path.join(LOCALES, `${lang}.json`);
  const before = readText(file);
  const locale = JSON.parse(before);

  const own = landingLocaleEntries(rate, lang, landingHtml);
  locale.entries = locale.entries.filter((entry) => !entry.find.startsWith('data-rate="')).concat(own);

  for (const move of moves) {
    const local = PRICING_TEXT[move.key](move.value, lang);
    const entry = locale.pricingEntries.find((e) => e.find === `>${move.was}<` || e.find === `>${move.now}<`);
    if (!entry) {
      if (local === move.now) continue;
      return report(file, `has no pricing entry for ">${move.now}<" (PRICING.${move.key})`);
    }
    entry.find = `>${move.now}<`;
    entry.replace = `>${local}<`;
  }

  const after = JSON.stringify(locale, null, 2) + '\n';
  if (after === before) return report(file);
  if (check) return report(file, 'rate entries have drifted');
  fs.writeFileSync(file, after);
  report(file, null, true);
}

// ── Wording ──────────────────────────────────────────────────────────────
// The disclaimer is written on four surfaces. The dashboard's copy is the
// reference; the others must carry the same sentence.
function checkDisclaimer(report) {
  const match = readText(DASHBOARD_TEXT).match(/disclaimer:\s*'([^']+)'/);
  if (!match) return report(DASHBOARD_TEXT, 'disclaimer text not found');
  for (const file of [MOBILE, LANDING, PRICING]) {
    if (!readText(file).includes(match[1])) report(file, 'does not carry the disclaimer as the dashboard words it');
  }
}

function main() {
  const check = process.argv.includes('--check');
  let failed = false;
  let wrote = false;
  const report = (file, problem, written) => {
    if (problem) {
      failed = true;
      console.error(`X    ${rel(file)} ${problem} -> run: node scripts/sync-fibotoken-rate.js`);
    } else if (written) {
      wrote = true;
      console.log(`SYNC ${rel(file)} rate updated`);
    } else {
      console.log(`OK   ${rel(file)} rate in sync`);
    }
  };

  const rate = loadRate();
  syncMobile(rate, check, report);
  syncLanding(rate, check, report);

  const template = readText(PRICING);
  const { next, moves } = pricingPlan(rate, template);
  if (next === template) report(PRICING);
  else if (check) report(PRICING, 'PRICING or its slots have drifted');
  else {
    fs.writeFileSync(PRICING, next);
    report(PRICING, null, true);
  }

  const landingHtml = readText(LANDING);
  for (const lang of listLocales()) syncLocale(lang, rate, landingHtml, moves, check, report);
  checkDisclaimer(report);

  if (failed) process.exit(1);
  if (wrote && !check) {
    execFileSync(process.execPath, [path.join(__dirname, 'build-landing-i18n.js')], { stdio: 'inherit' });
  }
}

module.exports = { formatRate };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('X    ' + err.message);
    process.exit(1);
  }
}
