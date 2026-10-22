import { describe, expect, it } from 'vitest';
import {
  NO_SPACE_FILTERS,
  countActiveSpaceFilters,
  filterSpaces,
  type SpaceFilters,
} from '@/lib/spaceFilter';
import type { MemorySpace, MemorySpaceTotals } from '@/types/database';

// The Contents and Updated menus on the Brains index.

const NOW = Date.parse('2026-10-22T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

function space(id: string, updatedDaysAgo: number): MemorySpace {
  return { id, name: id, updated_at: daysAgo(updatedDaysAgo) } as MemorySpace;
}

const spaces = [space('fresh', 2), space('month', 20), space('old', 90), space('empty-fresh', 1)];
const totals = new Map<string, MemorySpaceTotals>([
  ['fresh', { items: 3, tokens: 100 }],
  ['month', { items: 1, tokens: 10 }],
  ['old', { items: 5, tokens: 500 }],
  ['empty-fresh', { items: 0, tokens: 0 }],
]);

const ids = (filters: SpaceFilters) =>
  filterSpaces(spaces, totals, filters, NOW).map((s) => s.id);

describe('filterSpaces', () => {
  it('leaves every Brain in when nothing is chosen', () => {
    expect(ids(NO_SPACE_FILTERS)).toEqual(['fresh', 'month', 'old', 'empty-fresh']);
  });

  it('Contents: with items or empty', () => {
    expect(ids({ contents: 'with-items', updated: null })).toEqual(['fresh', 'month', 'old']);
    expect(ids({ contents: 'empty', updated: null })).toEqual(['empty-fresh']);
  });

  it('treats a Brain with no totals yet as empty', () => {
    const none = filterSpaces(spaces, new Map(), { contents: 'empty', updated: null }, NOW);
    expect(none).toHaveLength(4);
  });

  it('Updated: last 7 days, last 30 days, older', () => {
    expect(ids({ contents: null, updated: 'last-7-days' })).toEqual(['fresh', 'empty-fresh']);
    expect(ids({ contents: null, updated: 'last-30-days' })).toEqual(['fresh', 'month', 'empty-fresh']);
    expect(ids({ contents: null, updated: 'older' })).toEqual(['old']);
  });

  it('puts the cut-off day on the recent side of Older', () => {
    const edge = [space('edge', 30)];
    expect(filterSpaces(edge, totals, { contents: null, updated: 'older' }, NOW)).toEqual([]);
    expect(filterSpaces(edge, totals, { contents: null, updated: 'last-30-days' }, NOW)).toHaveLength(1);
  });

  it('applies both menus together', () => {
    expect(ids({ contents: 'with-items', updated: 'last-7-days' })).toEqual(['fresh']);
    expect(ids({ contents: 'empty', updated: 'older' })).toEqual([]);
  });
});

describe('countActiveSpaceFilters', () => {
  it('counts the menus in use', () => {
    expect(countActiveSpaceFilters(NO_SPACE_FILTERS)).toBe(0);
    expect(countActiveSpaceFilters({ contents: 'empty', updated: null })).toBe(1);
    expect(countActiveSpaceFilters({ contents: 'empty', updated: 'older' })).toBe(2);
  });
});
