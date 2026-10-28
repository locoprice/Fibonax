import { describe, expect, it } from 'vitest';
import {
  checkLanguageSync,
  joinLanguageNames,
  languageStatusLabel,
  languageSyncNotice,
  languageUpdateTimes,
  siblingLanguages,
  type BodyHistoryEntry,
} from '@/lib/languageSync';
import type { SnippetBodies, SnippetLanguage, SnippetRow } from '@/types/database';

const HELLO: SnippetBodies = { EN: 'Hello there', IT: 'Ciao a tutti', ES: 'Hola a todos' };

describe('checkLanguageSync', () => {
  it('leaves the others behind when one language is edited', () => {
    const sync = checkLanguageSync(HELLO, { ...HELLO, EN: 'Hello, friend' });
    expect(sync.changed).toEqual(['EN']);
    expect(sync.behind).toEqual(['IT', 'ES']);
  });

  it('is satisfied once every language that exists was edited together', () => {
    const sync = checkLanguageSync(HELLO, { EN: 'Hello, friend', IT: 'Ciao, amico', ES: 'Hola, amigo' });
    expect(sync.changed).toEqual(['EN', 'IT', 'ES']);
    expect(sync.behind).toEqual([]);
  });

  it('names only the languages still untouched', () => {
    const sync = checkLanguageSync(HELLO, { ...HELLO, EN: 'Hello, friend', IT: 'Ciao, amico' });
    expect(sync.changed).toEqual(['EN', 'IT']);
    expect(sync.behind).toEqual(['ES']);
  });

  it('works in both directions: a translation edited alone leaves English behind', () => {
    const sync = checkLanguageSync(HELLO, { ...HELLO, IT: 'Ciao, amico' });
    expect(sync.changed).toEqual(['IT']);
    expect(sync.behind).toEqual(['EN', 'ES']);
  });

  it('says nothing when nothing was edited', () => {
    expect(checkLanguageSync(HELLO, { ...HELLO })).toEqual({ changed: [], behind: [] });
  });

  it('says nothing about a snippet with one language', () => {
    expect(checkLanguageSync({ EN: 'Hello' }, { EN: 'Hello again' })).toEqual({
      changed: ['EN'],
      behind: [],
    });
  });

  it('does not count a new translation as an edit, nor as being behind', () => {
    const sync = checkLanguageSync({ EN: 'Hello' }, { EN: 'Hello again', IT: 'Ciao di nuovo' });
    expect(sync.changed).toEqual(['EN']);
    expect(sync.behind).toEqual([]);
  });

  it('does not count a removed translation as being behind', () => {
    const sync = checkLanguageSync(HELLO, { EN: 'Hello, friend', ES: 'Hola a todos' });
    expect(sync.changed).toEqual(['EN']);
    expect(sync.behind).toEqual(['ES']);
  });

  it('ignores line endings and the ends of the text', () => {
    const saved = { EN: 'One\nTwo', IT: 'Uno\nDue' };
    const draft = { EN: '  One\r\nTwo\n', IT: 'Uno\nDue' };
    expect(checkLanguageSync(saved, draft)).toEqual({ changed: [], behind: [] });
  });

  it('never compares Multi, which is one body that mixes languages', () => {
    const sync = checkLanguageSync(
      { EN: 'Hello', MULTI: 'Hello / Ciao' },
      { EN: 'Hello again', MULTI: 'Hello / Ciao' },
    );
    expect(sync).toEqual({ changed: ['EN'], behind: [] });
    expect(checkLanguageSync({ EN: 'Hello', MULTI: 'a' }, { EN: 'Hello', MULTI: 'b' })).toEqual({
      changed: [],
      behind: [],
    });
  });

  it('reports languages in a fixed order', () => {
    const saved = { FR: 'Bonjour', ES: 'Hola', IT: 'Ciao', EN: 'Hello' };
    const sync = checkLanguageSync(saved, { ...saved, ES: 'Hola otra vez' });
    expect(sync.behind).toEqual(['EN', 'IT', 'FR']);
  });
});

