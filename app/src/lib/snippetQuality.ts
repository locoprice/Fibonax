import { extractProse } from '@/lib/languageDetect';
import { scoreCriteria, type EvalCriterion, type EvalResult } from '@/lib/qualityScore';
import { validateTemplate } from '@/lib/statusSignals';

// How well a snippet is written, scored 0 to 10 by fixed rules that run in the
// browser (the snippet rating, decided with Valentina on 2026-11-10).
//
// The rules adapt Google's questions on helpful content (E-E-A-T) to a text
// that is sent again and again. They read the words, never the meaning, so
// they check what text can show: clear sentences, a start and a finish, a next
// step, concrete details, a calm tone, a title that says what the snippet is,
// and nothing left half done. They cannot tell whether a fact is true or who
// wrote it, so nothing here says "accurate". The Pro "Improve with AI" window
// reads the meaning and only adds suggestions; it never changes this score.
//
// Short snippets are short on purpose (an address, a signature, "Thanks, talk
// soon"). Under SHORT_WORDS words a snippet is judged on clarity, its title and
// leftovers only, so it is never marked low for being short.
//
// Word lists cover English, Italian, Spanish and French, all at once: a MULTI
// snippet mixes them, and a word that marks one language is noise in another
// only where it is spelled the same, which these lists avoid.

/** Below this many words a snippet is judged as short. */
export const SHORT_WORDS = 12;

/** Partial credit for a criterion that is present but weak. */
const PARTIAL = 0.5;

/** The longest sentence that still reads easily, and the one that clearly does not. */
const SENTENCE_EASY_WORDS = 30;
const SENTENCE_HARD_WORDS = 45;

/** Words that make a longer text detailed enough, or fewer with fields to fill. */
const DEPTH_WORDS = 25;
const DEPTH_WORDS_WITH_FIELDS = 15;
const DEPTH_FIELDS = 2;

/** How far into the text a greeting, and from the end a sign-off, is looked for. */
const OPENING_CHARS = 80;
const CLOSING_CHARS = 160;

/** Letters, accents included, so a match ends where the word ends. */
const L = 'A-Za-zÀ-ɏ';

function wordsRe(list: string): RegExp {
  return new RegExp(`(^|[^${L}])(${list})(?![${L}])`, 'i');
}

function wordsReGlobal(list: string): RegExp {
  return new RegExp(`(^|[^${L}])(${list})(?![${L}])`, 'gi');
}

const GREETING = wordsRe(
  'hi|hello|hey|dear|good (?:morning|afternoon|evening)|greetings|thank you|thanks|' +
  'ciao|salve|gentile|gentilissim[oa]|car[oa]|buongiorno|buonasera|grazie|' +
  'hola|estimad[oa]s?|querid[oa]s?|buen(?:os|as) (?:días|dias|tardes|noches)|gracias|' +
  'bonjour|bonsoir|salut|cher|chère|madame|monsieur|merci',
);

const CLOSING = wordsRe(
  'regards|best|cheers|sincerely|thanks|thank you|talk soon|see you|yours|' +
  'saluti|cordialmente|a presto|grazie|un abbraccio|distinti|' +
  'saludos|atentamente|un abrazo|hasta pronto|gracias|' +
  'salutations|à bientôt|merci|bien à vous|amitiés',
);

/** Words that speak to the reader: a text that has them is a message. */
const SECOND_PERSON = new Set([
  'you', 'your', 'yours',
  'tu', 'ti', 'te', 'tuo', 'tua', 'tuoi', 'tue', 'voi', 'vi', 'vostro', 'vostra', 'vostri', 'vostre',
  'tú', 'usted', 'ustedes', 'vosotros', 'os',
  'vous', 'votre', 'vos', 'ton', 'ta', 'tes',
]);

