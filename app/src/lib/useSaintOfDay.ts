import { useEffect, useState } from 'react';
import { saintApi } from '@/lib/api/saintApi';
import { isSaintFresh, loadSaintCache, makeSaintEntry, saveSaintCache } from '@/lib/saintOfDay';

/** How often an open dashboard checks that the saint it shows is still today's. */
const RECHECK_MS = 60 * 60 * 1000;

/** The saved saint while it is still today's, or null. */
function freshName(): string | null {
  const saved = loadSaintCache();
  return saved && isSaintFresh(saved, Date.now()) ? saved.name : null;
}

/**
 * The saint of the day for the footer, or null for "show nothing".
 *
 * Switched off: nothing is shown and nothing is asked. A fresh saved saint is
 * shown at once, on the first paint, with no request. Otherwise one request
 * goes out after the first paint, so the footer never holds the page up.
 *
 * A request that fails (offline, or a page that changed shape) shows nothing,
 * quietly: this line is a courtesy, and an error bar over it would be worse
 * than its absence. A saint that is no longer today's is never shown in the
 * meantime, since a wrong saint is worse than none.
 */
export function useSaintOfDay(enabled: boolean): string | null {
  const [name, setName] = useState<string | null>(() => (enabled ? freshName() : null));

  useEffect(() => {
    if (!enabled) {
      setName(null);
      return undefined;
    }
    let cancelled = false;
    let loading = false;

    function refresh(): void {
      const saved = freshName();
      if (saved) {
        setName(saved);
        return;
      }
      if (loading) return;
      loading = true;
      saintApi
        .getSaintOfDay()
        .then((reading) => {
          saveSaintCache(makeSaintEntry(reading, Date.now()));
          if (!cancelled) setName(reading.name);
        })
        .catch(() => {
          // Intentionally quiet, see above. The server function logs why.
          if (!cancelled) setName(null);
        })
        .finally(() => {
          loading = false;
        });
    }

    refresh();
    const timer = window.setInterval(refresh, RECHECK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return enabled ? name : null;
}
