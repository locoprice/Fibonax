#!/usr/bin/env node
// Keeps the inlined copy of Your details (extension/shared/my-details.js)
// identical to the canonical file. Same shape as scripts/sync-season.js: run
// without arguments to write the copy, or with --check to assert it matches.
//
//   app/public/mobile/index.html   single-file app by design, cannot load
//                                  extension/shared/my-details.js at runtime
//
// {my: name}, {my: company} and {my: job title} print what a surface handed
// the module. A surface that never hands it the account's details prints them
// all empty, so --check also fails when:
//
//   the phone, the page script or the popup stops handing them over
//   the worker stops asking the server for them
//   the extension stops loading the module ahead of the scripts that use it
//   extension/auth/auth.js names the device key differently

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension', 'shared', 'my-details.js');
const MOBILE = path.join(ROOT, 'app', 'public', 'mobile', 'index.html');
const MANIFEST = path.join(ROOT, 'extension', 'manifest.json');
const POPUP_HTML = path.join(ROOT, 'extension', 'popup', 'popup.html');
const POPUP_JS = path.join(ROOT, 'extension', 'popup', 'popup.js');
const CONTENT_JS = path.join(ROOT, 'extension', 'content', 'content.js');
const BACKGROUND_JS = path.join(ROOT, 'extension', 'background', 'background.js');
const AUTH_JS = path.join(ROOT, 'extension', 'auth', 'auth.js');
const BEGIN = '<!-- SB_MY_DETAILS:BEGIN (generated from extension/shared/my-details.js by scripts/sync-my-details.js, do not edit) -->';
const END = '<!-- SB_MY_DETAILS:END -->';
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

function wiring() {
  const details = require(SOURCE);
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
  need(MOBILE, 'SBMyDetails.set(d)', 'the phone hands the account\'s details to the module');
  need(MOBILE, 'function sbMyText(', 'the phone\'s own resolver prints {my: …}');
  need(CONTENT_JS, '_SBMyDetails.set(data', 'the page script hands the details to the module');
  need(POPUP_JS, 'SBMyDetails.set(d', 'the popup hands the details to the module');
  need(BACKGROUND_JS, "importScripts('../shared/my-details.js');", 'the worker loads the module');
  need(BACKGROUND_JS, 'supaRpc(SBMyDetails.RPC', 'the worker asks the server for the details');

  const scripts = (JSON.parse(readText(MANIFEST)).content_scripts[0] || {}).js || [];
  const at = scripts.indexOf('shared/my-details.js');
  if (at === -1 || at > scripts.indexOf('content/content.js')) {
    problems.push(rel(MANIFEST) + ': shared/my-details.js must load before content/content.js');
  }
  const popup = readText(POPUP_HTML);
  const mod = popup.indexOf('<script src="../shared/my-details.js"></script>');
  if (mod === -1 || mod > popup.indexOf('<script src="popup.js"></script>')) {
    problems.push(rel(POPUP_HTML) + ': must load ../shared/my-details.js before popup.js');
  }

  need(AUTH_JS, "var SB_MY_DETAILS_STORAGE_KEY = '" + details.STORAGE_KEY + "';", 'the device key is my-details.js\'s STORAGE_KEY');
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const result = apply(readText(SOURCE), check);
  let failed = false;

  if (result === 'ok') {
    console.log('OK   ' + rel(MOBILE) + ' my-details in sync');
  } else if (result === 'written') {
    console.log('SYNC ' + rel(MOBILE) + ' my-details updated');
  } else {
    failed = true;
    const why = result === 'missing' ? 'has no my-details block' : 'my-details has drifted';
    console.error('X    ' + rel(MOBILE) + ' ' + why + ' -> run: node scripts/sync-my-details.js');
  }

  const problems = wiring();
  problems.forEach((problem) => {
    failed = true;
    console.error('X    ' + problem);
  });
  if (!problems.length) console.log('OK   every surface loads Your details and hands them over');

  if (failed) process.exit(1);
}

main();
