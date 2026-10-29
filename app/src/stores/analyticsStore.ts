import { create } from 'zustand';
import type { ActivityData } from '@/types/database';
import { analyticsApi } from '@/lib/api/analyticsApi';
import { supabase } from '@/lib/supabase';
import {
  loadUsageAnalytics,
  type UsageAnalyticsApi,
  type UsageInput,
  type UsagePeriod,
  type UsageTeamReport,
} from '@/lib/usageAnalytics';

/**
 * The Analytics page's data. Usage is read once (two years of your own inserts,
 * the library and last uses) and every period is computed from it on the
 * device, so switching between 7 days and 12 months is instant and the figures
 * cannot drift between reads. The team table is read per period, because it
 * comes counted from the server (team_usage_by_member).
 */
interface AnalyticsStore {
  engine: UsageAnalyticsApi | null;
  usage: UsageInput | null;
  /** When `usage` was read; every figure is computed against this moment. */
  usageAt: number | null;
  usageLoading: boolean;
  usageError: string | null;
  loadUsage: () => Promise<void>;

  team: Partial<Record<UsagePeriod, UsageTeamReport>>;
  /** False once the server says it has no team function; the table then stays hidden. */
  teamAvailable: boolean;
  teamError: string | null;
  loadTeam: (period: UsagePeriod) => Promise<void>;

  activity: ActivityData | null;
  activityLoading: boolean;
  activityError: string | null;
  loadActivity: () => Promise<void>;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export const useAnalyticsStore = create<AnalyticsStore>((set, get) => ({
  engine: null,
  usage: null,
  usageAt: null,
  usageLoading: false,
  usageError: null,
  loadUsage: async () => {
    set({ usageLoading: true, usageError: null });
    try {
      const engine = await loadUsageAnalytics();
      const now = Date.now();
      const usage = await analyticsApi.getUsage(engine.loadFrom(now));
      // A refresh re-reads the team figures too, against the same moment.
      set({ engine, usage, usageAt: now, usageLoading: false, team: {} });
    } catch (err) {
      console.error('Analytics: could not load usage', err);
      set({ usageLoading: false, usageError: message(err, 'Could not load your usage.') });
    }
  },

  team: {},
  teamAvailable: true,
  teamError: null,
  loadTeam: async (period) => {
    const { engine, usageAt } = get();
    if (!engine || usageAt === null) return;
    set({ teamError: null });
    try {
      const r = engine.range(period, usageAt);
      const [current, previous, auth] = await Promise.all([
        analyticsApi.getTeamUsage(r.start, r.end),
        analyticsApi.getTeamUsage(r.prevStart, r.prevEnd),
        supabase.auth.getUser(),
      ]);
      if (current === null || previous === null) {
        set({ teamAvailable: false });
        return;
      }
      const report = engine.team(current, previous, auth.data.user?.id ?? null);
      set((s) => ({ team: { ...s.team, [period]: report } }));
    } catch (err) {
      console.error('Analytics: could not load team usage', err);
      set({ teamError: message(err, 'Could not load the team figures.') });
    }
  },

  activity: null,
  activityLoading: false,
  activityError: null,
  loadActivity: async () => {
    set({ activityLoading: true, activityError: null });
    try {
      const activity = await analyticsApi.getActivity();
      set({ activity, activityLoading: false });
    } catch (err) {
      console.error('Analytics: could not load activity', err);
      set({ activityLoading: false, activityError: message(err, 'Could not load your activity.') });
    }
  },
}));
