import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  AssetFilterBar,
  ClearFiltersButton,
  FilterChip,
  FilterChipGroup,
  FilterDivider,
  SortControl,
} from '@/components/shared/AssetFilterBar';
import { LabelFilter } from '@/features/labels/LabelFilter';
import { normalizeQuery } from '@/lib/searchIndex';
import { useSearchStore } from '@/stores/searchStore';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import type { SortColumn } from '@/stores/snippetStore';
import type { Snippet } from '@/types/database';

const LANGUAGE_CHIPS: Array<{ value: Snippet['language']; label: string }> = [
  { value: 'EN',    label: 'EN' },
  { value: 'ES',    label: 'ES' },
  { value: 'IT',    label: 'IT' },
  { value: 'MULTI', label: 'Multi' },
];

const SORT_COLUMNS: Array<{ value: SortColumn; label: string }> = [
  { value: 'name',        label: 'Name' },
  { value: 'updated_at',  label: 'Updated' },
  { value: 'usage_count', label: 'Usage' },
];

export function FilterToolbar() {
  const languageFilter = useSnippetStore((s) => s.languageFilter);
  const setLanguageFilter = useSnippetStore((s) => s.setLanguageFilter);
  const labelFilter = useSnippetStore((s) => s.labelFilter);
  const setLabelFilter = useSnippetStore((s) => s.setLabelFilter);
  const openLabelManager = useUiStore((s) => s.openLabelManager);
  const sortBy = useSnippetStore((s) => s.sortBy);
  const sortDir = useSnippetStore((s) => s.sortDir);
  const setSortBy = useSnippetStore((s) => s.setSortBy);
  // Moved here when the page lost its own search box (SEARCH-001): on its own
  // it was a lone button on an otherwise empty row.
  const railOpen = useUiStore((s) => s.foldersRailOpen);
  const setRailOpen = useUiStore((s) => s.setFoldersRailOpen);
  // The search text lives in the header bar, but it narrows this list, so it
  // counts as a filter and "Clear" empties it too, as on Prompts.
  const searching = useSearchStore((s) => normalizeQuery(s.query) !== '');
  const clearSearch = useSearchStore((s) => s.clear);
  const activeCount =
    (languageFilter !== null ? 1 : 0) + (labelFilter.length > 0 ? 1 : 0) + (searching ? 1 : 0);

  return (
    <AssetFilterBar
      end={
        <>
          <ClearFiltersButton
            count={activeCount}
            onClear={() => {
              setLanguageFilter(null);
              setLabelFilter([]);
              clearSearch();
            }}
          />
          <SortControl
            options={SORT_COLUMNS}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={setSortBy}
          />
        </>
      }
    >
      <button
        type="button"
        onClick={() => setRailOpen(!railOpen)}
        aria-pressed={railOpen}
        title={railOpen ? 'Hide folders' : 'Show folders'}
        aria-label={railOpen ? 'Hide folders' : 'Show folders'}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-muted transition-colors hover:bg-bg-alt hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {railOpen ? (
          <PanelLeftClose className="h-4 w-4" aria-hidden />
        ) : (
          <PanelLeftOpen className="h-4 w-4" aria-hidden />
        )}
      </button>

      <FilterDivider />

      <FilterChipGroup label="Filter by language">
        <FilterChip
          label="All"
          active={languageFilter === null}
          onClick={() => setLanguageFilter(null)}
        />
        {LANGUAGE_CHIPS.map((chip) => (
          <FilterChip
            key={chip.value}
            label={chip.label}
            active={languageFilter === chip.value}
            onClick={() => setLanguageFilter(chip.value === languageFilter ? null : chip.value)}
          />
        ))}
      </FilterChipGroup>

      <LabelFilter
        selected={labelFilter}
        onChange={setLabelFilter}
        onManage={openLabelManager}
      />
    </AssetFilterBar>
  );
}
