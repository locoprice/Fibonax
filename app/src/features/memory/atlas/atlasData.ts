import type { AtlasBrainInput } from '@/features/memory/atlas/atlasOrbits';
import type { MemoryItem, MemorySpace, MemorySpaceTotals } from '@/types/database';

/**
 * The Brains as the atlas takes them. `items` is every live item, newest
 * first, or null while they are still loading: the totals then say how many
 * moons a Brain has, and the names follow.
 */
export function toAtlasBrains(
  spaces: readonly MemorySpace[],
  totals: ReadonlyMap<string, MemorySpaceTotals>,
  items: readonly MemoryItem[] | null,
): AtlasBrainInput[] {
  const pinned = new Map<string, string[]>();
  const others = new Map<string, string[]>();
  for (const item of items ?? []) {
    const group = item.pinned ? pinned : others;
    const names = group.get(item.space_id);
    if (names) names.push(item.name);
    else group.set(item.space_id, [item.name]);
  }
  return spaces.map((space) => {
    // Pinned first, then newest: the order a Brain lists its own items in.
    const itemNames = [...(pinned.get(space.id) ?? []), ...(others.get(space.id) ?? [])];
    return {
      id: space.id,
      name: space.name,
      description: space.description,
      createdAt: space.created_at,
      updatedAt: space.updated_at,
      itemCount: items ? itemNames.length : (totals.get(space.id)?.items ?? 0),
      itemNames,
    };
  });
}
