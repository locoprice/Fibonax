#!/usr/bin/env node
// Keeps the phone's inlined copy of the shared usage analytics identical to
// extension/shared/usage-analytics.js, the file the dashboard's Analytics page
// loads. The mobile companion is a single file and cannot load extension/, so
// it carries the module between markers; this writes that copy, and with
// --check asserts it matches (a CI gate, the same shape as
// scripts/sync-snippet-stats.js).
//
// It also pins that the phone's Analytics page reads its figures THROUGH the
// module (SBUsageAnalytics.compute and .team), so the two pages cannot drift
// back to counting on their own.
//
// The block goes in just BEFORE the interactive-steps block, never at the first
// <script>: that sits inside the snippet-stats block, and a block placed there
// would be swallowed by the next snippet-stats sync. Not after it either:
// scripts/check-interactive-steps.js pins the app's own <script> right after
// that block's END marker.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension', 'shared', 'usage-analytics.js');
const TARGET = path.join(ROOT, 'app', 'public', 'mobile', 'index.html');
const BEGIN = '<!-- SB_USAGE_ANALYTICS:BEGIN (generated from extension/shared/usage-analytics.js by scripts/sync-usage-analytics.js, do not edit) -->';
const END = '<!-- SB_USAGE_ANALYTICS:END -->';
const ANCHOR = '<!-- SB_INTERACTIVE_STEPS:BEGIN';
const MUST_USE = ['SBUsageAnalytics.compute(', 'SBUsageAnalytics.team(', 'SBUsageAnalytics.loadFrom('];

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

// Normalise CRLF on read (a Windows checkout); every write stays pure LF.
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function block(source) {
  return BEGIN + '\n<script>\n' + source.trimEnd() + '\n</script>\n' + END;
}

function main() {
  const check = process.argv.includes('--check');
  const desired = block(readText(SOURCE));
  let html = readText(TARGET);
  const start = html.indexOf(BEGIN);
  const stop = html.indexOf(END);
  let failed = false;

  if (start !== -1 && stop !== -1) {
    if (html.slice(start, stop + END.length) === desired) {
      console.log('OK   ' + rel(TARGET) + ' usage-analytics in sync');
    } else if (check) {
      console.error('X    ' + rel(TARGET) + ' usage-analytics has drifted -> run: node scripts/sync-usage-analytics.js');
      failed = true;
    } else {
      html = html.slice(0, start) + desired + html.slice(stop + END.length);
      fs.writeFileSync(TARGET, html);
      console.log('SYNC ' + rel(TARGET) + ' usage-analytics updated');
    }
  } else if (check) {
    console.error('X    ' + rel(TARGET) + ' has no usage-analytics block -> run: node scripts/sync-usage-analytics.js');
    failed = true;
  } else {
    const at = html.indexOf(ANCHOR);
    if (at === -1) throw new Error('no ' + ANCHOR + ' in ' + rel(TARGET));
    html = html.slice(0, at) + desired + '\n' + html.slice(at);
    fs.writeFileSync(TARGET, html);
    console.log('SYNC ' + rel(TARGET) + ' usage-analytics written');
  }

  const page = readText(TARGET);
  const outside = page.slice(0, page.indexOf(BEGIN)) + page.slice(page.indexOf(END) + END.length);
  for (const call of MUST_USE) {
    if (!outside.includes(call)) {
      console.error('X    ' + rel(TARGET) + ' Analytics no longer calls ' + call + ' (it must read its figures through the shared module)');
      failed = true;
    }
  }

  if (failed) process.exit(1);
}

main();
