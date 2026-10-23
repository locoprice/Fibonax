import { memo, useMemo } from 'react';
import { Lightbulb, Target } from 'lucide-react';
import { PromptIcon } from '@/components/shared/PromptIcon';
import {
  AssetFilterBar,
  ClearFiltersButton,
  FilterChip,
  FilterChipGroup,
  FilterDropdown,
  SortControl,
  plainOptions,
} from '@/components/shared/AssetFilterBar';
import { FolderIcon } from '@/lib/folderIcons';
import { FolderShareBadge } from '@/features/org/FolderTree';
import { LabelFilter } from '@/features/labels/LabelFilter';
import { usePromptStore, useActiveFilterCount } from '@/stores/promptStore';
import { useSearchStore } from '@/stores/searchStore';
import type { PromptSortColumn } from '@/lib/promptSort';
import type { Folder, IntentCategory, Prompt, StrategyType } from '@/types/database';

const STRATEGIES: StrategyType[] = ['CoT', 'ToT', 'Few-shot', 'One-shot', 'RAG', 'Agentic'];
const INTENTS: IntentCategory[] = ['Writing', 'Coding', 'Support', 'SEO', 'Analysis', 'Planning', 'Research', 'Teaching'];
const STRATEGY_OPTIONS = plainOptions(STRATEGIES);
const INTENT_OPTIONS = plainOptions(INTENTS);

/**
 * Folders eligible for the chip row: those holding ≥1 prompt, plus the
 * currently selected one even at count 0 — an active filter must never
 * hide its own control.
 */
export function visiblePromptFolders(
  folders: Folder[],
  prompts: Prompt[],
  selectedFolderId: string | null,
): { folder: Folder; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of prompts) {
    if (p.folder_id) counts.set(p.folder_id, (counts.get(p.folder_id) ?? 0) + 1);
  }
  return folders
    .filter((f) => (counts.get(f.id) ?? 0) > 0 || f.id === selectedFolderId)
    .map((f) => ({ folder: f, count: counts.get(f.id) ?? 0 }));
}

const SORT_COLUMNS: Array<{ value: PromptSortColumn; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'updated_at', label: 'Updated' },
  { value: 'usage_count', label: 'Usage' },
];

/**
 * Folder filter chips. Folders are a shared container (snippets + prompts), so
 * only folders actually holding prompts render here — the snippet taxonomy
 * never shows up empty on this page. The selected folder stays visible even at
 * count 0 so an active filter can't hide its own control.
 */
function FolderChips() {
  const folders = usePromptStore((s) => s.folders);
  const folderShares = usePromptStore((s) => s.folderShares);
  const prompts = usePromptStore((s) => s.prompts);
  const selected = usePromptStore((s) => s.selectedFolderId);
  const setSelected = usePromptStore((s) => s.setSelectedFolder);

  const visible = useMemo(
    () => visiblePromptFolders(folders, prompts, selected),
    [folders, prompts, selected],
  );
  if (visible.length === 0) return null;

  return (
    <FilterChipGroup label="Filter by folder">
      <FilterChip
        active={selected === null}
        onClick={() => setSelected(null)}
        label="All prompts"
        count={prompts.length}
        icon={<PromptIcon className="h-3.5 w-3.5 shrink-0" />}
      />
      {visible.map(({ folder, count }) => {
        const share = folderShares.get(folder.id);
        return (
          <FilterChip
            key={folder.id}
            active={selected === folder.id}
            onClick={() => setSelected(selected === folder.id ? null : folder.id)}
            label={folder.name}
            count={count}
            icon={<FolderIcon icon={folder.icon} className="h-3.5 w-3.5" />}
            badge={share ? <FolderShareBadge info={share} /> : undefined}
          />
        );
      })}
    </FilterChipGroup>
  );
}

interface PromptFiltersProps {
  /**
   * Open the label manager. Passed down from the page rather than read from
   * uiStore: this module is imported by a pure-logic test for
   * `visiblePromptFolders`, and uiStore's theme bootstrap touches localStorage
   * at module load.
   */
  onManageLabels: () => void;
}

export const PromptFilters = memo(function PromptFilters({ onManageLabels }: PromptFiltersProps) {
  const filters = usePromptStore((s) => s.filters);
  const setFilters = usePromptStore((s) => s.setFilters);
  const resetFilters = usePromptStore((s) => s.resetFilters);
  const sortBy = usePromptStore((s) => s.sortBy);
  const sortDir = usePromptStore((s) => s.sortDir);
  const setSortBy = usePromptStore((s) => s.setSortBy);
  // The search text lives in the header bar now (SEARCH-001), so clearing the
  // filters has to reach across and empty a box this page does not own.
  const clearSearch = useSearchStore((s) => s.clear);
  const activeCount = useActiveFilterCount();

  return (
    <AssetFilterBar
      end={
        <SortControl
          options={SORT_COLUMNS}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={setSortBy}
        />
      }
    >
      <FolderChips />

      <FilterDropdown
        label="Strategy"
        icon={<Lightbulb className="h-3.5 w-3.5" aria-hidden />}
        value={filters.strategy}
        options={STRATEGY_OPTIONS}
        onSelect={(strategy) => setFilters({ strategy })}
      />
      <FilterDropdown
        label="Intent"
        icon={<Target className="h-3.5 w-3.5" aria-hidden />}
        value={filters.intent}
        options={INTENT_OPTIONS}
        onSelect={(intent) => setFilters({ intent })}
      />
      <LabelFilter
        selected={filters.labels}
        onChange={(labels) => setFilters({ labels })}
        onManage={onManageLabels}
      />
      <ClearFiltersButton
        count={activeCount}
        onClear={() => {
          resetFilters();
          clearSearch();
        }}
      />
    </AssetFilterBar>
  );
});
