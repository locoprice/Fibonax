import { useEffect, useState } from 'react';
import { revisionsApi } from '@/lib/api/revisionsApi';
import type { BodyHistoryEntry } from '@/lib/languageSync';

/**
 * The saved versions of a snippet, for working out when each language was last
 * updated. Null until they arrive and when they cannot be read: the editor
 * works without them and simply shows no dates.
 */
export function useLanguageHistory(
  snippetId: string | null,
  enabled: boolean,
): BodyHistoryEntry[] | null {
  const [loaded, setLoaded] = useState<{ id: string; entries: BodyHistoryEntry[] } | null>(null);

  useEffect(() => {
    // Whatever was read before belongs to an earlier open of the editor, and
    // may predate a save made since.
    setLoaded(null);
    if (!enabled || snippetId === null) return undefined;
    let cancelled = false;
    revisionsApi.listBodyHistory(snippetId).then(
      (entries) => {
        if (!cancelled) setLoaded({ id: snippetId, entries });
      },
      (err: unknown) => {
        console.error('Language history unavailable; update dates are not shown:', err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [snippetId, enabled]);

  return loaded !== null && loaded.id === snippetId ? loaded.entries : null;
}
