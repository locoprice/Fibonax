import { create } from 'zustand';

// The one search on the dashboard (SEARCH-001).
//
// The bar in the header opens the search window (features/search/
// CommandPalette.tsx), and `paletteOpen` is whether it is up: the bar and
// Ctrl+K write it, the window follows it.
//
// The bar used to take the typing itself and narrow the page in view. Since
// the search window, typing happens in the window, so nothing writes `input`
// any more and `query` stays empty. The lists still read it: narrowing a page
// by typing is switched off, not taken out.
//
// Two fields, not one, and the difference matters:
//
//   `input` is what the bar shows. It moves on every keystroke so typing never
//   feels laggy.
//   `query` is what the lists filter on. It follows `input` after a pause, so a
//   thousand-row table is not re-filtered per character.
//

/** Matches the pause the per-page search fields used, so the feel is unchanged. */
const DEBOUNCE_MS = 300;

interface SearchStore {
  /** What the bar shows. Instant. */
  input: string;
  /** What the lists filter on. Trails `input` by `DEBOUNCE_MS`. */
  query: string;
  /** Whether the search window is up. */
  paletteOpen: boolean;

  /** Type a character. Schedules the commit to `query`. */
  setInput: (next: string) => void;
  /** Apply `input` now, without waiting. */
  commit: () => void;
  /** Empty both fields. The "Clear filters" actions and section changes use this. */
  clear: () => void;
  openPalette: () => void;
  closePalette: () => void;
}

// Module-scope because the timer belongs to the store, not to whichever
// component happened to render the bar. Cancelled by every path that writes
// `query` directly, so a pending keystroke can never land after a clear.
let timer: ReturnType<typeof setTimeout> | null = null;

function cancel(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  input: '',
  query: '',
  paletteOpen: false,

  setInput: (next) => {
    set({ input: next });
    cancel();
    timer = setTimeout(() => {
      timer = null;
      set({ query: get().input });
    }, DEBOUNCE_MS);
  },

  commit: () => {
    cancel();
    set({ query: get().input });
  },

  clear: () => {
    cancel();
    set({ input: '', query: '' });
  },

  openPalette: () => set({ paletteOpen: true }),

  closePalette: () => set({ paletteOpen: false }),
}));