describe('the notice', () => {
  it('names one, two and three languages', () => {
    expect(joinLanguageNames(['IT'])).toBe('Italian');
    expect(joinLanguageNames(['IT', 'ES'])).toBe('Italian and Spanish');
    expect(joinLanguageNames(['IT', 'ES', 'FR'])).toBe('Italian, Spanish and French');
    expect(joinLanguageNames([])).toBe('');
  });

  it('agrees with the number of languages', () => {
    expect(languageSyncNotice({ changed: ['EN'], behind: ['IT'] })).toBe(
      'Italian still has the old text.',
    );
    expect(languageSyncNotice({ changed: ['EN'], behind: ['IT', 'ES'] })).toBe(
      'Italian and Spanish still have the old text.',
    );
  });

  it('is absent when nothing is behind', () => {
    expect(languageSyncNotice({ changed: ['EN'], behind: [] })).toBeNull();
  });
});

describe('languageUpdateTimes', () => {
  const save = (created_at: string, bodies: SnippetBodies): BodyHistoryEntry => ({ created_at, bodies });

  it('knows nothing without history', () => {
    expect(languageUpdateTimes([])).toEqual({});
    expect(languageUpdateTimes([], { bodies: HELLO, updated_at: '2026-10-01T00:00:00Z' })).toEqual({});
  });

  it('starts every language at the first save, the earliest time on record', () => {
    expect(languageUpdateTimes([save('2026-01-01T00:00:00Z', HELLO)])).toEqual({
      EN: '2026-01-01T00:00:00Z',
      IT: '2026-01-01T00:00:00Z',
      ES: '2026-01-01T00:00:00Z',
    });
  });

  it('stamps only the language whose text changed', () => {
    const times = languageUpdateTimes([
      save('2026-01-01T00:00:00Z', HELLO),
      save('2026-03-01T00:00:00Z', { ...HELLO, EN: 'Hello, friend' }),
    ]);
    expect(times).toEqual({
      EN: '2026-03-01T00:00:00Z',
      IT: '2026-01-01T00:00:00Z',
      ES: '2026-01-01T00:00:00Z',
    });
  });

  it('keeps the older time through a save that changes something else', () => {
    const times = languageUpdateTimes([
      save('2026-01-01T00:00:00Z', HELLO),
      save('2026-03-01T00:00:00Z', { ...HELLO, EN: 'Hello, friend' }),
      save('2026-05-01T00:00:00Z', { ...HELLO, EN: 'Hello, friend' }),
    ]);
    expect(times.EN).toBe('2026-03-01T00:00:00Z');
  });

  it('does not stamp a change in line endings or spacing', () => {
    const times = languageUpdateTimes([
      save('2026-01-01T00:00:00Z', { EN: 'One\nTwo' }),
      save('2026-03-01T00:00:00Z', { EN: 'One\r\nTwo ' }),
    ]);
    expect(times.EN).toBe('2026-01-01T00:00:00Z');
  });

  it('stamps a language when it is added, and forgets it when it is removed', () => {
    const times = languageUpdateTimes([
      save('2026-01-01T00:00:00Z', { EN: 'Hello', IT: 'Ciao' }),
      save('2026-02-01T00:00:00Z', { EN: 'Hello', ES: 'Hola' }),
    ]);
    expect(times).toEqual({ EN: '2026-01-01T00:00:00Z', ES: '2026-02-01T00:00:00Z' });
  });

  it('stamps text that changed without a save on record with the row time', () => {
    const times = languageUpdateTimes([save('2026-01-01T00:00:00Z', HELLO)], {
      bodies: { ...HELLO, IT: 'Ciao di nuovo' },
      updated_at: '2026-04-01T00:00:00Z',
    });
    expect(times.IT).toBe('2026-04-01T00:00:00Z');
    expect(times.EN).toBe('2026-01-01T00:00:00Z');
  });
});

