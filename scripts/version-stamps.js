// Every place the release number is written, listed once.
//
// scripts/check-version.js reads these stamps and fails when any of them
// drifts; scripts/bump-version.js writes all of them in one step. A new
// version surface is added here and nowhere else.
//
// `count` is how many times the number appears in that file. The two lock
// files carry it twice: at the top and in the root package entry, which npm
// always writes as the first two "version" keys.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const JSON_VERSION = /("version":\s*")([^"]+)(")/g;
const SERVER_VERSION = /(SERVER_VERSION\s*=\s*')([^']+)(')/g;
const LANDING_FALLBACK = /(FALLBACK_VERSION=versionMatch\?versionMatch\[0\]:'v)([^']+)(')/g;

const STAMPS = [
  { file: 'extension/manifest.json', pattern: JSON_VERSION, count: 1 },
  { file: 'app/package.json', pattern: JSON_VERSION, count: 1 },
  { file: 'app/package-lock.json', pattern: JSON_VERSION, count: 2 },
  { file: 'services/mcp-memory/package.json', pattern: JSON_VERSION, count: 1 },
  { file: 'services/mcp-memory/package-lock.json', pattern: JSON_VERSION, count: 2 },
  { file: 'services/mcp-memory/src/index.ts', pattern: SERVER_VERSION, count: 1 },
  { file: 'app/public/landing/index.html', pattern: LANDING_FALLBACK, count: 1 },
  { file: 'app/public/landing/it/index.html', pattern: LANDING_FALLBACK, count: 1 },
  { file: 'app/public/landing/es/index.html', pattern: LANDING_FALLBACK, count: 1 },
  { file: 'app/public/landing/pricing/index.html', pattern: LANDING_FALLBACK, count: 1 },
  { file: 'app/public/landing/it/pricing/index.html', pattern: LANDING_FALLBACK, count: 1 },
  { file: 'app/public/landing/es/pricing/index.html', pattern: LANDING_FALLBACK, count: 1 },
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

// The first `count` numbers in a file's text, or an error naming what is missing.
function stampValues(stamp, text) {
  const values = [...text.matchAll(stamp.pattern)].slice(0, stamp.count).map((m) => m[2]);
  if (values.length < stamp.count) {
    throw new Error(
      'Expected ' + stamp.count + ' version stamp(s) in ' + stamp.file + ', found ' + values.length,
    );
  }
  return values;
}

function readStamps(root = ROOT) {
  return STAMPS.map((stamp) => ({
    file: stamp.file,
    values: stampValues(stamp, fs.readFileSync(path.join(root, stamp.file), 'utf8')),
  }));
}

// Rewrites only the number inside each stamp, so line endings and every
// other byte of the file stay as they were.
function writeStamps(version, root = ROOT) {
  if (!SEMVER.test(version)) throw new Error('Not a version number: ' + version);
  for (const stamp of STAMPS) {
    const target = path.join(root, stamp.file);
    const text = fs.readFileSync(target, 'utf8');
    stampValues(stamp, text);
    let seen = 0;
    const next = text.replace(stamp.pattern, (whole, head, _old, tail) => {
      seen += 1;
      return seen <= stamp.count ? head + version + tail : whole;
    });
    if (next !== text) fs.writeFileSync(target, next);
  }
}

function nextVersion(version, level) {
  const m = SEMVER.exec(version);
  if (!m) throw new Error('Not a version number: ' + version);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (level === 'major') return (major + 1) + '.0.0';
  if (level === 'minor') return major + '.' + (minor + 1) + '.0';
  if (level === 'patch') return major + '.' + minor + '.' + (patch + 1);
  throw new Error('Unknown level: ' + level);
}

// Negative when a is lower than b, zero when equal, positive when higher.
function compareVersions(a, b) {
  const pa = SEMVER.exec(a).slice(1).map(Number);
  const pb = SEMVER.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

module.exports = { STAMPS, readStamps, writeStamps, nextVersion, compareVersions };
