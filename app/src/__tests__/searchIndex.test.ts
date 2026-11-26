import { describe, expect, it } from 'vitest';
import { labelNameLookup, sectionForPath, spaceForPath } from '@/lib/searchIndex';
import type { Label } from '@/types/database';

// What the search bar and the search window read about the page in view, and
// the label names they hand the shared search rule. What matches is tested
// where it is decided: assetSearch.test.ts and commandPalette.test.ts.

describe('sectionForPath', () => {
  it('maps each section route to its type', () => {
    expect(sectionForPath('/')).toBe('snippet');
    expect(sectionForPath('/prompts')).toBe('prompt');
    expect(sectionForPath('/memory')).toBe('memory');
    expect(sectionForPath('/memory/space-1')).toBe('memory');
  });

  it('returns null on a page that holds none of the three', () => {
    expect(sectionForPath('/analytics')).toBeNull();
    expect(sectionForPath('/settings')).toBeNull();
    expect(sectionForPath('/team')).toBeNull();
  });
});

describe('spaceForPath', () => {
  it('picks out the space being viewed', () => {
    expect(spaceForPath('/memory/space-1')).toBe('space-1');
  });

  it('is null on the index and off the memory route', () => {
    expect(spaceForPath('/memory')).toBeNull();
    expect(spaceForPath('/prompts')).toBeNull();
  });
});

describe('labelNameLookup', () => {
  function label(id: string, name: string): Label {
    return {
      id,
      user_id: 'u1',
      name,
      color: 'azure',
      parent_id: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };
  }
  const catalog = [label('l1', 'Clients'), label('l2', 'Finance')];
  const assignments = new Map<string, string[]>([
    ['s1', ['l2', 'l1']],
    ['s2', ['gone', 'l1']],
    ['s3', []],
  ]);
  const namesFor = labelNameLookup(catalog, assignments);

  it('names the labels an item carries, in the order they were given', () => {
    expect(namesFor('s1')).toEqual(['Finance', 'Clients']);
  });

  it('leaves out a label that no longer exists', () => {
    expect(namesFor('s2')).toEqual(['Clients']);
  });

  it('answers with nothing for an item without labels, or one it has never seen', () => {
    expect(namesFor('s3')).toEqual([]);
    expect(namesFor('unknown')).toEqual([]);
  });
});
