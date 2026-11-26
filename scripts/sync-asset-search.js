#!/usr/bin/env node
// Keeps the inlined copy of the shared search rule identical to the canonical
// file. Same shape as scripts/sync-memory-chunk.js: run without arguments to
// write the copy, or with --check to assert it matches (a gate).
//
//   app/public/mobile/index.html   single-file app by design, cannot load
//                                  extension/shared/asset-search.js at runtime
//
// The phone's search window (scripts/sync-command-palette.js inlines it right
// after this block) reads from the module what the popup, the dashboard and the
// menus on a page read, so a snippet, a prompt or a Brain item is found by the
// same words on every device:
//
//   look      whether every typed word is somewhere in the asset, and why
//   whyHtml   the line under a result that says why: keyword, label or text
//
// --check also fails if the phone's own code starts matching by itself again:
// the search window is the one place that asks the module.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension', 'shared', 'asset-search.js');
const MOBILE = path.join(ROOT, 'app', 'public', 'mobile', 'index.html');
const BEGIN = '<!-- SB_ASSET_SEARCH:BEGIN (generated from extension/shared/asset-search.js by scripts/sync-asset-search.js, do not edit) -->';
const END = '<!-- SB_ASSET_SEARCH:END -->';
// Anchor on another block's END marker, never on the first <script> in the
// file: that one sits inside the snippet-stats block.
const ANCHOR = '<!-- SB_MEMORY_CHUNK:END -->';

function block(source) {
  return BEGIN + '\n<script>\n' + source.trimEnd() + '\n</script>\n' + END;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

// Windows checkouts (core.autocrlf=true) can materialize these files with CRLF
// even though the committed blob and every string built here are LF. Normalize
// on read so a fresh `git checkout` doesn't read as spurious drift; every write
// stays pure LF regardless of local line-ending state.
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function apply(source, check) {
  let html = readText(MOBILE);
  const desired = block(source);
  const start = html.indexOf(BEGIN);
  const stop = html.indexOf(END);

  if (start !== -1 && stop !== -1) {
    if (html.slice(start, stop + END.length) === desired) return 'ok';
    if (check) return 'drift';
    html = html.slice(0, start) + desired + html.slice(stop + END.length);
  } else {
    if (check) return 'missing';
    const anchor = html.indexOf(ANCHOR);
    if (anchor === -1) throw new Error(rel(MOBILE) + ' has no ' + ANCHOR + ' to place the block after');
    const at = anchor + ANCHOR.length;
    html = html.slice(0, at) + '\n' + desired + html.slice(at);
  }

  fs.writeFileSync(MOBILE, html);
  return 'written';
}

// The page without one generated block, so what is left is the phone's own code.
function without(html, begin, end) {
  const a = html.indexOf(begin);
  const b = html.indexOf(end);
  return a === -1 || b === -1 ? html : html.slice(0, a) + html.slice(b + end.length);
}

// What the gate pins beyond the copy itself: where the block sits, and that
// the phone's own code leaves the matching to the search window.
function structure() {
  const html = readText(MOBILE);
  const problems = [];
  const start = html.indexOf(BEGIN);
  if (start === -1) return problems;

  // A block opened inside another script leaves the app's code outside any tag,
  // and the phone prints that code as text.
  const before = html.slice(0, start);
  const open = (before.match(/<script\b/g) || []).length - (before.match(/<\/script>/g) || []).length;
  if (open !== 0) problems.push('the block opens inside another <script>');

  // The search window is the only reader. A second matcher in the phone's own
  // code is how the lists and the window would start to disagree.
  const own = without(
    without(html, BEGIN, END),
    '<!-- SB_COMMAND_PALETTE:BEGIN',
    '<!-- SB_COMMAND_PALETTE:END -->',
  );
  if (own.indexOf('SBAssetSearch.') !== -1) {
    problems.push('Search: the phone matches through the search window only (its own code must not call SBAssetSearch)');
  }
  if (html.indexOf('<!-- SB_COMMAND_PALETTE:BEGIN') === -1) {
    problems.push('Search: the search window that reads this block is missing -> run: node scripts/sync-command-palette.js');
  }
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const result = apply(readText(SOURCE), check);
  let failed = false;

  if (result === 'ok') {
    console.log('OK   ' + rel(MOBILE) + ' asset-search in sync');
  } else if (result === 'written') {
    console.log('SYNC ' + rel(MOBILE) + ' asset-search updated');
  } else {
    failed = true;
    const why = result === 'missing' ? 'has no asset-search block' : 'asset-search has drifted';
    console.error('X    ' + rel(MOBILE) + ' ' + why + ' -> run: node scripts/sync-asset-search.js');
  }

  structure().forEach((problem) => {
    failed = true;
    console.error('X    ' + rel(MOBILE) + ' ' + problem);
  });

  if (failed) process.exit(1);
}

main();
