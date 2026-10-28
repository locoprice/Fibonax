// Gate for the landing page FAQ's structured data.
//
// The FAQ carries schema.org microdata on the markup itself (FAQPage >
// Question > Answer), so the visible question and answer ARE the structured
// data and the Italian and Spanish pages get theirs from the same generator
// that translates the prose. This checks that the shape search engines read
// is intact on every language's page: one FAQPage, every question with a
// name and an accepted answer, and no empty or duplicated text.
//
// Run from the repository root: node scripts/check-landing-faq.js

const fs = require('fs');
const path = require('path');

const LANDING = path.join(__dirname, '..', 'app', 'public', 'landing');
const PAGES = ['index.html', 'it/index.html', 'es/index.html'];
const MIN_QUESTIONS = 5;

const FAQ_PAGE = /<section class="faq" id="faq"[^>]*itemscope itemtype="https:\/\/schema\.org\/FAQPage"[^>]*>([\s\S]*?)<\/section>/g;
const QUESTION = /<details class="faq-item" itemscope itemprop="mainEntity" itemtype="https:\/\/schema\.org\/Question">([\s\S]*?)<\/details>/g;
const NAME = /<summary class="faq-q"><span itemprop="name">([^<]+)<\/span>/;
const ANSWER = /<div class="faq-a" itemscope itemprop="acceptedAnswer" itemtype="https:\/\/schema\.org\/Answer"><p itemprop="text">([\s\S]*?)<\/p><\/div>/;

const problems = [];
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

for (const page of PAGES) {
  const file = path.join(LANDING, page);
  if (!fs.existsSync(file)) { problems.push(`${page}: missing`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const sections = Array.from(html.matchAll(FAQ_PAGE));
  if (sections.length !== 1) { problems.push(`${page}: expected one FAQPage section, found ${sections.length}`); continue; }
  if ((html.match(/schema\.org\/FAQPage/g) || []).length !== 1) problems.push(`${page}: FAQPage declared more than once`);

  const questions = Array.from(sections[0][1].matchAll(QUESTION));
  if (questions.length < MIN_QUESTIONS) problems.push(`${page}: only ${questions.length} questions carry Question microdata`);
  const seen = new Set();
  questions.forEach((q, i) => {
    const name = q[1].match(NAME);
    const answer = q[1].match(ANSWER);
    if (!name || !text(name[1])) problems.push(`${page}: question ${i + 1} has no name`);
    if (!answer || !text(answer[1])) problems.push(`${page}: question ${i + 1} has no accepted answer`);
    if (name) {
      const n = text(name[1]);
      if (seen.has(n)) problems.push(`${page}: question "${n}" appears twice`);
      seen.add(n);
    }
  });
  // A translated page that still shows an English question has a stale locale.
  if (page !== 'index.html') {
    const english = Array.from(fs.readFileSync(path.join(LANDING, 'index.html'), 'utf8').matchAll(QUESTION))
      .map((q) => (q[1].match(NAME) || [])[1]).filter(Boolean).map(text);
    for (const n of seen) if (english.includes(n)) problems.push(`${page}: question "${n}" is still in English`);
  }
}

if (problems.length) {
  console.error('X Landing FAQ structured data:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`OK Landing FAQ structured data: FAQPage with Question/Answer microdata on ${PAGES.length} pages`);
