// questions.ts — the questions inside a message, found by rule, and the
// searches run for them.
//
// Pure: no Deno APIs, no network, no imports, so the app's test runner can load
// it by relative path (app/src/__tests__/askQuestions.test.ts).
//
// FiboChat takes one question, or a whole message someone received (an email,
// a chat) that asks several things. The search behind it (knowledge_search)
// keeps only the items scoring at least half the best match, so one search
// over a message asking about three subjects returns the items for the
// strongest subject and drops the other two. Searching each question on its
// own gives every subject its own best items.
//
// These rules only decide what to search for. The model reads the whole
// message and names every question itself, including any these rules miss, so
// a missed question costs search recall, never an unanswered question.

/** Searches run for one message: its questions, then the whole text. */
export const MAX_SEARCHES = 6;

// A request written without a question mark, anywhere in a sentence. Matched
// without accents and in lower case. EN, IT, ES and FR, the languages the
// search stems.
const ASKS_ANYWHERE = [
  'let me know', 'let us know', 'i would like to know', "i'd like to know", 'i was wondering',
  'fatemi sapere', 'fammi sapere', 'mi fate sapere', 'vorrei sapere', 'vorremmo sapere', 'mi chiedevo',
  'hagame saber', 'hagan saber', 'avisenme', 'quisiera saber', 'me gustaria saber', 'queria saber', 'me preguntaba',
  'faites-moi savoir', 'je voudrais savoir', "j'aimerais savoir", 'je me demandais',
];

// A sentence that opens as a request is one, with or without a question mark.
const ASKS_AT_START = [
  'can you', 'could you', 'would you', 'please confirm', 'please advise', 'please tell', 'please send',
  'potete', 'potreste', 'puoi', 'potresti', 'mi potete', 'mi potreste', 'confermate', 'mi confermate',
  // Not a bare "puede" or "podria": "Puede que…" and "Podria ser…" are statements.
  'me pueden', 'me podrian', 'me puede', 'me podria', 'nos pueden', 'nos podrian', 'confirmen', 'me confirman',
  'pouvez-vous', 'pourriez-vous', 'pouvez vous', 'pourriez vous', 'merci de confirmer',
];

// Words a request may open with before its verb: "And could you…", "Please, can you…".
const LEAD_IN = /^(?:(?:and|also|so|then|please|e|ed|anche|inoltre|poi|per favore|y|tambien|ademas|por favor|et|aussi|alors|s'il vous plait)[\s,]+)+/;

function plain(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .toLowerCase();
}

function isQuestion(sentence: string): boolean {
  if (/\?["'”’)\]]*$/.test(sentence)) return true;
  const text = plain(sentence).replace(/^[\s¿¡"'(\-–—•*]+/, '');
  if (ASKS_ANYWHERE.some((phrase) => text.includes(phrase))) return true;
  const opening = text.replace(LEAD_IN, '');
  return ASKS_AT_START.some((phrase) => opening === phrase || opening.startsWith(phrase + ' '));
}

/**
 * The questions and requests in a text, in the order written, each once.
 * A sentence ends at a line break, or at . ! ? … followed by a space. A part
 * with no word of four letters or more is skipped: the search finds nothing
 * for "Why?" on its own.
 */
export function findQuestions(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    for (const part of line.split(/(?<=[.!?…])\s+/)) {
      const sentence = part.replace(/\s+/g, ' ').trim();
      if (!/\p{L}{4,}/u.test(sentence) || !isQuestion(sentence)) continue;
      const key = plain(sentence);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(sentence);
    }
  }
  return found;
}

/**
 * What to search for: each question on its own, then the whole text, which
 * still finds what a question phrased without any rule's words is about.
 * A text that is one question is searched once, as it always was.
 */
export function searchQueries(text: string): string[] {
  const whole = text.replace(/\s+/g, ' ').trim();
  const questions = findQuestions(text).filter((q) => plain(q) !== plain(whole));
  return [...questions.slice(0, MAX_SEARCHES - 1), whole];
}

/**
 * Several ranked lists as one, taking each list's best in turn so every
 * question gets its strongest item before any question gets a second. An item
 * found by two searches keeps its first place. One list comes back as it was.
 */
export function mergeRanked<T extends { kind: string; source_id: string }>(lists: T[][], max: number): T[] {
  const merged: T[] = [];
  const taken = new Set<string>();
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let at = 0; at < longest && merged.length < max; at++) {
    for (const list of lists) {
      const hit = list[at];
      if (!hit) continue;
      const key = `${hit.kind}:${hit.source_id}`;
      if (taken.has(key)) continue;
      taken.add(key);
      merged.push(hit);
      if (merged.length >= max) break;
    }
  }
  return merged;
}
