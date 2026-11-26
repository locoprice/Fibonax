import { Clock, FileText, Orbit, Trash2 } from 'lucide-react';
import { BrainIcon } from '@/components/shared/BrainIcon';
import {
  AssetFilterBar,
  ClearFiltersButton,
  FilterButton,
  FilterChip,
  FilterDropdown,
  SortControl,
} from '@/components/shared/AssetFilterBar';
import {
  CONTENTS_OPTIONS,
  UPDATED_OPTIONS,
  countActiveSpaceFilters,
} from '@/lib/spaceFilter';
import type { SpaceSortColumn } from '@/lib/spaceSort';
import { useMemoryStore } from '@/stores/memoryStore';

// The bar under the Brains header: the same bar as Prompts and Snippets, with
// the pieces a Brain has. Brains have no folders, strategies or labels, so the
// count stands where the folder chips do, Contents and Updated stand where
// Strategy and Intent do, and the Brains trash sits beside Sort. So does Atlas,
// the switch between the cards and the Brain Atlas: only Brains orbit a hub.

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
  /** The Brains are shown in orbit, in place of the cards. */
  atlasOn: boolean;
  onToggleAtlas: () => void;
}

export function BrainFilters({ count, trashCount, onOpenTrash, atlasOn, onToggleAtlas }: BrainFiltersProps) {
  const filters = useMemoryStore((s) => s.spaceFilters);
  const setSpaceFilters = useMemoryStore((s) => s.setSpaceFilters);
  const resetSpaceFilters = useMemoryStore((s) => s.resetSpaceFilters);
  const sortBy = useMemoryStore((s) => s.spaceSortBy);
  const sortDir = useMemoryStore((s) => s.spaceSortDir);
  const setSpaceSort = useMemoryStore((s) => s.setSpaceSort);
  const activeCount = countActiveSpaceFilters(filters);

  return (
    <AssetFilterBar
      end={
        <>
          {/* The orbits have an order of their own, oldest Brain closest, so Sort has nothing to sort there. */}
          {atlasOn ? null : (
            <SortControl
              options={SORT_COLUMNS}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={setSpaceSort}
            />
          )}
          <FilterButton
            active={atlasOn}
            aria-pressed={atlasOn}
            title={atlasOn ? 'Back to the cards' : 'See your Brains in orbit'}
            onClick={onToggleAtlas}
          >
            <Orbit className="h-3.5 w-3.5" aria-hidden />
            Atlas
          </FilterButton>
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
      <ClearFiltersButton count={activeCount} onClear={resetSpaceFilters} />
    </AssetFilterBar>
  );
}
