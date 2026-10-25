/**
 * Fill from link: where on a pasted web page a field's value sits.
 *
 * A field token carries the rule as its last attribute:
 *   `{formtext: name=QTY; type=number; default=0; link=before:Boxes|Box}`
 *   `{formdate: name=DATE_1; format=long; link=after:Start date}`
 * Two ways to point at a value, both described in the author's own words, so
 * the product itself names no trade:
 *
 *   after:LABEL    the text right after the label LABEL
 *   before:WORD    every number written right before WORD, added up
 *
 * `|` separates other spellings of the same thing (a page writes "1 Box" but
 * "2 Boxes"). A rule with no `after:` / `before:` is a bare label and reads as
 * `after:`, which is what a label usually means.
 *
 * MIRRORED from `sbParseLinkRule` and `_linkValue` in
 * `extension/formula-engine.js`, which is what the fill form reads at expansion
 * time; this copy exists so the builders can write and read the rule without
 * importing extension source (app/CLAUDE.md §6). `src/__tests__/fillFromLink.test.ts`
 * pins the two against each other.
 */

export type LinkMode = 'after' | 'before';

export const LINK_MODES: readonly LinkMode[] = ['after', 'before'];

/**
 * What every builder but Number offers: the value after a label. A date, a
 * choice and a piece of text follow their label on a page ("Start date: 9
 * October", "Plan: Standard"). Adding up the numbers before a word makes a
 * count, and a count is a Number field (root CLAUDE.md, Industry-Neutral:
 * quantities are numeric fields, never text).
 */
export const LABEL_LINK_MODES: readonly LinkMode[] = ['after'];

export interface LinkRule {
  mode: LinkMode;
  /** The label or word(s), each one a spelling the page may use. Never empty. */
  words: string[];
}

function isLinkMode(value: string): value is LinkMode {
  return (LINK_MODES as readonly string[]).includes(value);
}

/**
 * A `link=` value as `{ mode, words }`, or null when it says nothing usable.
 *
 * `;` and `}` end the attribute and the token, `{` opens another, and a line
 * break would split the token across two lines of the body, so all four read
 * as a space, exactly as the engine reads them.
 */
export function parseLinkRule(raw: string | null | undefined): LinkRule | null {
  const v = String(raw ?? '')
    .replace(/[;{}\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
  if (v === '') return null;
  let mode: LinkMode = 'after';
  let rest = v;
  const colon = v.indexOf(':');
  if (colon > -1) {
    const head = v.slice(0, colon).replace(/^\s+|\s+$/g, '').toLowerCase();
    if (isLinkMode(head)) {
      mode = head;
      rest = v.slice(colon + 1);
    }
  }
  const words: string[] = [];
  for (const part of rest.split('|')) {
    const word = part.replace(/^\s+|\s+$/g, '');
    if (word !== '' && !words.includes(word)) words.push(word);
  }
  return words.length ? { mode, words } : null;
}

/**
 * The rule in its one written spelling (`before:Boxes|Box`), or '' when there
 * is none. What every writer emits, so a token read and written back comes out
 * identical.
 */
export function linkValue(raw: string | null | undefined): string {
  const rule = parseLinkRule(raw);
  return rule ? `${rule.mode}:${rule.words.join('|')}` : '';
}

/** The `link=` a token's settings carry, in its written spelling, or ''. */
export function readLinkAttr(attrs: string): string {
  const match = /(?:^|;)\s*link\s*=\s*([^;]+)/i.exec(attrs);
  return match ? linkValue(match[1]) : '';
}

/** Where a field token's settings start: right after the colon of its head. */
function settingsStart(token: string): number {
  return token.indexOf(':') + 1;
}

/** The rule a field token carries, in its written spelling, or ''. */
export function tokenLink(token: string): string {
  const start = settingsStart(token);
  const close = token.lastIndexOf('}');
  if (start === 0 || close < start) return '';
  return readLinkAttr(token.slice(start, close));
}

/**
 * The token with its rule set to `link`, or taken out when `link` says nothing
 * usable. Only the `link=` setting moves: a rule already there is changed where
 * it sits, a new one goes last, and every other setting is left exactly as
 * written. That is what lets the Fill from a web page window change a field it
 * has no builder for, such as one written by hand.
 */
export function withTokenLink(token: string, link: string): string {
  const value = linkValue(link);
  const start = settingsStart(token);
  const close = token.lastIndexOf('}');
  if (start === 0 || close < start) return token;
  // The first setting follows the head's colon, every other one a `;`. A colon
  // anywhere else is part of a value ("after:Start date") and never a start.
  const setting = /([:;])(\s*)link\s*=[^;}]*/gi;
  let found: RegExpExecArray | null = null;
  for (let m = setting.exec(token); m; m = setting.exec(token)) {
    if (m.index >= close) break;
    if (m[1] === ';' || m.index === start - 1) {
      found = m;
      break;
    }
  }
  if (!found) {
    return value === '' ? token : `${token.slice(0, close)}; link=${value}${token.slice(close)}`;
  }
  const at = found.index;
  const end = at + found[0].length;
  if (value !== '') {
    return `${token.slice(0, at)}${found[1]}${found[2] || ' '}link=${value}${token.slice(end)}`;
  }
  // Taken out whole, with the `;` that joined it to the settings around it.
  if (found[1] === ';') return token.slice(0, at) + token.slice(end);
  return token.slice(0, at + 1) + token.slice(end).replace(/^\s*;/, '');
}
