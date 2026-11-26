import type { Label, LabelAssignments } from '@/types/database';

// What the dashboard's search needs to know about the page it is on, and the
// names of the labels an item carries (SEARCH-001).
//
// What matches, and how results are ranked, is not decided here any more. The
// search window (features/search/CommandPalette.tsx) reads the one shared rule,
// extension/shared/asset-search.js, as the popup and the phone do.

export type SearchKind = 'snippet' | 'prompt' | 'memory';

/**
 * Which of the three a route belongs to, or null on a page that holds none of
 * them (analytics, team, settings).
 *
 * Read by the bar to word its placeholder.
 */
export function sectionForPath(pathname: string): SearchKind | null {
  if (pathname === '/') return 'snippet';
  if (pathname.startsWith('/prompts')) return 'prompt';
  if (pathname.startsWith('/memory')) return 'memory';
  return null;
}

/** The space being viewed, for the bar's placeholder. Null elsewhere. */
export function spaceForPath(pathname: string): string | null {
  const match = /^\/memory\/([^/]+)/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

/**
 * Resolve an asset id to the names of its labels.
 *
 * The id-to-name map is built once per call rather than per asset, because the
 * search window asks for every item in the library.
 */
export function labelNameLookup(
  catalog: readonly Label[],
  assignments: LabelAssignments,
): (assetId: string) => string[] {
  const names = new Map(catalog.map((label) => [label.id, label.name]));
  return (assetId) => {
    const ids = assignments.get(assetId);
    if (ids === undefined || ids.length === 0) return [];
    return ids
      .map((id) => names.get(id))
      .filter((name): name is string => name !== undefined);
  };
}
