export type SortDir = 'asc' | 'desc';

/**
 * The next sort after a click on a column, the same rule on Snippets, Prompts
 * and Brains: clicking the active column flips its direction; clicking another
 * starts it the natural way round, A to Z for names and biggest or most recent
 * first for everything else.
 */
export function nextSort<T extends string>(
  current: { sortBy: T; sortDir: SortDir },
  column: T,
): { sortBy: T; sortDir: SortDir } {
  if (current.sortBy === column) {
    return { sortBy: column, sortDir: current.sortDir === 'asc' ? 'desc' : 'asc' };
  }
  return { sortBy: column, sortDir: column === 'name' ? 'asc' : 'desc' };
}

/** A comparison result read in the chosen direction. */
export function withDirection(comparison: number, sortDir: SortDir): number {
  return sortDir === 'asc' ? comparison : -comparison;
}
