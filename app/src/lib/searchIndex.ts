import { groupSnippetsByLanguage } from '@/lib/snippetGrouping';
import type {
  Label,
  LabelAssignments,
  MemoryItem,
  MemorySpace,
  Prompt,
  SnippetRow,
} from '@/types/database';

// What the one search bar matches, and how it ranks (SEARCH-001).
//
// Pure on purpose: the header bar, each page's filtered list and the aggregated
// panel all read the same rules from here, so "does this match?" has exactly one
// answer per asset no matter who is asking. It also means the rules are testable
// without rendering anything, which the store-backed lists are not.
//
// One scorer serves both readings. A page filter asks "is this above zero?" and
// the panel asks "how far above?", so there is no second implementation to keep
// in step.

export type SearchKind = 'snippet' | 'prompt' | 'memory';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  name: string;
  /** The second line: a trigger, a shortcut, or the space an item sits in. */
  detail: string;
  score: number;
  /** Memory items only: the space to open to reach the result. */
  spaceId?: string;
}

export interface SearchLibrary {
  snippets: SnippetRow[];
  prompts: Prompt[];
  spaces: MemorySpace[];
  /** Items across every space. Empty until the panel has loaded them. */
  items: MemoryItem[];
  /** Label names assigned to a snippet id. */
  snippetLabels: (id: string) => string[];
  /** Label names assigned to a prompt id. */
  promptLabels: (id: string) => string[];
}

export interface SearchResults {
  snippets: SearchHit[];
  prompts: SearchHit[];
  memory: SearchHit[];
  total: number;
}

/**
 * Field weights. A name beats a trigger, a trigger beats a label, and body text
 * comes last: matching a word buried in a body is useful, but it must never
 * outrank the snippet actually called that.
 */
const W_NAME = 8;
const W_KEY = 6;
const W_TAG = 3;
const W_SUMMARY = 4;
const W_BODY = 1;

/** Collapse a typed query to what the matchers compare against. */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

// searchWords, readableText, textExcerpt and metadataMatch are this file's
// copy of extension/shared/asset-search.js, the rule the popup, the menu on a
// page and the phone read. They run on every keystroke across the whole
// library, so they are written here rather than loaded at runtime;
// src/__tests__/assetSearch.test.ts holds them to the module, result for
// result.

// Lower case that never changes the length of the text, so a position found
// in the lowered copy is the same position in the text that is printed.
function lowerSameLength(text: string): string {
  const low = text.toLowerCase();
  if (low.length === text.length) return low;
  let out = '';
  for (let i = 0; i < text.length; i++) out += text.charAt(i).toLowerCase().charAt(0) || text.charAt(i);
  return out;
}

/** The typed words, lower case, each one once. Every one has to be found. */
export function searchWords(query: string): string[] {
  const out: string[] = [];
  for (const word of lowerSameLength(query).split(/\s+/)) {
    if (word && !out.includes(word)) out.push(word);
  }
  return out;
}

// Must equal TOKEN_RE, TOKEN_NAME_RE and RADIUS in extension/shared/asset-search.js.
const TOKEN_RE = /\{(?:=|\/?[a-z]+:)[^{}]*\}|\{(?:endif|else|\/[a-z]+)\}/gi;
const TOKEN_NAME_RE = /(?:^|[;:{]\s*)name=([^;}]*)/i;
const EXCERPT_RADIUS = 40;
const READABLE_CACHE_LIMIT = 5000;
let readableCache = new Map<string, string>();

/**
 * A text as a person reads it: a field or a formula counts as the name it
 * carries, never as the code that writes it, and the text sits on one line.
 */
export function readableText(text: string | null | undefined): string {
  if (!text) return '';
  const cached = readableCache.get(text);
  if (cached !== undefined) return cached;
  let out = text;
  // An inner token first, then the one around it.
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(TOKEN_RE, (token) => {
      const named = TOKEN_NAME_RE.exec(token);
      return named ? ` ${named[1] ?? ''} ` : ' ';
    });
    if (next === out) break;
    out = next;
  }
  // A field taken out leaves its space behind, never in front of a comma.
  out = out.replace(/\s+/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
  if (readableCache.size >= READABLE_CACHE_LIMIT) readableCache = new Map();
  readableCache.set(text, out);
  return out;
}

/** Why a result is listed when its row does not show the words typed. */
export type SearchReason =
  | { kind: 'Keyword' | 'Label'; value: string }
  | { kind: 'Text'; before: string; hit: string; after: string };

