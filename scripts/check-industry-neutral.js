// Gate for what the product ships and every new account sees:
//   - the server functions in services/supabase/functions/, including the
//     instructions they send to the AI model;
//   - the Getting started window (app/src/features/onboarding/).
//
// Fibonax ships to every industry (root CLAUDE.md, Industry-Neutral). The
// suggest-labels prompt once told the model it worked for a hospitality team
// and gave {guest_name} as its example placeholder, and the Getting started
// window called Fibonax "text expansion built for hospitality teams". This
// keeps the words the user manual already bans (vertical-words.js) out of
// both.
//
// The rest of the dashboard, the extension and the phone page are not scanned
// yet: their comments still use those words as examples, so a line scan there
// would need those comments rewritten first.
//
// Run from the repository root: node scripts/check-industry-neutral.js

const fs = require('fs');
const path = require('path');
const { VERTICAL } = require('./vertical-words');

const AREAS = [
  { dir: 'services/supabase/functions', what: 'server functions' },
  { dir: 'app/src/features/onboarding', what: 'the Getting started window' },
];

const problems = [];
const counts = [];
for (const { dir, what } of AREAS) {
  const root = path.join(__dirname, '..', dir);
  const files = fs.existsSync(root)
    ? fs.readdirSync(root, { recursive: true })
      .map((f) => f.split(path.sep).join('/'))
      .filter((f) => /\.tsx?$/.test(f))
      .sort()
    : [];

  // A scan that finds nothing would pass while checking nothing.
  if (files.length === 0) {
    console.error(`X no .ts or .tsx files in ${dir}/: the gate would check nothing`);
    process.exit(1);
  }

  for (const file of files) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const word = line.match(VERTICAL);
      if (word) problems.push(`${dir}/${file}:${i + 1} says "${word[0]}": ${what} must fit every industry`);
    });
  }
  counts.push(`${what} (${files.length} file${files.length === 1 ? '' : 's'})`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`X ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log(`OK industry-neutral: ${counts.join(', ')}, no hospitality words`);
