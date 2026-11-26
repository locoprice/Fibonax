import { create } from 'zustand';

// Whether the search window is up (SEARCH-001).
//
// The bar in the header and Ctrl+K open it; the window itself
// (features/search/CommandPalette.tsx) follows this and writes back when it
// closes. What is typed lives in the window, not here.

interface SearchStore {
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
}

export const useSearchStore = create<SearchStore>((set) => ({
  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
}));
