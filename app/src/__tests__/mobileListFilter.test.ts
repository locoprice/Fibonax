import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// The phone's Snippets list is narrowed by folder and language, from its
// Filters panel. Finding something by its words is the search window's job
// (commandPalette.test.ts), so nothing here takes typed text.

const html = readFileSync(resolve(process.cwd(), 'public/mobile/index.html'), 'utf8');
const source = html.slice(html.indexOf('function assetLabelNames('), html.indexOf('/* Which variant a card shows.'));
const snip = { id: 'en', title: 'Follow up', lang: 'EN', folder_id: 'team' };
const translated = { ...snip, id: 'it', lang: 'IT', folder_id: 'other' };
const context = {
  allLabels: [{ id: 'parent', name: 'Communication' }, { id: 'child', name: 'Internal', parent_id: 'parent' }],
  snipLabelMap: { en: ['child', 'deleted'] },
  inFolderSubtree: (id: string, folder: string) => folder === 'ALL' || id === folder,
};
const api = runInNewContext(source + ';({groupMatches, assetLabelNames})', context) as {
  groupMatches: (group: { variants: Array<typeof snip> }, folder: string, lang: string) => boolean;
  assetLabelNames: (id: string, map: Record<string, string[]>, paths: boolean) => string[];
};

describe('phone list filters', () => {
  const group = { variants: [snip, translated] };

  it('lists a snippet when one of its languages sits in the folder and the language picked', () => {
    expect(api.groupMatches(group, 'ALL', 'ALL')).toBe(true);
    expect(api.groupMatches(group, 'team', 'EN')).toBe(true);
    expect(api.groupMatches(group, 'other', 'IT')).toBe(true);
    // The Italian text lives in another folder: one variant has to satisfy both.
    expect(api.groupMatches(group, 'team', 'IT')).toBe(false);
    expect(api.groupMatches(group, 'elsewhere', 'ALL')).toBe(false);
    expect(api.groupMatches(group, 'ALL', 'FR')).toBe(false);
  });

  it('names labels by their full path where asked, and drops deleted assignments', () => {
    expect(Array.from(api.assetLabelNames('en', context.snipLabelMap, true))).toEqual(['Communication / Internal']);
    expect(Array.from(api.assetLabelNames('en', context.snipLabelMap, false))).toEqual(['Internal']);
  });
});