/** The piece of `text` around the first of `wanted` it holds, cut at whole words. */
export function textExcerpt(text: string, wanted: readonly string[]): SearchReason | null {
  const plain = readableText(text);
  const low = lowerSameLength(plain);
  let at = -1;
  let word = '';
  for (const candidate of wanted) {
    const found = low.indexOf(candidate);
    if (found > -1 && (at === -1 || found < at)) {
      at = found;
      word = candidate;
    }
  }
  if (at === -1) return null;
  const end = at + word.length;
  let from = Math.max(0, at - EXCERPT_RADIUS);
  let to = Math.min(plain.length, end + EXCERPT_RADIUS);
  if (from > 0) {
    const gap = plain.indexOf(' ', from);
    if (gap > -1 && gap < at) from = gap + 1;
  }
  if (to < plain.length) {
    const back = plain.lastIndexOf(' ', to);
    if (back > end) to = back;
  }
  return {
    kind: 'Text',
    before: (from > 0 ? '…' : '') + plain.slice(from, at),
    hit: plain.slice(at, end),
    after: plain.slice(end, to) + (to < plain.length ? '…' : ''),
  };
}

function holdsWord(texts: readonly (string | null | undefined)[], word: string): boolean {
  return texts.some((text) => !!text && lowerSameLength(text).includes(word));
}

/**
 * Which of the three a route belongs to, or null on a page that holds none of
 * them (analytics, team, settings).
 *
 * Read by the bar to word its placeholder.
 */
export function sectionForPath(pathname: string): SearchKind | null {
  if (pathname === '/') return 'snippet';
  if (pathname.startsWith('/prompts')) return 'prompt';
  if (pathname.startsWith('/memory')) return 'memory';
  return null;
}

/** The space being viewed, for the bar's placeholder. Null elsewhere. */
export function spaceForPath(pathname: string): string | null {
  const match = /^\/memory\/([^/]+)/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

/**
 * Resolve an asset id to the names of its labels.
 *
 * The id-to-name map is built once per call rather than per asset, because the
 * snippets list runs this across every row on every keystroke.
 */
export function labelNameLookup(
  catalog: readonly Label[],
  assignments: LabelAssignments,
): (assetId: string) => string[] {
  const names = new Map(catalog.map((label) => [label.id, label.name]));
  return (assetId) => {
    const ids = assignments.get(assetId);
    if (ids === undefined || ids.length === 0) return [];
    return ids
      .map((id) => names.get(id))
      .filter((name): name is string => name !== undefined);
  };
}

/**
 * Score one field against one typed word. A prefix match counts double, so
 * typing "inv" puts "Invoice" above a note that merely mentions invoices
 * halfway down.
 */
function scoreField(text: string | null | undefined, query: string, weight: number): number {
  if (!text) return 0;
  const haystack = lowerSameLength(text);
  if (haystack.startsWith(query)) return weight * 2;
  return haystack.includes(query) ? weight : 0;
}

function scoreList(texts: readonly string[], query: string, weight: number): number {
  let best = 0;
  for (const text of texts) {
    const score = scoreField(text, query, weight);
    if (score > best) best = score;
  }
  return best;
}

/**
 * Each typed word is scored on its own and the scores add up. A word found
 * nowhere fails the asset, so "parking hours" lists what holds both words, in
 * any order and any distance apart.
 */
function scoreWords(query: string, scoreWord: (word: string) => number): number {
  let total = 0;
  for (const word of searchWords(query)) {
    const score = scoreWord(word);
    if (score === 0) return 0;
    total += score;
  }
  return total;
}

/**
 * Explain a result whose row does not show every typed word: the keyword or
 * the label that holds the first such word, else the piece of its text around
 * it. Null when the row shows them all, or nothing holds them.
 */
export function metadataMatch(
  rawQuery: string,
  visibleText: readonly string[],
  labels: readonly string[],
  keywords: readonly string[] = [],
  text: readonly string[] = [],
): SearchReason | null {
  const hidden = searchWords(rawQuery).filter((word) => !holdsWord(visibleText, word));
  for (const word of hidden) {
    const keyword = keywords.find((value) => holdsWord([value], word));
    if (keyword) return { kind: 'Keyword', value: keyword };
    const label = labels.find((value) => holdsWord([value], word));
    if (label) return { kind: 'Label', value: label };
  }
  for (const body of text) {
    const found = textExcerpt(body, hidden);
    if (found) return found;
  }
  return null;
}

/**
 * Snippets match on name, trigger, keyword synonyms, labels and body text.
 * Body text was added with the one search bar: a prompt already searched its
 * content, and the two behaving differently was the kind of difference a user
 * reads as a bug.
 */
export function scoreSnippet(
  snippet: SnippetRow,
  query: string,
  labelNames: readonly string[] = [],
): number {
  if (query === '') return 0;
  // Every language variant's body, not just the master's: a Spanish body is
  // still this snippet's text.
  const bodies = [snippet.content, ...Object.values(snippet.bodies)]
    .filter((body): body is string => typeof body === 'string')
    .map(readableText);
  return scoreWords(query, (word) =>
    Math.max(
      scoreField(snippet.name, word, W_NAME),
      scoreList(snippet.triggers, word, W_KEY),
      scoreList(snippet.alternative_queries, word, W_SUMMARY),
      scoreList(labelNames, word, W_TAG),
      scoreList(bodies, word, W_BODY),
    ),
  );
}

/** Prompts match on name, shortcut, intent, labels and content. */
export function scorePrompt(
  prompt: Prompt,
  query: string,
  labelNames: readonly string[] = [],
): number {
  if (query === '') return 0;
  const content = readableText(prompt.content);
  return scoreWords(query, (word) =>
    Math.max(
      scoreField(prompt.name, word, W_NAME),
      scoreField(prompt.shortcut, word, W_KEY),
      scoreField(prompt.intent_category, word, W_SUMMARY),
      scoreList(labelNames, word, W_TAG),
      scoreField(content, word, W_BODY),
    ),
  );
}

/**
 * Memory items match on name, summary, body and the name of the space holding
 * them. The space name is in there because "everything in Clients" is how people
 * describe what they are looking for; memory items carry no labels.
 */
export function scoreMemoryItem(
  item: MemoryItem,
  query: string,
  spaceName: string | null = null,
): number {
  if (query === '') return 0;
  const summary = readableText(item.summary);
  const body = readableText(item.body);
  return scoreWords(query, (word) =>
    Math.max(
      scoreField(item.name, word, W_NAME),
      scoreField(summary, word, W_SUMMARY),
      scoreField(spaceName, word, W_TAG),
      scoreField(body, word, W_BODY),
    ),
  );
}

/** Spaces match on their own name and description. */
export function scoreSpace(space: MemorySpace, query: string): number {
  if (query === '') return 0;
  return scoreWords(query, (word) =>
    Math.max(
      scoreField(space.name, word, W_NAME),
      scoreField(space.description, word, W_SUMMARY),
    ),
  );
}

function byScoreThenName(a: SearchHit, b: SearchHit): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.name.localeCompare(b.name);
}