const NEXT_STEP = wordsRe(
  'reply|call|click|confirm|contact|visit|send|sign|pay|fill in|let me know|let us know|tap|download|join|register|schedule|order|' +
  'rispondi|rispondere|chiama|chiamare|clicca|conferma|confermare|contatta|contattare|visita|invia|inviare|firma|paga|compila|fammi sapere|fateci sapere|mi faccia sapere|ci faccia sapere|scrivi|scarica|iscriviti|chiami|scriva|risponda|contatti|confermi|invii|' +
  'responde|responda|llama|llame|haz clic|confirma|confirme|contacta|contacte|envía|envíe|rellena|avísame|avísanos|avísenos|escribe|escríbanos|llámenos|descarga|regístrate|' +
  'répondez|réponds|appelez|cliquez|confirmez|contactez|visitez|envoyez|signez|payez|remplissez|dites-moi|écrivez|téléchargez|inscrivez-vous',
);

const VAGUE = wordsReGlobal(
  'stuff|things|thing|etc|asap|somehow|whatever|something|various|kinda|sorta|' +
  'cose|roba|ecc|eccetera|qualcosa|varie|' +
  'cosas|algo|varios|varias|' +
  'choses|trucs|truc|quelque chose',
);

const HYPE = wordsReGlobal(
  'amazing|incredible|unbelievable|best ever|guaranteed|act now|hurry|limited time|last chance|don\'t miss|once in a lifetime|' +
  'incredibile|straordinari[oa]|imperdibile|affrettati|ultima occasione|garantit[oa]|solo oggi|' +
  'increíble|imperdible|date prisa|última oportunidad|garantizad[oa]|solo hoy|' +
  'incroyable|exceptionnel(?:le)?|dépêchez-vous|dernière chance|garanti(?:e)?|aujourd\'hui seulement',
);

/** Titles that say nothing about the snippet. */
const GENERIC_TITLE = /^(?:test(?:ing)?|prova|prueba|essai|untitled|snippet|new snippet|nuovo|nuova|nuevo|nueva|nouveau|nouvelle|copy|copia|copie|draft|bozza|borrador|brouillon|asdf|qwerty|x+|temp|tmp|sample|esempio|ejemplo|exemple|foo|bar)(?:\s*\d+)?$/i;
const COPY_SUFFIX = /[\s(](?:copy|copia|copie)\)?$/i;

/** Control tokens that print nothing themselves: not a field to fill. */
const CONTROL_TOKEN = /^(?:if:|endif$|else$|elseif:|\/button$)/i;

export interface UnfinishedPiece {
  text: string;
}

export interface SnippetQualityInput {
  /** The snippet's name, as the list shows it. */
  name: string;
  /** One language's plain body, fields and formulas included. */
  body: string;
  /**
   * What looks unfinished in a text: SBFillForm.unfinished, the rule the
   * extension and the phone run before a snippet goes out. Tests pass a stub.
   */
  unfinished: (text: string) => readonly UnfinishedPiece[];
}

/**
 * The body with each field, formula and button block replaced by a dot that
 * is neither a letter nor a space, so "Hi {name}," keeps reading as "Hi ·,"
 * and is not mistaken for a space before a comma or a repeated word.
 */
const TOKEN_MARK = '·';

function withoutTemplate(body: string): string {
  return body
    .replace(/\{button[^}]*\}[\s\S]*?\{\/button\}/gi, TOKEN_MARK)
    .replace(/\{\{[\s\S]*?\}\}/g, TOKEN_MARK)
    .replace(/\{[^{}]*\}/g, TOKEN_MARK);
}

function fieldCount(body: string): number {
  let n = 0;
  for (const m of body.matchAll(/\{([^{}]+)\}/g)) {
    if (!CONTROL_TOKEN.test((m[1] ?? '').trim())) n += 1;
  }
  return n;
}

function wordList(text: string): string[] {
  return text.split(/[^\p{L}]+/u).filter((w) => w !== '');
}

function countMatches(re: RegExp, text: string): string[] {
  const found: string[] = [];
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) if (m[2]) found.push(m[2]);
  return found;
}

function quoted(pieces: readonly string[]): string {
  return pieces.slice(0, 3).map((p) => `"${p}"`).join(', ');
}

