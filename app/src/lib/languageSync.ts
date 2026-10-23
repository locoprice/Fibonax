import { formatDistance } from 'date-fns';
import type { SnippetBodies, SnippetLanguage, SnippetRow } from '@/types/database';
import { snippetGroupKey } from '@/lib/snippetGrouping';

/**
 * Keeping the language versions of one snippet in step.
 *
 * A snippet holds one text per language. Editing one of them and saving leaves
 * the others saying the old thing, and nothing in the editor said so. This
 * module decides, from the text alone, which languages a save leaves behind,
 * and reads when each language was last updated from the snippet's version
 * history, which already records every language on every save. Nothing new is
 * stored anywhere.
 *
 * Multi is never compared: it is one body that mixes languages on purpose, so
 * it has no translation to fall behind.
 */

export type TranslationLanguage = Exclude<SnippetLanguage, 'MULTI'>;

export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = ['EN', 'IT', 'ES', 'FR'];

const LANGUAGE_NAME: Record<TranslationLanguage, string> = {
  EN: 'English',
  IT: 'Italian',
  ES: 'Spanish',
  FR: 'French',
};

export function languageName(language: TranslationLanguage): string {
  return LANGUAGE_NAME[language];
}

/** The text as a reader sees it: line endings and the ends of the text are not an edit. */
function clean(text: string | undefined): string {
  return (text ?? '').replace(/\r\n?/g, '\n').trim();
}

export interface LanguageSync {
  /** Languages whose existing text this save changes. */
  changed: TranslationLanguage[];
  /** Languages that keep their old text while another one changes. */
  behind: TranslationLanguage[];
}

/**
 * Which languages a save leaves behind, from the text as saved and as drafted.
 *
 * Only an edit of text that already exists counts. A language the draft adds is
 * a new translation, and one it removes is gone, so neither is behind and
 * neither makes the others so. A save that changes nothing leaves nothing
 * behind.
 */
export function checkLanguageSync(saved: SnippetBodies, draft: SnippetBodies): LanguageSync {
  const changed: TranslationLanguage[] = [];
  const unchanged: TranslationLanguage[] = [];
  for (const language of TRANSLATION_LANGUAGES) {
    const before = clean(saved[language]);
    const after = clean(draft[language]);
    if (before === '' || after === '') continue;
    if (before === after) unchanged.push(language);
    else changed.push(language);
  }
  return { changed, behind: changed.length > 0 ? unchanged : [] };
}

/** "Italian", "Italian and Spanish", "Italian, Spanish and French". */
export function joinLanguageNames(languages: readonly TranslationLanguage[]): string {
  const names = languages.map(languageName);
  const last = names[names.length - 1];
  if (last === undefined) return '';
  if (names.length === 1) return last;
  return `${names.slice(0, -1).join(', ')} and ${last}`;
}

/** The one line the editor shows, or null when nothing is behind. */
export function languageSyncNotice(sync: LanguageSync): string | null {
  if (sync.behind.length === 0) return null;
  const verb = sync.behind.length === 1 ? 'has' : 'have';
  return `${joinLanguageNames(sync.behind)} still ${verb} the old text.`;
}

/** One saved version of a snippet: when it was saved, and every language it held. */
export interface BodyHistoryEntry {
  created_at: string;
  bodies: SnippetBodies;
}

export type LanguageTimes = Partial<Record<TranslationLanguage, string>>;

/**
 * When each language's text last changed, read from the saves in `history`,
 * oldest first.
 *
 * The first save is the baseline: what the snippet held before it is not on
 * record, so every language it carries starts at that save's time instead of
 * being credited with an edit. Later, a language is stamped when its text
 * differs from the save before, and dropped when it disappears.
 *
 * `current` is the row as it stands. A write that skipped the history, such as
 * a Notion sync, shows up as text that differs from the last save, and is
 * stamped with the row's own update time. With no history at all nothing is
 * known, and nothing is returned.
 */
export function languageUpdateTimes(
  history: readonly BodyHistoryEntry[],
  current?: { bodies: SnippetBodies; updated_at: string },
): LanguageTimes {
  const times: LanguageTimes = {};
  let previous: SnippetBodies | null = null;
  for (const entry of history) {
    for (const language of TRANSLATION_LANGUAGES) {
      const text = clean(entry.bodies[language]);
      if (text === '') {
        delete times[language];
      } else if (previous === null || clean(previous[language]) !== text) {
        times[language] = entry.created_at;
      }
    }
    previous = entry.bodies;
  }
  if (previous !== null && current !== undefined) {
    for (const language of TRANSLATION_LANGUAGES) {
      const text = clean(current.bodies[language]);
      if (text !== '' && clean(previous[language]) !== text) times[language] = current.updated_at;
    }
  }
  return times;
}

/**
 * What a language's tab says when pointed at: its name, when it was last
 * updated when that is known, and whether it is behind.
 */
export function languageStatusLabel(input: {
  language: TranslationLanguage;
  behind: boolean;
  updatedAt?: string | undefined;
  now?: Date;
}): string {
  const parts = [languageName(input.language)];
  if (input.updatedAt !== undefined) {
    const ago = formatDistance(new Date(input.updatedAt), input.now ?? new Date(), {
      addSuffix: true,
    });
    parts.push(`updated ${ago}`);
  }
  const label = parts.join(', ');
  return input.behind ? `${label}. Still has the old text.` : label;
}

export interface SiblingLanguage {
  language: TranslationLanguage;
  text: string;
  /** The other row that holds this language. */
  rowId: string;
  /** When that row was last saved. */
  updatedAt: string;
}

/**
 * The languages of this snippet that live in other rows. Older snippets keep one
 * row per language, grouped by trigger, and a save of one row cannot touch the
 * others, so each of their languages stays as it is. A language the edited row
 * holds itself is never taken from a sibling, and the first sibling to hold
 * one wins.
 */
export function siblingLanguages(
  editing: SnippetRow,
  rows: readonly SnippetRow[],
): SiblingLanguage[] {
  const key = snippetGroupKey(editing);
  const found: SiblingLanguage[] = [];
  for (const row of rows) {
    if (row.id === editing.id || snippetGroupKey(row) !== key) continue;
    for (const language of TRANSLATION_LANGUAGES) {
      const text = row.bodies[language];
      if (typeof text !== 'string' || clean(text) === '') continue;
      if (clean(editing.bodies[language]) !== '') continue;
      if (found.some((sibling) => sibling.language === language)) continue;
      found.push({ language, text, rowId: row.id, updatedAt: row.updated_at });
    }
  }
  return found;
}
