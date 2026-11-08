#!/usr/bin/env node
// Keeps the phone's copy of the Pomodoro timer identical to the extension's.
// Same shape as scripts/sync-memory-chunk.js: run without arguments to write
// the copy, or with --check to assert it matches (a gate).
//
//   app/public/mobile/index.html   single-file app by design, cannot load
//                                  extension/shared/ at runtime
//
// The phone runs the rules in focus-timer.js and draws the gallery in
// focus-carousel.js, the two files the extension uses. Each device keeps its
// own timer, so "in sync" means the same behaviour and the same words.
//
// --check also fails if the phone stops going through the module, if a design
// token the gallery needs is missing from the phone, or if the words a person
// reads differ between the extension and the phone.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TIMER = path.join(ROOT, 'extension', 'shared', 'focus-timer.js');
const CAROUSEL = path.join(ROOT, 'extension', 'shared', 'focus-carousel.js');
const MOBILE = path.join(ROOT, 'app', 'public', 'mobile', 'index.html');
const BEGIN = '<!-- SB_FOCUS_TIMER:BEGIN (generated from extension/shared/focus-timer.js and focus-carousel.js by scripts/sync-focus-timer.js, do not edit) -->';
const END = '<!-- SB_FOCUS_TIMER:END -->';
// The app's own script has to follow the Interactive Steps block directly, so
// this one goes ahead of that block, after the usage analytics.
const ANCHOR = '<!-- SB_USAGE_ANALYTICS:END -->';

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function block() {
  return BEGIN + '\n<script>\n' + readText(TIMER).trimEnd() + '\n</script>\n<script>\n' +
    readText(CAROUSEL).trimEnd() + '\n</script>\n' + END;
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

function fnSource(text, decl) {
  const start = text.indexOf(decl);
  if (start === -1) return '';
  const next = text.indexOf('\nfunction ', start + decl.length);
  return text.slice(start, next === -1 ? undefined : next);
}

// Everything a person reads in the extension's timer that is not already in
// the module. Each must be written the same on both sides.
const SHARED_WORDS = [
  'Pomodoro timer',
  'The Italian way to boost productivity',
  'The Pomodoro® Technique was created by Francesco Cirillo in the 1980s. Pomodoro® is a registered trademark.',
  'How long should this break be?',
  '1 minute', '2 minutes', '5 minutes',
  'Sessions and breaks', 'Extra breaks', 'Skipped', 'Today', 'Last 7 days',
  'Sessions in a block', 'Long break at the end', 'Chime when a session or break ends',
  'Changes start with the next session or break.',
  'Detox day', 'Your day off from screens and technology.',
  'Pictures of what you love, shown if you try to work on your detox day.',
  'Add pictures', 'Manage pictures', ' pictures, shown as a gallery',
  'Take the day off', 'Start anyway', 'Add pictures of what you love',
  'Your detox day pictures', 'No pictures yet', 'Choose pictures', 'Add more pictures',
  'Remove this picture', 'Remove picture', 'Picture removed.', ' pictures saved',
  'Could not save. Remove a picture or try smaller ones.',
  'Choose pictures of what you love most: your family, a sunset, your dog. If you try to work on your detox day, Fibonax shows them to you as a call to spend the day offline. With more than one, they play as a gallery.',
];

function structure() {
  const html = readText(MOBILE);
  const problems = [];
  const start = html.indexOf(BEGIN);
  if (start === -1) return problems;

  // A block opened inside another script leaves the app's code outside any tag.
  const before = html.slice(0, start);
  const open = (before.match(/<script\b/g) || []).length - (before.match(/<\/script>/g) || []).length;
  if (open !== 0) problems.push('the block opens inside another <script>');

  // The phone's own code is what remains once the generated copy is taken out.
  const own = before + html.slice(html.indexOf(END) + END.length);

  [
    ['function focusApply(', 'SBFocus.reduce(', 'every change goes through the rules'],
    ['function renderFocus(', 'SBFocus.view(', 'the page draws from the rules'],
    ['function renderFocus(', 'SBFocus.stats(', 'the counts come from the rules'],
    ['function renderFocus(', 'SBFocus.pillText(', 'the running time reads as on a computer'],
    ['function focusButtons(', 'SBFocus.actions(', 'the buttons come from the rules'],
    ['function focusChime(', 'SBFocus.playChime(', 'the chime is the same two tones'],
    ['function openDetoxCall(', 'SBFocusCarousel.create(', 'the detox day call uses the shared gallery'],
    ['function focusAddPhotos(', 'SBFocus.addPhotos(', 'pictures are added by the rules'],
    ['function focusShrink(', 'SBFocus.PHOTO_MAX_SIDE', 'pictures are shrunk to the shared size'],
    ['function focusShrink(', 'SBFocus.PHOTO_QUALITY', 'pictures are saved at the shared quality'],
  ].forEach(([decl, call, what]) => {
    if (fnSource(own, decl).indexOf(call) === -1) problems.push('Pomodoro timer: ' + what + ' (' + decl + '... must call ' + call + '...)');
  });

  const extension = ['extension/popup/popup.html', 'extension/popup/popup.js', 'extension/focus/photo.html', 'extension/focus/photo.js']
    .map((f) => readText(path.join(ROOT, f))).join('\n');
  SHARED_WORDS.forEach((words) => {
    if (extension.indexOf(words) === -1) problems.push('Pomodoro timer words: the extension no longer says "' + words + '"');
    if (own.indexOf(words) === -1) problems.push('Pomodoro timer words: the phone does not say "' + words + '"');
  });

  // The gallery colours itself from the design tokens, and the phone has its own.
  const needs = new Set(readText(CAROUSEL).match(/--sb-[a-z-]+/g) || []);
  needs.forEach((token) => {
    if (own.indexOf(token + ':') === -1) problems.push('Pomodoro timer: the gallery needs ' + token + ', which the phone does not define');
  });

  if (/chrome\.(storage|runtime)/.test(fnSource(own, 'function focusApply('))) problems.push('Pomodoro timer: the phone has no chrome API');
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const result = apply(check);
  let failed = false;

  if (result === 'ok') {
    console.log('OK   ' + rel(MOBILE) + ' Pomodoro timer in sync');
  } else if (result === 'written') {
    console.log('SYNC ' + rel(MOBILE) + ' Pomodoro timer updated');
  } else {
    failed = true;
    const why = result === 'missing' ? 'has no Pomodoro timer block' : 'Pomodoro timer has drifted';
    console.error('X    ' + rel(MOBILE) + ' ' + why + ' -> run: node scripts/sync-focus-timer.js');
  }

  structure().forEach((problem) => {
    failed = true;
    console.error('X    ' + rel(MOBILE) + ': ' + problem);
  });

  if (failed) process.exit(1);
}

main();