function pass(base: Omit<EvalCriterion, 'status' | 'value' | 'rationale'>, rationale: string): EvalCriterion {
  return { ...base, status: 'pass', value: 1, rationale };
}

function partial(base: Omit<EvalCriterion, 'status' | 'value' | 'rationale'>, rationale: string, example: string): EvalCriterion {
  return { ...base, status: 'partial', value: PARTIAL, rationale, example };
}

function fail(base: Omit<EvalCriterion, 'status' | 'value' | 'rationale'>, rationale: string, example: string): EvalCriterion {
  return { ...base, status: 'fail', value: 0, rationale, example };
}

// ── Clarity ──────────────────────────────────────────────────────────────────

function gradeSentences(text: string): EvalCriterion {
  const base = {
    id: 'sentences',
    label: 'Short, clear sentences',
    description: 'Clarity: one idea per sentence reads at a glance.',
    weight: 1,
  };
  const longest = text
    .split(/[.!?…]+|\n+/)
    .reduce((max, s) => Math.max(max, wordList(s).length), 0);
  const example = 'Split it in two: "Your order has shipped. It arrives on Friday."';
  if (longest <= SENTENCE_EASY_WORDS) return pass(base, 'Every sentence is easy to follow.');
  if (longest <= SENTENCE_HARD_WORDS) {
    return partial(base, `One sentence runs to ${longest} words. Shorter sentences read faster.`, example);
  }
  return fail(base, `One sentence runs to ${longest} words, which is hard to follow.`, example);
}

function gradeVague(text: string): EvalCriterion {
  const base = {
    id: 'specific-words',
    label: 'Specific words',
    description: 'Clarity: the reader knows exactly what is meant.',
    weight: 0.75,
  };
  const found = countMatches(VAGUE, text);
  const example = 'Name the thing: "the signed form and a copy of your ID" instead of "the documents etc."';
  if (found.length === 0) return pass(base, 'No vague words.');
  if (found.length <= 2) return partial(base, `Vague words: ${quoted(found)}. Say what you mean.`, example);
  return fail(base, `Several vague words: ${quoted(found)}. Say what you mean.`, example);
}

function gradeStyle(text: string): EvalCriterion {
  const base = {
    id: 'clean-wording',
    label: 'Clean wording',
    description: 'Clarity: no repeated words, shouting or messy punctuation.',
    weight: 1.25,
  };
  const issues: string[] = [];
  const repeated = /(^|[^\p{L}])(\p{L}+)\s+\2(?!\p{L})/iu.exec(text);
  if (repeated) issues.push(`a repeated word ("${repeated[2]} ${repeated[2]}")`);
  const caps = (text.match(/(?<![\p{L}])\p{Lu}{5,}(?![\p{L}])/gu) ?? []).length;
  if (caps >= 2) issues.push('words in capitals, which read as shouting');
  if (/[!?]{2,}/.test(text)) issues.push('doubled punctuation ("!!" or "?!")');
  if (/\p{L}[,;]\p{L}/u.test(text)) issues.push('a comma with no space after it');
  if (/\p{L}\s+[,.](?=\s|$)/u.test(text)) issues.push('a space before a comma or full stop');
  const example = 'Read it once out loud: it catches most of these.';
  if (issues.length === 0) return pass(base, 'The wording is clean.');
  const list = issues.join('; ');
  if (issues.length === 1) return partial(base, `Found ${list}.`, example);
  return fail(base, `Found ${list}.`, example);
}

// ── Completeness ─────────────────────────────────────────────────────────────

/** The automatic greeting field ("Good morning" or "Good evening" by the clock). */
const GREETING_TOKEN = /^\s*\{\s*greeting\s*(?::|\})/i;

