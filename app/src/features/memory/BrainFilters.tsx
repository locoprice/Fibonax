import { Clock, FileText, Trash2 } from 'lucide-react';
import { BrainIcon } from '@/components/shared/BrainIcon';
import {
  AssetFilterBar,
  ClearFiltersButton,
  FilterButton,
  FilterChip,
  FilterDropdown,
  SortControl,
} from '@/components/shared/AssetFilterBar';
import { normalizeQuery } from '@/lib/searchIndex';
import {
  CONTENTS_OPTIONS,
  UPDATED_OPTIONS,
  countActiveSpaceFilters,
} from '@/lib/spaceFilter';
import type { SpaceSortColumn } from '@/lib/spaceSort';
import { useMemoryStore } from '@/stores/memoryStore';
import { useSearchStore } from '@/stores/searchStore';

// The bar under the Brains header: the same bar as Prompts and Snippets, with
// the pieces a Brain has. Brains have no folders, strategies or labels, so the
// count stands where the folder chips do, Contents and Updated stand where
// Strategy and Intent do, and the Brains trash sits beside Sort.

const SORT_COLUMNS: Array<{ value: SpaceSortColumn; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'updated_at', label: 'Updated' },
  { value: 'items', label: 'Items' },
];

interface BrainFiltersProps {
  /** Left out until the first load finishes: "0 Brains" beside a spinner reads as an answer. */
  count: number | undefined;
  trashCount: number;
  onOpenTrash: () => void;
}

export function BrainFilters({ count, trashCount, onOpenTrash }: BrainFiltersProps) {
  const filters = useMemoryStore((s) => s.spaceFilters);
  const setSpaceFilters = useMemoryStore((s) => s.setSpaceFilters);
  const resetSpaceFilters = useMemoryStore((s) => s.resetSpaceFilters);
  const sortBy = useMemoryStore((s) => s.spaceSortBy);
  const sortDir = useMemoryStore((s) => s.spaceSortDir);
  const setSpaceSort = useMemoryStore((s) => s.setSpaceSort);
  // The one search bar in the header owns the text (SEARCH-001). It narrows
  // this list, so it counts as a filter and "Clear" empties it, as on Prompts.
  const searching = useSearchStore((s) => normalizeQuery(s.query) !== '');
  const clearSearch = useSearchStore((s) => s.clear);
  const activeCount = countActiveSpaceFilters(filters) + (searching ? 1 : 0);

  return (
    <AssetFilterBar
      end={
        <>
          <SortControl
            options={SORT_COLUMNS}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={setSpaceSort}
          />
          <FilterButton onClick={onOpenTrash}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {trashCount > 0 ? `Trash (${trashCount})` : 'Trash'}
          </FilterButton>
        </>
      }
    >
      <FilterChip
        active
        label="All Brains"
        count={count}
        icon={<BrainIcon className="h-3.5 w-3.5 shrink-0" />}
      />
      <FilterDropdown
        label="Contents"
        icon={<FileText className="h-3.5 w-3.5" aria-hidden />}
        value={filters.contents}
        options={CONTENTS_OPTIONS}
        onSelect={(contents) => setSpaceFilters({ contents })}
      />
      <FilterDropdown
        label="Updated"
        icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
        value={filters.updated}
        options={UPDATED_OPTIONS}
        onSelect={(updated) => setSpaceFilters({ updated })}
      />
      <ClearFiltersButton
        count={activeCount}
        onClear={() => {
          resetSpaceFilters();
          clearSearch();
        }}
      />
    </AssetFilterBar>
  );
}