describe('languageStatusLabel', () => {
  const now = new Date('2026-10-22T12:00:00Z');

  it('names the language and when it was updated', () => {
    expect(
      languageStatusLabel({ language: 'IT', behind: false, updatedAt: '2026-07-22T12:00:00Z', now }),
    ).toBe('Italian, updated 3 months ago');
  });

  it('says so when the language is behind', () => {
    expect(
      languageStatusLabel({ language: 'ES', behind: true, updatedAt: '2026-10-19T12:00:00Z', now }),
    ).toBe('Spanish, updated 3 days ago. Still has the old text.');
  });

  it('leaves the time out when it is not known', () => {
    expect(languageStatusLabel({ language: 'FR', behind: true, now })).toBe(
      'French. Still has the old text.',
    );
    expect(languageStatusLabel({ language: 'EN', behind: false, now })).toBe('English');
  });
});

describe('siblingLanguages', () => {
  function row(
    id: string,
    trigger: string,
    language: SnippetLanguage,
    bodies: SnippetBodies,
    updatedAt = '2026-06-10T00:00:00Z',
  ): SnippetRow {
    return {
      organization_id: null,
      review_status: 'approved',
      reviewed_by: null,
      reviewed_at: null,
      id,
      user_id: 'u1',
      name: 'Greeting',
      content: bodies[language] ?? '',
      bodies,
      triggers: [trigger],
      is_formula: false,
      formula: null,
      variables: {},
      folder_id: null,
      language,
      lang_group_id: null,
      notion_page_id: null,
      pinned: false,
      is_active: true,
      check_unfinished: true,
      alternative_queries: [],
      updated_at: updatedAt,
      updated_by: 'u1',
      folder_name: null,
      usage_count: 0,
      is_malformed: false,
      created_at: updatedAt,
      last_used_at: null,
    };
  }

  it('finds the languages that live in the other rows of the same snippet', () => {
    const en = row('en', '::hello', 'EN', { EN: 'Hello' });
    const it = row('it', '::hello', 'IT', { IT: 'Ciao' }, '2026-03-01T00:00:00Z');
    const other = row('x', '::bye', 'IT', { IT: 'Arrivederci' });
    expect(siblingLanguages(en, [en, it, other])).toEqual([
      { language: 'IT', text: 'Ciao', rowId: 'it', updatedAt: '2026-03-01T00:00:00Z' },
    ]);
  });

  it('lets a save of one row leave the language of its sibling behind', () => {
    const en = row('en', '::hello', 'EN', { EN: 'Hello' });
    const it = row('it', '::hello', 'IT', { IT: 'Ciao' });
    const siblings = siblingLanguages(en, [en, it]);
    const around = Object.fromEntries(siblings.map((s) => [s.language, s.text]));
    const sync = checkLanguageSync({ ...around, ...en.bodies }, { ...around, EN: 'Hello again' });
    expect(sync.behind).toEqual(['IT']);
  });

  it('never takes a language the edited row holds itself', () => {
    const en = row('en', '::hello', 'EN', { EN: 'Hello', IT: 'Ciao' });
    const it = row('it', '::hello', 'IT', { IT: 'Salve' });
    expect(siblingLanguages(en, [en, it])).toEqual([]);
  });

  it('takes a language from the first sibling that holds it', () => {
    const en = row('en', '::hello', 'EN', { EN: 'Hello' });
    const first = row('a', '::hello', 'ES', { ES: 'Hola' });
    const second = row('b', '::hello', 'ES', { ES: 'Buenas' });
    expect(siblingLanguages(en, [en, first, second]).map((s) => s.rowId)).toEqual(['a']);
  });

  it('finds nothing for a snippet that stands alone', () => {
    const en = row('en', '::hello', 'EN', { EN: 'Hello' });
    expect(siblingLanguages(en, [en])).toEqual([]);
  });
});
