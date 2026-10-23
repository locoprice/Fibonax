import { withDirection, type SortDir } from '@/lib/sortToggle';
import type { Prompt } from '@/types/database';

export type PromptSortColumn = 'updated_at' | 'usage_count' | 'name';

/**
 * Prompts in the order the sort buttons ask for. Pinned prompts stay on top
 * whichever column is chosen, as pinned snippets do; the rest follow the
 * column, with ties kept in their incoming order.
 */
export function sortPrompts(
  prompts: readonly Prompt[],
  sortBy: PromptSortColumn,
  sortDir: SortDir,
): Prompt[] {
  return [...prompts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    let comparison: number;
    if (sortBy === 'name') comparison = a.name.localeCompare(b.name);
    else if (sortBy === 'usage_count') comparison = a.usage_count - b.usage_count;
    else comparison = a.updated_at.localeCompare(b.updated_at);
    return withDirection(comparison, sortDir);
  });
}
