import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'public/mobile/index.html'), 'utf8');
const source = html.slice(html.indexOf('function assetLabelNames('), html.indexOf('/* Which variant a card shows.'));
// The phone matches through its inlined copy of extension/shared/asset-search.js.
const searchModule = { exports: {} };
(new Function('module', 'exports', readFileSync(resolve(process.cwd(), '../extension/shared/asset-search.js'), 'utf8')) as (
  m: typeof searchModule,
  e: unknown,
) => void)(searchModule, searchModule.exports);
const snip = { id: 'en', title: 'Follow up', shortcut: 'foll', body: 'Hello, the parking is behind the office.', lang: 'EN', folder_id: 'team', alternative_queries: ['reminder', 'status update'] };
const translated = { ...snip, id: 'it', lang: 'IT', body: 'Ciao', alternative_queries: ['promemoria'] };
const context = {
  SBAssetSearch: searchModule.exports,
  allLabels: [{ id: 'parent', name: 'Communication' }, { id: 'child', name: 'Internal', parent_id: 'parent' }],
  snipLabelMap: { en: ['child', 'deleted'] },
  inFolderSubtree: (id: string, folder: string) => folder === 'ALL' || id === folder,
};
const api = runInNewContext(source + ';({groupMatches, assetLabelNames, snippetLook, searchWhyHtml})', context) as {
  groupMatches: (group: { variants: typeof snip[] }, query: string, folder: string, lang: string) => boolean;
  assetLabelNames: (id: string, map: Record<string, string[]>, paths: boolean) => string[];
  snippetLook: (s: typeof snip, query: string) => { rank: number; why: unknown } | null;
  searchWhyHtml: (look: { rank: number; why: unknown } | null) => string;
};

describe('phone metadata search', () => {
  const group = { variants: [snip, translated] };
  it('finds hidden synonyms and labels while respecting the matching variant’s filters', () => {
    expect(api.groupMatches(group, 'reminder', 'team', 'EN')).toBe(true);
    expect(api.groupMatches(group, 'internal', 'ALL', 'EN')).toBe(true);
    expect(api.groupMatches(group, 'reminder', 'other', 'EN')).toBe(false);
    expect(api.groupMatches(group, 'reminder', 'ALL', 'IT')).toBe(false);
    expect(api.groupMatches(group, 'promemoria', 'ALL', 'IT')).toBe(true);
  });
  it('keeps full label paths in details and drops deleted assignments', () => {
    expect(Array.from(api.assetLabelNames('en', context.snipLabelMap, true))).toEqual(['Communication / Internal']);
    expect(api.searchWhyHtml(api.snippetLook(snip, 'reminder'))).toBe('<div class="search-match">Keyword: reminder</div>');
    expect(api.searchWhyHtml(api.snippetLook(snip, 'internal'))).toBe('<div class="search-match">Label: Internal</div>');
    expect(api.searchWhyHtml(api.snippetLook(snip, 'follow'))).toBe('');
  });
  it('finds a word inside the text, every word in any order, and shows the sentence', () => {
    expect(api.groupMatches(group, 'parking', 'ALL', 'EN')).toBe(true);
    expect(api.groupMatches(group, 'office parking follow', 'ALL', 'EN')).toBe(true);
    expect(api.groupMatches(group, 'parking refund', 'ALL', 'EN')).toBe(false);
    expect(api.searchWhyHtml(api.snippetLook(snip, 'parking'))).toBe(
      '<div class="search-match">Hello, the <mark>parking</mark> is behind the office.</div>',
    );
  });
});
