import { create } from 'zustand';
import { analyticsApi } from '@/lib/api/analyticsApi';
import type { TeamLastUse } from '@/lib/usageAnalytics';
import { useAuthStore } from '@/stores/authStore';

/**
 * Who last used each snippet and prompt in a team folder, for the
 * "Last used by NAME on DD/MM/YYYY at HH:MM" line. Read from
 * shared_snippet_last_use() and shared_prompt_last_use(), refreshed when a
 * page that shows the line opens or the tab comes back into view, and moved
 * forward at once when you use one here.
 *
 * Fail-open: when the read fails the line hides rather than claiming
 * "Never used" for something that may well have been used.
 */
interface TeamLastUseStore {
  snippets: Map<string, TeamLastUse>;
  prompts: Map<string, TeamLastUse>;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Your own use, shown before the server confirms it. */
  markUsed: (kind: 'snippet' | 'prompt', id: string) => void;
}

let inFlight: Promise<void> | null = null;

export const useTeamLastUseStore = create<TeamLastUseStore>((set) => ({
  snippets: new Map(),
  prompts: new Map(),
  loaded: false,
  error: null,

  refresh: () => {
    if (inFlight) return inFlight;
    inFlight = analyticsApi
      .getTeamLastUses()
      .then(({ snippets, prompts }) => set({ snippets, prompts, loaded: true, error: null }))
      .catch((err: unknown) => {
        set({ error: err instanceof Error ? err.message : 'Could not load who last used your team items' });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },

  markUsed: (kind, id) => {
    const user = useAuthStore.getState().user;
    const name = (user?.user_metadata?.display_name as string | undefined) || user?.email || null;
    const entry: TeamLastUse = { used_at: new Date().toISOString(), used_by_name: name };
    set((s) => {
      const key = kind === 'snippet' ? 'snippets' : 'prompts';
      const next = new Map(s[key]);
      next.set(id, entry);
      return { [key]: next } as Pick<TeamLastUseStore, typeof key>;
    });
  },
}));
