#!/usr/bin/env node
// Keeps the phone's inlined copy of the search window identical to the
// canonical files. Same shape as scripts/sync-asset-search.js: run without
// arguments to write the copy, or with --check to assert it matches (a gate).
//
//   app/public/mobile/index.html   single-file app by design, cannot load
//                                  extension/shared/* at runtime
//
// The search window ("Search or ask") is one component on every surface:
//
//   extension/shared/recents.js           what was opened lately
//   extension/shared/command-palette.js   the window itself
//   extension/shared/command-palette.css  its look
//
// The popup loads the three files, the dashboard loads them at runtime
// (app/src/lib/commandPalette.ts), and the phone carries this copy. They rest
// on extension/shared/asset-search.js, which scripts/sync-asset-search.js
// inlines just above.
//
// --check also fails when a surface stops opening the window through the
// shared files: a search bar that takes the typing itself again, a window
// built some other way, or a file left out of a page.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED = path.join(ROOT, 'extension', 'shared');
const RECENTS = path.join(SHARED, 'recents.js');
const SCRIPT = path.join(SHARED, 'command-palette.js');
const STYLES = path.join(SHARED, 'command-palette.css');
const MOBILE = path.join(ROOT, 'app', 'public', 'mobile', 'index.html');
const POPUP = path.join(ROOT, 'extension', 'popup', 'popup.html');
const POPUP_JS = path.join(ROOT, 'extension', 'popup', 'popup.js');
const DASHBOARD = path.join(ROOT, 'app', 'src', 'lib', 'commandPalette.ts');
const BEGIN = '<!-- SB_COMMAND_PALETTE:BEGIN (generated from extension/shared/recents.js, command-palette.js and command-palette.css by scripts/sync-command-palette.js, do not edit) -->';
const END = '<!-- SB_COMMAND_PALETTE:END -->';
// After the search rule the window reads, never on the first <script> in the
// file: that one sits inside another generated block.
const ANCHOR = '<!-- SB_ASSET_SEARCH:END -->';

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

function block() {
  const styles = readText(STYLES).trimEnd();
  const recents = readText(RECENTS).trimEnd();
  const script = readText(SCRIPT).trimEnd();
  // A closing tag inside a source would end its element early and print the
  // rest of the file on the page.
  if (/<\/style/i.test(styles)) throw new Error(rel(STYLES) + ' holds a closing style tag');
  if (/<\/script/i.test(recents)) throw new Error(rel(RECENTS) + ' holds a closing script tag');
  if (/<\/script/i.test(script)) throw new Error(rel(SCRIPT) + ' holds a closing script tag');
  return BEGIN +
    '\n<style>\n' + styles + '\n</style>' +
    '\n<script>\n' + recents + '\n</script>' +
    '\n<script>\n' + script + '\n</script>\n' + END;
}

