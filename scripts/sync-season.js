#!/usr/bin/env node
// Keeps the inlined copy of the seasonal line's rules identical to the
// canonical file. Same shape as scripts/sync-memory-pack.js: run without
// arguments to write the copy, or with --check to assert it matches (a gate).
//
//   app/public/mobile/index.html   single-file app by design, cannot load
//                                  extension/shared/season.js at runtime
//
// The module decides which occasion is in season and what {seasonal} prints.
// A surface that does not hand it the person's occasions prints the ready
// ones only, and one that does not load it prints nothing at all, so --check
// also fails when:
//
//   the phone, the page script or the popup stops handing over the occasions
//   the extension stops loading the module ahead of the scripts that use it
//   the phone's own resolver loses its seasonal line
//   extension/auth/auth.js names the two storage keys differently

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension', 'shared', 'season.js');
const MOBILE = path.join(ROOT, 'app', 'public', 'mobile', 'index.html');
const MANIFEST = path.join(ROOT, 'extension', 'manifest.json');
const POPUP_HTML = path.join(ROOT, 'extension', 'popup', 'popup.html');
const POPUP_JS = path.join(ROOT, 'extension', 'popup', 'popup.js');
const CONTENT_JS = path.join(ROOT, 'extension', 'content', 'content.js');
const AUTH_JS = path.join(ROOT, 'extension', 'auth', 'auth.js');
const BEGIN = '<!-- SB_SEASON:BEGIN (generated from extension/shared/season.js by scripts/sync-season.js, do not edit) -->';
const END = '<!-- SB_SEASON:END -->';
// Anchor on another block's END marker, never on the first <script> in the
// file: that one sits inside the snippet-stats block.
const ANCHOR = '<!-- SB_MEMORY_PACK:END -->';

function block(source) {
  return BEGIN + '\n<script>\n' + source.trimEnd() + '\n</script>\n' + END;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

// Windows checkouts (core.autocrlf=true) can hold these files with CRLF while
// the committed blobs are LF. Read as LF so a fresh checkout does not read as
// drift; every write stays LF.
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

// What the gate pins beyond the copy itself. Each entry: the file, what must
// be found in it, and what that keeps true.
function wiring() {
  const season = require(SOURCE);
  const problems = [];
  const need = (file, text, what) => {
    if (readText(file).indexOf(text) === -1) problems.push(rel(file) + ': ' + what + ' (expected ' + text + ')');
  };

  const mobile = readText(MOBILE);
  const start = mobile.indexOf(BEGIN);
  if (start !== -1) {
    // A block opened inside another script leaves the app's code outside any
    // tag, and the phone prints that code as text.
    const before = mobile.slice(0, start);
    const open = (before.match(/<script\b/g) || []).length - (before.match(/<\/script>/g) || []).length;
    if (open !== 0) problems.push(rel(MOBILE) + ': the block opens inside another <script>');
  }
  need(MOBILE, 'SBSeason.set(', 'the phone hands the person\'s occasions to the module');
  need(MOBILE, 'function sbSeasonalText(', 'the phone\'s own resolver prints the seasonal line');
  need(MOBILE, 'SBFillFormUI.seasonNote(', 'the phone draws the row that leaves the line out');
  need(CONTENT_JS, '_SBSeason.set(data', 'the page script hands the person\'s occasions to the module');
  need(CONTENT_JS, 'SBFillFormUI.seasonNote(', 'the fill window draws the row that leaves the line out');
  need(POPUP_JS, 'SBSeason.set(', 'the popup hands the person\'s occasions to the module');
  need(POPUP_JS, 'SBFillFormUI.seasonNote(', 'the popup draws the row that leaves the line out');

  const scripts = (JSON.parse(readText(MANIFEST)).content_scripts[0] || {}).js || [];
  const at = scripts.indexOf('shared/season.js');
  if (at === -1 || at > scripts.indexOf('content/content.js')) {
    problems.push(rel(MANIFEST) + ': shared/season.js must load before content/content.js');
  }
  const popup = readText(POPUP_HTML);
  const mod = popup.indexOf('<script src="../shared/season.js"></script>');
  if (mod === -1 || mod > popup.indexOf('<script src="popup.js"></script>')) {
    problems.push(rel(POPUP_HTML) + ': must load ../shared/season.js before popup.js');
  }

  need(AUTH_JS, "var SB_OCCASIONS_META_KEY = '" + season.META_KEY + "';", 'the account key is season.js\'s META_KEY');
  need(AUTH_JS, "var SB_OCCASIONS_STORAGE_KEY = '" + season.STORAGE_KEY + "';", 'the device key is season.js\'s STORAGE_KEY');
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const result = apply(readText(SOURCE), check);
  let failed = false;

  if (result === 'ok') {
    console.log('OK   ' + rel(MOBILE) + ' season in sync');
  } else if (result === 'written') {
    console.log('SYNC ' + rel(MOBILE) + ' season updated');
  } else {
    failed = true;
    const why = result === 'missing' ? 'has no season block' : 'season has drifted';
    console.error('X    ' + rel(MOBILE) + ' ' + why + ' -> run: node scripts/sync-season.js');
  }

  const problems = wiring();
  problems.forEach((problem) => {
    failed = true;
    console.error('X    ' + problem);
  });
  if (!problems.length) console.log('OK   every surface loads the seasonal line and hands it the occasions');

  if (failed) process.exit(1);
}

main();
