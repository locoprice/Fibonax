#!/usr/bin/env node
// Picks the next free release number and writes it to every version stamp.
//
//   node scripts/bump-version.js patch      a fix:      3.118.0 -> 3.118.1
//   node scripts/bump-version.js minor      a feature:  3.118.0 -> 3.119.0
//   node scripts/bump-version.js major      rare:       3.118.0 -> 4.0.0
//   add --dry-run to see the number without writing it
//
// Run it as the last step before the commit, never at the start of a task.
// It first asks GitHub for develop and stops when this copy is behind, so two
// sessions or two computers can never claim the same number. The new number
// is counted up from the highest committed release (this copy or GitHub),
// whatever a working copy already holds.
const { execFileSync } = require('child_process');
const path = require('path');
const { STAMPS, readStamps, writeStamps, nextVersion, compareVersions } = require('./version-stamps');

const ROOT = path.join(__dirname, '..');
const REMOTE_BRANCH = 'origin/develop';

function fail(msg) {
  console.error('X ' + msg);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function committedVersion(ref) {
  return JSON.parse(git('show', ref + ':extension/manifest.json')).version;
}

const level = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!['patch', 'minor', 'major'].includes(level)) {
  fail('Say which kind of release: node scripts/bump-version.js <patch|minor|major> [--dry-run]');
}

try {
  git('fetch', '--quiet', 'origin', 'develop');
} catch (e) {
  fail('Could not reach develop on GitHub, so the next free number is unknown. Check the connection and run this again.\n' + e.stderr);
}

const behind = Number(git('rev-list', '--count', 'HEAD..' + REMOTE_BRANCH));
if (behind > 0) {
  fail(
    'This copy is ' + behind + ' commit(s) behind develop on GitHub. Bring it up to date first ' +
    '(git merge --ff-only ' + REMOTE_BRANCH + '), then run this again.',
  );
}

const here = committedVersion('HEAD');
const online = committedVersion(REMOTE_BRANCH);
const base = compareVersions(here, online) >= 0 ? here : online;
const next = nextVersion(base, level);

const before = readStamps().flatMap((s) => s.values);
const held = [...new Set(before)].filter((v) => v !== base);
if (held.length) console.log('Working copy held ' + held.join(', ') + '; the number is counted from the last release, ' + base + '.');

if (dryRun) {
  console.log('Next ' + level + ' release: ' + next + ' (last release ' + base + '). Nothing written.');
  process.exit(0);
}

writeStamps(next);

const drift = readStamps().filter((s) => s.values.some((v) => v !== next));
if (drift.length) fail('Some stamps did not take the new number: ' + drift.map((s) => s.file).join(', '));

console.log('OK ' + base + ' -> ' + next + ' written to ' + STAMPS.length + ' files (' + before.length + ' stamps).');
