const fs = require('fs');
const { readStamps } = require('./version-stamps');

function fail(msg) {
  console.error("X " + msg);
  process.exit(1);
}

// Every release stamp (scripts/version-stamps.js lists them) must carry the
// extension's version: the dashboard and the MCP memory server packages and
// their lock files, the server's handshake constant, and the fallback the six
// landing pages show. scripts/bump-version.js writes them all at once.
const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
const extVersion = manifest.version;

let stamps;
try {
  stamps = readStamps();
} catch (e) {
  fail(e.message);
}

for (const stamp of stamps) {
  for (const value of stamp.values) {
    if (value !== extVersion) {
      fail("Version mismatch -> " + stamp.file + ": " + value + ", extension: " + extVersion);
    }
  }
}

// The landing footer uses the {{EXT_VERSION}} placeholder that Vite's
// landingVersionPlugin replaces at build, so it must still be present.
const landing = fs.readFileSync('app/public/landing/index.html', 'utf8');
if (!landing.includes('{{EXT_VERSION}}')) {
  fail(
    "Landing footer is missing the {{EXT_VERSION}} placeholder in " +
    "app/public/landing/index.html (the landingVersionPlugin fills it at build)",
  );
}

const count = stamps.reduce((n, s) => n + s.values.length, 0);
console.log("OK Version:", extVersion, "(" + count + " stamps in " + stamps.length + " files in parity)");