function gradeFrame(body: string, text: string, words: readonly string[]): EvalCriterion {
  const base = {
    id: 'start-finish',
    label: 'Clear start and finish',
    description: 'Completeness: a message opens with a greeting and ends with a sign-off.',
    weight: 1.5,
  };
  const trimmed = text.trim();
  const opens = GREETING_TOKEN.test(body) || GREETING.test(trimmed.slice(0, OPENING_CHARS));
  const closes = CLOSING.test(trimmed.slice(-CLOSING_CHARS));
  const isMessage = opens || closes || words.some((w) => SECOND_PERSON.has(w.toLowerCase()));
  if (!isMessage) return pass(base, 'Not written to someone, so no greeting is needed.');
  if (opens && closes) return pass(base, 'It opens with a greeting and ends with a sign-off.');
  if (opens) return partial(base, 'It opens well but ends without a sign-off.', 'End with a line such as "Thanks, and talk soon."');
  if (closes) return partial(base, 'It ends well but starts without a greeting.', 'Start with a line such as "Hi {name},".');
  return fail(base, 'It is written to someone but has no greeting and no sign-off.', 'Start with "Hi {name}," and end with "Thanks, and talk soon."');
}

function gradeNextStep(text: string, raw: string): EvalCriterion {
  const base = {
    id: 'next-step',
    label: 'Says what to do next',
    description: 'Completeness: the reader knows how to reply or act.',
    weight: 1.25,
  };
  const hasStep =
    text.includes('?') ||
    /https?:\/\/\S+/i.test(raw) ||
    /\S+@\S+\.\S+/.test(raw) ||
    /\+?\d[\d\s]{7,}\d/.test(raw) ||
    NEXT_STEP.test(text);
  if (hasStep) return pass(base, 'The reader knows what to do next.');
  return partial(base, 'Nothing tells the reader how to reply or what to do next.', 'Add one line: "Reply to this email to confirm, or call us on {phone}."');
}

function gradeDepth(wordCount: number, fields: number): EvalCriterion {
  const base = {
    id: 'detail',
    label: 'Enough detail',
    description: 'Completeness: everything the reader needs, with no gaps.',
    weight: 1.5,
  };
  if (wordCount >= DEPTH_WORDS || (wordCount >= DEPTH_WORDS_WITH_FIELDS && fields >= DEPTH_FIELDS)) {
    return pass(base, 'There is enough detail to act on.');
  }
  return partial(base, `At ${wordCount} words it may leave the reader with questions.`, 'Add the when, where or how much the reader will ask about.');
}

// ── Value and trust ──────────────────────────────────────────────────────────

function gradeSpecifics(text: string, raw: string, fields: number): EvalCriterion {
  const base = {
    id: 'concrete',
    label: 'Concrete details',
    description: 'Value: numbers, names, dates and links make it useful and easy to trust.',
    weight: 1.25,
  };
  const numbers = (text.match(/\d+(?:[.,:]\d+)*/g) ?? []).length;
  const links = (raw.match(/https?:\/\/\S+|\S+@\S+\.\S+/gi) ?? []).length;
  const names = (text.match(/(?<=[\p{Ll},;]\s+)\p{Lu}\p{Ll}+/gu) ?? []).length;
  const signals = numbers + links + names + fields;
  const example = 'Replace "soon" with a date, "our office" with the address, "the price" with the amount or a field.';
  if (signals >= 2) return pass(base, 'It gives concrete details.');
  if (signals === 1) return partial(base, 'It has one concrete detail. A second makes it easier to act on.', example);
  return fail(base, 'No numbers, names, dates, links or fields. It reads as general.', example);
}

function gradeTone(text: string): EvalCriterion {
  const base = {
    id: 'tone',
    label: 'Calm, honest tone',
    description: 'Trust: no pressure or exaggeration.',
    weight: 0.75,
  };
  const found = countMatches(HYPE, text);
  if ((text.match(/!/g) ?? []).length > 2) found.push('many exclamation marks');
  const example = 'State the fact: "Prices go up on 1 March" instead of "Hurry, last chance!!"';
  if (found.length === 0) return pass(base, 'The tone is calm and plain.');
  if (found.length === 1) return partial(base, `Pushy wording: ${quoted(found)}. Plain facts earn more trust.`, example);
  return fail(base, `Pushy wording: ${quoted(found)}. Plain facts earn more trust.`, example);
}