/**
 * Every match across the three libraries, grouped by type.
 *
 * Language variants collapse to one hit through the same grouping rule the
 * snippets table uses, so a snippet written in four languages is one result
 * rather than four, and it is scored by whichever variant matched best.
 */
export function searchAll(library: SearchLibrary, rawQuery: string): SearchResults {
  const query = normalizeQuery(rawQuery);
  const empty: SearchResults = { snippets: [], prompts: [], memory: [], total: 0 };
  if (query === '') return empty;

  const snippets: SearchHit[] = [];
  for (const group of groupSnippetsByLanguage(library.snippets)) {
    let best = 0;
    for (const variant of group.variants) {
      const score = scoreSnippet(variant, query, library.snippetLabels(variant.id));
      if (score > best) best = score;
    }
    if (best > 0) {
      snippets.push({
        kind: 'snippet',
        id: group.master.id,
        name: group.master.name,
        detail: group.master.triggers[0] ?? '',
        score: best,
      });
    }
  }

  const prompts: SearchHit[] = [];
  for (const prompt of library.prompts) {
    const score = scorePrompt(prompt, query, library.promptLabels(prompt.id));
    if (score > 0) {
      prompts.push({
        kind: 'prompt',
        id: prompt.id,
        name: prompt.name,
        detail: prompt.shortcut ?? prompt.intent_category ?? '',
        score,
      });
    }
  }

  const spaceNames = new Map(library.spaces.map((space) => [space.id, space.name]));
  const memory: SearchHit[] = [];
  for (const space of library.spaces) {
    const score = scoreSpace(space, query);
    if (score > 0) {
      memory.push({
        kind: 'memory',
        id: space.id,
        name: space.name,
        detail: 'Space',
        score,
        spaceId: space.id,
      });
    }
  }
  for (const item of library.items) {
    if (item.deleted_at !== null) continue;
    const spaceName = spaceNames.get(item.space_id) ?? null;
    const score = scoreMemoryItem(item, query, spaceName);
    if (score > 0) {
      memory.push({
        kind: 'memory',
        id: item.id,
        name: item.name,
        detail: spaceName ?? '',
        score,
        spaceId: item.space_id,
      });
    }
  }

  snippets.sort(byScoreThenName);
  prompts.sort(byScoreThenName);
  memory.sort(byScoreThenName);

  return {
    snippets,
    prompts,
    memory,
    total: snippets.length + prompts.length + memory.length,
  };
}
