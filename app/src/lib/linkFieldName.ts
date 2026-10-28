/**
 * The name a field added from the Fill from a pasted link entry gets: the
 * word it reads on the page, as a field name. "Customer" makes CUSTOMER and
 * "Start date" makes START_DATE, so the form and the text say what the field
 * is; a generic TEXT_1 said nothing to the person filling it in.
 *
 * The word is the author's own, so the name stays as neutral as what they
 * typed (root CLAUDE.md, Industry-Neutral). A word that cannot be a name, or
 * one the snippet already uses, falls back to the generic name the kind's
 * builder would have given.
 */

import { isValidMenuName } from '@/lib/formMenuToken';

const NAME_MAX_LENGTH = 40;

/** Whether `name` is already a field, a placeholder or a saved value in the body. */
export function fieldNameTaken(body: string, name: string): boolean {
  const word = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `name\\s*=\\s*${word}(?![A-Za-z0-9_])|\\{\\{?\\s*${word}\\s*(?:\\}|=)`,
    'i',
  ).test(body);
}

/**
 * The name for a field reading `words` (the first spelling, when several are
 * given with `|`), or `fallback` when the word makes no usable name or the
 * body already has one by that name.
 */
export function fieldNameFromWords(words: string, body: string, fallback: string): string {
  const first = words.split('|')[0] ?? '';
  const name = first
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, NAME_MAX_LENGTH)
    .replace(/_+$/, '');
  if (name === '' || !/^[A-Z]/.test(name) || !isValidMenuName(name)) return fallback;
  return fieldNameTaken(body, name) ? fallback : name;
}