function apply(check) {
  let html = readText(MOBILE);
  const desired = block();
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

// The source of one function: from its declaration to the next top-level one.
function fnSource(text, decl) {
  const start = text.indexOf(decl);
  if (start === -1) return '';
  const next = text.indexOf('\nfunction ', start + decl.length);
  return text.slice(start, next === -1 ? undefined : next);
}

// The opening tag of the element with this id, '' when the page has none.
function tagOf(html, id) {
  const at = html.indexOf('id="' + id + '"');
  if (at === -1) return '';
  const open = html.lastIndexOf('<', at);
  const close = html.indexOf('>', at);
  return html.slice(open, close + 1);
}

// What the gate pins beyond the copy itself.
function structure() {
  const problems = [];

  // The phone: where the block sits, its three search boxes, and its window.
  const html = readText(MOBILE);
  const start = html.indexOf(BEGIN);
  if (start !== -1) {
    const before = html.slice(0, start);
    const open = (before.match(/<script\b/g) || []).length - (before.match(/<\/script>/g) || []).length;
    if (open !== 0) problems.push([MOBILE, 'the block opens inside another <script>']);
    if (start < html.indexOf(ANCHOR)) problems.push([MOBILE, 'the block sits before the search rule it reads (' + ANCHOR + ')']);
  }
  ['srch', 'prompt-srch', 'mem-srch'].forEach((id) => {
    const tag = tagOf(html, id);
    if (!tag) problems.push([MOBILE, 'has no search box #' + id]);
    else if (!/\sreadonly[\s>]/.test(tag)) problems.push([MOBILE, 'search box #' + id + ' takes the typing itself (it must be read-only and open the search window)']);
  });
  if (fnSource(html, 'function openSearchWindow(').indexOf('SBCommandPalette.create(') === -1) {
    problems.push([MOBILE, 'the search window comes from the module (function openSearchWindow(... must call SBCommandPalette.create(...)']);
  }
  if (fnSource(html, 'function sbSearchRecentStore(').indexOf('SBRecents.open(') === -1) {
    problems.push([MOBILE, 'recently opened comes from the module (function sbSearchRecentStore(... must call SBRecents.open(...)']);
  }

  // The popup: the three files, in order, before its own code, and a bar that
  // opens the window.
  const popup = readText(POPUP);
  const order = ['../shared/asset-search.js', '../shared/recents.js', '../shared/command-palette.js', 'src="popup.js"'];
  let last = -1;
  order.forEach((name) => {
    const at = popup.indexOf(name);
    if (at === -1) problems.push([POPUP, 'does not load ' + name]);
    else if (at < last) problems.push([POPUP, 'loads ' + name + ' too early: the order is asset-search, recents, command-palette, popup']);
    last = Math.max(last, at);
  });
  if (popup.indexOf('../shared/command-palette.css') === -1) problems.push([POPUP, 'does not load ../shared/command-palette.css']);
  if (!/\sreadonly[\s>]/.test(tagOf(popup, 'sq'))) problems.push([POPUP, 'search box #sq takes the typing itself (it must be read-only and open the search window)']);
  const popupJs = readText(POPUP_JS);
  if (fnSource(popupJs, 'function openSearchWindow(').indexOf('SBCommandPalette.create(') === -1) {
    problems.push([POPUP_JS, 'the search window comes from the module (function openSearchWindow(... must call SBCommandPalette.create(...)']);
  }
  if (fnSource(popupJs, 'function searchRecentStore(').indexOf('SBRecents.open(') === -1) {
    problems.push([POPUP_JS, 'recently opened comes from the module (function searchRecentStore(... must call SBRecents.open(...)']);
  }

  // The dashboard: the same three files, in the same order, and the sheet.
  const dash = readText(DASHBOARD);
  const wanted = ['/extension/shared/asset-search.js', '/extension/shared/recents.js', '/extension/shared/command-palette.js'];
  last = -1;
  wanted.forEach((name) => {
    const at = dash.indexOf("'" + name + "'");
    if (at === -1) problems.push([DASHBOARD, 'does not load ' + name]);
    else if (at < last) problems.push([DASHBOARD, 'loads ' + name + ' too early: the order is asset-search, recents, command-palette']);
    last = Math.max(last, at);
  });
  if (dash.indexOf("'/extension/shared/command-palette.css'") === -1) problems.push([DASHBOARD, 'does not load /extension/shared/command-palette.css']);

  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const result = apply(check);
  let failed = false;

  if (result === 'ok') {
    console.log('OK   ' + rel(MOBILE) + ' command-palette in sync');
  } else if (result === 'written') {
    console.log('SYNC ' + rel(MOBILE) + ' command-palette updated');
  } else {
    failed = true;
    const why = result === 'missing' ? 'has no command-palette block' : 'command-palette has drifted';
    console.error('X    ' + rel(MOBILE) + ' ' + why + ' -> run: node scripts/sync-command-palette.js');
  }

  structure().forEach(([file, problem]) => {
    failed = true;
    console.error('X    ' + rel(file) + ' ' + problem);
  });

  if (failed) process.exit(1);
}

main();
