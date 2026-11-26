import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Command, Search } from 'lucide-react';
import { useSearchStore } from '@/stores/searchStore';
import { sectionForPath, spaceForPath } from '@/lib/searchIndex';

// The one search bar (SEARCH-001).
//
// It sits in the header, where it has always been, and looks the way it
// always has. Since the search window arrived it no longer takes the typing
// itself: a click, Enter or Ctrl+K opens the window (features/search/
// CommandPalette.tsx), and the typing happens there. So it is a button that
// looks like a field, which is also what a screen reader is told it is.
//
// It lives in the topbar, which mounts once for the whole dashboard.

/**
 * What the bar says, given where you are.
 *
 * Exported for its test. The wording follows one pattern with the noun swapped,
 * the way the three sections word everything else.
 */
export function searchPlaceholder(pathname: string): string {
  const section = sectionForPath(pathname);
  if (section === 'snippet') return 'Search snippets…';
  if (section === 'prompt') return 'Search prompts…';
  if (section === 'memory') {
    return spaceForPath(pathname) !== null ? 'Search this Brain…' : 'Search Brains…';
  }
  return 'Search everything…';
}

export function MasterSearch() {
  const { pathname } = useLocation();
  const open = useSearchStore((s) => s.paletteOpen);
  const openPalette = useSearchStore((s) => s.openPalette);

  // Ctrl+K from anywhere. While the window is open it takes the same keys
  // itself and closes on them, so this only ever opens.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPalette]);

  return (
    <div className="relative min-w-0 flex-1 md:max-w-[360px]">
      <button
        type="button"
        data-search-bar
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Control+K Meta+K"
        className="flex h-9 w-full cursor-text items-center rounded-[10px] border border-line bg-bg-alt pl-9 pr-12 text-left text-sm text-ink-subtle focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <span className="truncate">{searchPlaceholder(pathname)}</span>
        <kbd className="pointer-events-none absolute right-2 top-1/2 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded-md border border-line bg-card px-1.5 text-[11px] font-medium text-ink-subtle">
          <Command className="h-3 w-3" />
          K
        </kbd>
      </button>
    </div>
  );
}
