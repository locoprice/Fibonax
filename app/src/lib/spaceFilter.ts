import type { MemorySpace, MemorySpaceTotals } from '@/types/database';

// What the filter menus on the Brains index offer, and how they narrow the list.
// Brains have no strategies, intents or labels, so these are the two things a
// Brain does have: whether anything is in it, and when it last changed.

export type SpaceContentsFilter = 'with-items' | 'empty';
export type SpaceUpdatedFilter = 'last-7-days' | 'last-30-days' | 'older';

export interface SpaceFilters {
  contents: SpaceContentsFilter | null;
  updated: SpaceUpdatedFilter | null;
}

export const NO_SPACE_FILTERS: SpaceFilters = { contents: null, updated: null };

export const CONTENTS_OPTIONS: ReadonlyArray<{ value: SpaceContentsFilter; label: string }> = [
  { value: 'with-items', label: 'With items' },
  { value: 'empty', label: 'Empty' },
];

export const UPDATED_OPTIONS: ReadonlyArray<{ value: SpaceUpdatedFilter; label: string }> = [
  { value: 'last-7-days', label: 'Last 7 days' },
  { value: 'last-30-days', label: 'Last 30 days' },
  { value: 'older', label: 'Older than 30 days' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many of the menus are narrowing the list. */
export function countActiveSpaceFilters(filters: SpaceFilters): number {
  return (filters.contents !== null ? 1 : 0) + (filters.updated !== null ? 1 : 0);
}

/**
 * The Brains the menus leave in. `now` is passed in so the cut-offs are the
 * same for every Brain in one pass, and so a test can fix the date.
 */
export function filterSpaces(
  spaces: readonly MemorySpace[],
  totals: ReadonlyMap<string, MemorySpaceTotals>,
  filters: SpaceFilters,
  now: number = Date.now(),
): MemorySpace[] {
  return spaces.filter((space) => {
    if (filters.contents !== null) {
      const items = totals.get(space.id)?.items ?? 0;
      if (filters.contents === 'with-items' ? items === 0 : items > 0) return false;
    }
    if (filters.updated !== null) {
      const age = now - Date.parse(space.updated_at);
      if (filters.updated === 'last-7-days' && age > 7 * DAY_MS) return false;
      if (filters.updated === 'last-30-days' && age > 30 * DAY_MS) return false;
      if (filters.updated === 'older' && age <= 30 * DAY_MS) return false;
    }
    return true;
  });
}
