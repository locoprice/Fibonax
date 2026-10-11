// parseSaint.ts: the saint's name, from Vatican News' "Santo del giorno" page.
//
// Pure: no Deno APIs, no network, no imports, so the app's test runner can load
// it by relative path (app/src/__tests__/saintParse.test.ts).
//
// Deliberately not an HTML parser. Only headings are read, a name is accepted
// only when it looks like a saint's name, and anything else yields null, so a
// page that changes shape shows no saint instead of a wrong line. The
// dashboard and the popup both treat null as "show nothing".
//
// Written without sight of the live page (the build machine could not reach
// it), so the first deployed call is the real test: describePage() gives the
// function a short, safe summary to log when nothing is found, which is what a
// later fix is written from.

/** Longest name accepted. The footer shows one short line. */
export const MAX_NAME = 80;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  ndash: '–', mdash: '—', hellip: '…', middot: '·', deg: '°',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  Agrave: 'À', Egrave: 'È', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü',
  ntilde: 'ñ', ccedil: 'ç', Ccedil: 'Ç', szlig: 'ß',
};

function codePoint(n: number): string {
  // A number that is not a character prints nothing rather than throwing.
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
}

/** Turns &amp;, &egrave;, &#8217; and &#x2019; back into the characters they stand for. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const n = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(n) ? codePoint(n) : whole;
    }
    // Own names only: "&constructor;" must not reach Object.prototype.
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, ent) ? (NAMED_ENTITIES[ent] ?? whole) : whole;
  });
}

/** Text of a piece of markup: tags dropped, entities decoded, whitespace collapsed. */
function plain(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]*>/g, ' ')).replace(/[\s ]+/g, ' ').trim();
}

// Blocks that are never the page's own content: code, styling, the site's menus
// and footers, side lists and forms.
const NOISE_BLOCK =
  /<(script|style|noscript|template|svg|iframe|nav|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const MONTHS = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';
const WEEKDAYS = 'lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica';

/** "Santo del giorno", "Il santo del giorno:" and the like, at the start. */
const LABEL_PREFIX = /^\s*(?:il\s+)?santo\s+del\s+giorno\b\s*[:\-–—|·]?\s*/i;
/** "11 ottobre", "Domenica 11 ottobre 2026 -", "11/10/2026:" at the start. */
const DATE_PREFIX = new RegExp(
  `^\\s*(?:(?:${WEEKDAYS})\\s+)?\\d{1,2}\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\s*[:\\-–—,|·]?\\s*` +
    '|^\\s*\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?\\s*[:\\-–—,|·]?\\s*',
  'i',
);

/** How a saint's name starts. Anything else is not taken for one. */
const SAINT_START =
  /^(?:(?:san|santa|santo|santi|sante|beato|beata|beati|beate|venerabile|venerabili|papa)\s|sant['’]|ss?\.\s?|b\.\s?|servo di dio|serva di dio|beata vergine|madonna|maria\b|nostra signora)/i;

/** Words of the page's own furniture that a name never contains. */
const NOT_A_NAME = /\b(?:del giorno|di oggi|calendario|vatican|notizie|menu|cerca|iscriviti)\b/i;

/**
 * A short name from one line of text, or null when the line is not a saint.
 * "11 ottobre - San Giovanni XXIII, papa" gives "San Giovanni XXIII".
 */
function toName(text: string): string | null {
  let s = text;
  // A label and a date can come in either order, so strip them twice.
  for (let i = 0; i < 2; i++) s = s.replace(LABEL_PREFIX, '').replace(DATE_PREFIX, '');
  // Keep the name, drop what describes it ("..., vescovo e dottore della Chiesa").
  s = (s.split(/[,;(|]| [-–—] /)[0] ?? '').replace(/^[\s:.\-–—]+|[\s:.\-–—]+$/g, '').replace(/\s+/g, ' ');
  if (s.length < 3 || s.length > MAX_NAME) return null;
  if (!SAINT_START.test(s) || NOT_A_NAME.test(s)) return null;
  return s;
}

interface Heading {
  level: number;
  text: string;
}

function headings(html: string): Heading[] {
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(NOISE_BLOCK, ' ');
  const out: Heading[] = [];
  for (const m of body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const text = plain(m[2] ?? '');
    if (text) out.push({ level: Number(m[1]), text });
  }
  return out;
}

function metaTitles(html: string): string[] {
  const out: string[] = [];
  const og = /<meta\b[^>]*\bproperty\s*=\s*["']og:title["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i.exec(html)
    ?? /<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bproperty\s*=\s*["']og:title["']/i.exec(html);
  if (og?.[1]) out.push(plain(og[1]));
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title?.[1]) out.push(plain(title[1]));
  return out;
}

/** Index of the first heading that names the page's subject, or -1. */
function markerAt(list: Heading[]): number {
  return list.findIndex((h) => /santo\s+del\s+giorno/i.test(h.text));
}

/**
 * The saint's name from the page, or null. Headings from the "Santo del
 * giorno" heading onward are tried in order (all headings when the page has no
 * such heading), then the page's own title.
 */
export function parseSaint(html: string): string | null {
  const source = typeof html === 'string' ? html : '';
  if (!source) return null;
  const list = headings(source);
  const marker = markerAt(list);
  const candidates = [...(marker >= 0 ? list.slice(marker) : list).map((h) => h.text), ...metaTitles(source)];
  for (const text of candidates) {
    const name = toName(text);
    if (name) return name;
  }
  return null;
}

/**
 * A short, safe summary of a page that gave no saint, for the function's log:
 * its title and its first headings, each cut short. Public page text only,
 * never the page itself.
 */
export function describePage(html: string): { title: string; marker: boolean; headings: string[] } {
  const source = typeof html === 'string' ? html : '';
  const list = headings(source);
  const marker = markerAt(list);
  const shown = (marker >= 0 ? list.slice(marker) : list).slice(0, 6).map((h) => `h${h.level}: ${h.text.slice(0, 60)}`);
  return { title: (metaTitles(source).at(-1) ?? '').slice(0, 80), marker: marker >= 0, headings: shown };
}
