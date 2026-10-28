#!/usr/bin/env node
// The pricing page keeps every number in one place: the PRICING object in
// scripts/templates/pricing.html. The markup repeats those numbers in
// [data-pricing] slots so the page reads without JavaScript, and this gate
// fails CI when a slot, or the <time> deadline, no longer matches the object.
//
// Run from the repository root: node scripts/check-pricing-config.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'templates', 'pricing.html');
const html = fs.readFileSync(FILE, 'utf8');

const objectMatch = html.match(/var PRICING = (\{[\s\S]*?\n\});/);
if (!objectMatch) {
  console.error('X scripts/templates/pricing.html: PRICING object not found');
  process.exit(1);
}
const pricing = new Function(`return ${objectMatch[1]}`)();

// How each key is written in the markup.
const FORMAT = {
  freeSnippetsPerDay: (v) => String(v),
  freePromptsPerDay: (v) => String(v),
  freeBrainsPerDay: (v) => String(v),
  euroPerFiboToken: (v) => `€${v.toFixed(2)}`,
  topUpEuros: (v) => `€${v}`,
  fiboTokensPerTopUp: (v) => v.toLocaleString('en-US'),
  fiboTokensPerSnippet: (v) => String(v),
  fiboTokensPerPrompt: (v) => String(v),
  fiboTokensPerBrain: (v) => String(v),
  monthlyBonusPercent: (v) => `${v}%`,
  fiboTokensPerMonthlyTopUp: (v) => v.toLocaleString('en-US'),
  foundingDiscountPercent: (v) => `${v}%`,
  foundingTopUpEuros: (v) => `€${v}`,
};

const problems = [];
let slots = 0;
for (const match of html.matchAll(/data-pricing="([^"]+)"[^>]*>([^<]*)</g)) {
  const [, key, text] = match;
  slots += 1;
  if (!FORMAT[key]) {
    problems.push(`slot data-pricing="${key}" has no entry in PRICING`);
    continue;
  }
  const expected = FORMAT[key](pricing[key]);
  if (text !== expected) problems.push(`slot data-pricing="${key}" shows "${text}", PRICING says "${expected}"`);
}
for (const key of Object.keys(FORMAT)) {
  if (!html.includes(`data-pricing="${key}"`)) problems.push(`PRICING.${key} is never shown in the markup`);
}

const times = Array.from(html.matchAll(/<time datetime="([^"]+)">/g)).map((m) => m[1]);
if (times.length === 0) problems.push('no <time datetime> for the deadline');
for (const value of times) {
  if (value !== pricing.deadline) problems.push(`<time datetime="${value}"> differs from PRICING.deadline "${pricing.deadline}"`);
}
// The derived numbers must follow from the ones they come from, so a change
// to the top-up, the rate, the bonus or the discount cannot leave one behind.
const near = (a, b) => Math.abs(a - b) < 1e-9;
if (!near(pricing.fiboTokensPerTopUp * pricing.euroPerFiboToken, pricing.topUpEuros)) {
  problems.push('fiboTokensPerTopUp × euroPerFiboToken must equal topUpEuros');
}
if (pricing.fiboTokensPerMonthlyTopUp !== Math.round(pricing.fiboTokensPerTopUp * (1 + pricing.monthlyBonusPercent / 100))) {
  problems.push('fiboTokensPerMonthlyTopUp must be fiboTokensPerTopUp plus monthlyBonusPercent');
}
if (!near(pricing.foundingTopUpEuros, pricing.topUpEuros * (1 - pricing.foundingDiscountPercent / 100))) {
  problems.push('foundingTopUpEuros must be topUpEuros less foundingDiscountPercent');
}
if (Date.parse(pricing.closesFrom) - Date.parse(pricing.deadline) !== 1000) {
  problems.push('PRICING.closesFrom must be one second after PRICING.deadline');
}

if (problems.length) {
  for (const p of problems) console.error(`X ${p}`);
  process.exit(1);
}
console.log(`OK pricing page: ${slots} slots and the deadline match PRICING`);