// ── Title and care ───────────────────────────────────────────────────────────

function gradeTitle(name: string, short: boolean): EvalCriterion {
  const base = {
    id: 'title',
    label: 'Helpful title',
    description: 'Title: says what the snippet is, so it is easy to find and pick.',
    weight: 1,
  };
  const title = name.trim();
  const example = 'Name what it does: "Payment reminder" or "Office address".';
  if (title.length < 3 || !/\p{L}/u.test(title) || GENERIC_TITLE.test(title) || COPY_SUFFIX.test(title)) {
    return fail(base, `"${title || 'No title'}" does not say what the snippet is.`, example);
  }
  if (/!/.test(title) || countMatches(HYPE, title).length > 0) {
    return partial(base, 'The title exaggerates. A plain name is easier to trust and to find.', example);
  }
  if (!short && wordList(title).length < 2) {
    return partial(base, 'A one-word title is hard to tell apart from others. Add a word that says what it is for.', example);
  }
  return pass(base, 'The title says what the snippet is.');
}

function gradeLeftovers(body: string, text: string, unfinished: SnippetQualityInput['unfinished']): EvalCriterion {
  const base = {
    id: 'finished',
    label: 'Nothing left unfinished',
    description: 'Care: no notes, gaps or broken parts that would go out by mistake.',
    weight: 1.5,
  };
  const template = validateTemplate(body);
  if (!template.ok) {
    return fail(base, template.message, 'Open the part named above and close it.');
  }
  const pieces = unfinished(text).map((p) => p.text);
  if (pieces.length === 0) return pass(base, 'Nothing looks unfinished.');
  return fail(base, `Looks unfinished: ${quoted(pieces)}.`, 'Replace each one with the real text, or with a field to fill in.');
}

/**
 * The quality of one snippet body. Pure: the same name, body and rule give the
 * same score on every screen.
 */
export function evaluateSnippet(input: SnippetQualityInput): EvalResult {
  const body = input.body ?? '';
  const text = withoutTemplate(body);
  const words = wordList(extractProse(body));
  const fields = fieldCount(body);
  const short = words.length < SHORT_WORDS;

  const criteria: EvalCriterion[] = [
    gradeSentences(text),
    gradeVague(text),
    gradeStyle(text),
  ];
  if (!short) {
    criteria.push(
      gradeFrame(body, text, words),
      gradeNextStep(text, body),
      gradeDepth(words.length, fields),
      gradeSpecifics(text, body, fields),
      gradeTone(text),
    );
  }
  criteria.push(gradeTitle(input.name, short), gradeLeftovers(body, text, input.unfinished));

  return scoreCriteria(criteria);
}

/** Whether a body is short enough to be judged on clarity, title and leftovers only. */
export function isShortSnippet(body: string): boolean {
  return wordList(extractProse(body ?? '')).length < SHORT_WORDS;
}

export interface LowestScore {
  score: number;
  /** The language whose body scored lowest. */
  language: string;
}

/**
 * The lowest score among a snippet's language bodies. A translated snippet is
 * only as good as its weakest language, since each one is sent to someone.
 * Null when the snippet has no text.
 */
export function lowestSnippetScore(
  snippet: { name: string; content: string; language: string; bodies?: Record<string, string | undefined> | null },
  unfinished: SnippetQualityInput['unfinished'],
): LowestScore | null {
  const bodies = Object.entries(snippet.bodies ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
  );
  const list = bodies.length > 0 ? bodies : [[snippet.language, snippet.content] as [string, string]];
  let lowest: LowestScore | null = null;
  for (const [language, body] of list) {
    if (body.trim() === '') continue;
    const { score } = evaluateSnippet({ name: snippet.name, body, unfinished });
    if (lowest === null || score < lowest.score) lowest = { score, language };
  }
  return lowest;
}
