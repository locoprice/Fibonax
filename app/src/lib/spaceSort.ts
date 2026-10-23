import { withDirection, type SortDir } from '@/lib/sortToggle';
import type { MemorySpace, MemorySpaceTotals } from '@/types/database';

export type SpaceSortColumn = 'name' | 'updated_at' | 'items';

/**
 * Brains in the order the sort buttons ask for. The default Brain stays on top
 * whichever column is chosen, the way pinned snippets and prompts do. Name A to
 * Z is the opening order, so nothing moves until someone picks a column.
 */
export function sortSpaces(
  spaces: readonly MemorySpace[],
  totals: ReadonlyMap<string, MemorySpaceTotals>,
  sortBy: SpaceSortColumn,
  sortDir: SortDir,
): MemorySpace[] {
  return [...spaces].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    let comparison: number;
    if (sortBy === 'items') {
      comparison = (totals.get(a.id)?.items ?? 0) - (totals.get(b.id)?.items ?? 0);
    } else if (sortBy === 'updated_at') {
      comparison = a.updated_at.localeCompare(b.updated_at);
    } else {
      comparison = 0;
    }
    // Name is also the tie-break for the other columns, so equal rows keep a
    // stable, readable order.
    if (comparison === 0) {
      comparison = a.name.localeCompare(b.name);
      return sortBy === 'name' ? withDirection(comparison, sortDir) : comparison;
    }
    return withDirection(comparison, sortDir);
  });
}
