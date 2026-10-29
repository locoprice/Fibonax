/**
 * Bridge to the SHARED usage analytics, so the dashboard's Analytics page and
 * the phone's print the same figures from the same arithmetic.
 *
 * `extension/shared/usage-analytics.js` decides every figure: the period and
 * the one before it, the daily series, rankings and movers, weekday-by-hour,
 * streaks, folder and language shares, library health and the team table. This
 * module loads that file and types what it returns; it does not re-implement
 * any of it. `scripts/check-usage-analytics.js` pins the arithmetic, and
 * `src/__tests__/usageAnalytics.test.ts` pins the shape typed here.
 */

import { loadScript } from '@/lib/loadScript';

export type UsagePeriod = 7 | 30 | 90 | 365;

/** How one figure moved against the previous period of the same length. */
export interface UsageChange {
  cur: number;
  prev: number;
  diff: number;
  /** Null when the previous period had nothing: no percentage of zero is honest. */
  pct: number | null;
  dir: 'up' | 'down' | 'flat';
  /** "+12%", "−3%", "New" or "No change", worded once for every surface. */
  text: string;
}

export interface UsageSeriesPoint {
  date: string;
  label: string;
  weekday: string;
  count: number;
  /** The same day of the previous period. */
  prev: number;
  /** Trailing 7-day average, from the 7th day of a 30-day or longer period. */
  avg7: number | null;
}

export interface UsageRankRow {
  key: string;
  title: string;
  detail: string;
  uses: number;
  share: number;
  change: UsageChange;
}

export interface UsageMover {
  key: string;
  title: string;
  detail: string;
  uses: number;
  change: UsageChange;
}

export interface UsageListRow {
  key: string;
  title: string;
  detail: string;
  since: number | null;
  days: number | null;
}

export interface UsagePatterns {
  /** 7 rows, Monday first, of 24 hourly counts, local time. */
  grid: number[][];
  max: number;
  weekdays: Array<{ name: string; uses: number; share: number }>;
  peakWeekday: { name: string; uses: number; share: number } | null;
  peakHour: { hour: number; label: string; uses: number; share: number } | null;
  workdayShare: number;
  streak: { current: number; currentAtLeast: boolean; longestInPeriod: number };
}

export interface UsageHealth {
  library: number;
  usedInPeriod: number;
  usedShare: number;
  neverUsed: number;
  neverUsedList: UsageListRow[];
  dormant: number;
  dormantDays: number;
  dormantList: UsageListRow[];
  withShortcut: number;
  inFolder: number;
}

export interface UsageReport {
  period: UsagePeriod;
  label: string;
  rangeLabel: string;
  prevRangeLabel: string;
  start: string;
  prevStart: string;
  empty: boolean;
  totals: {
    uses: UsageChange;
    activeDays: UsageChange;
    snippetsUsed: UsageChange;
    avgPerDay: UsageChange;
    avgPerActiveDay: number;
    secondsSaved: UsageChange;
    fieldsFilled: UsageChange;
    avgFieldsPerUse: number;
    usesWithFieldsShare: number;
    bestDay: { date: string; label: string; count: number } | null;
    days: number;
  };
  series: UsageSeriesPoint[];
  top: UsageRankRow[];
  rising: UsageMover[];
  falling: UsageMover[];
  byFolder: UsageRankRow[];
  byLanguage: UsageRankRow[];
  patterns: UsagePatterns;
  health: UsageHealth;
}

export interface UsageTeamMember {
  id: string;
  rank: number;
  name: string;
  isMe: boolean;
  uses: number;
  snippets: number;
  share: number;
  change: UsageChange;
}

export interface UsageTeamReport {
  total: UsageChange;
  members: UsageTeamMember[];
}

/** One row of public.snippet_events, as the page reads it. */
export interface UsageEventRow {
  snippet_id: string | null;
  created_at: string;
  fields_filled: number;
  lang: string | null;
}

export interface UsageSnippetRow {
  id: string;
  title: string;
  shortcut: string;
  folder_id: string | null;
  lang: string | null;
  created_at: string;
}

export interface UsageInput {
  events: UsageEventRow[];
  snippets: UsageSnippetRow[];
  folders: Array<{ id: string; name: string }>;
  /** snippet_last_used(): snippet id to its last use, across all time. */
  lastUsed: Record<string, string>;
  /** Where the event read started, so a streak that reaches it reads "at least". */
  loadedFrom: string;
}

/** One row of team_usage_by_member(). */
export interface TeamUsageRow {
  user_id: string;
  member_name: string | null;
  uses: number;
  snippets: number;
}

export interface UsageAnalyticsApi {
  PERIODS: UsagePeriod[];
  DEFAULT_PERIOD: UsagePeriod;
  SECONDS_PER_USE: number;
  LOAD_DAYS: number;
  DORMANT_DAYS: number;
  normalizePeriod(p: number): UsagePeriod;
  periodLabel(p: number): string;
  range(period: number, now: number): { period: UsagePeriod; start: Date; end: Date; prevStart: Date; prevEnd: Date; today: Date };
  loadFrom(now: number): Date;
  change(cur: number, prev: number): UsageChange;
  formatCount(n: number): string;
  formatDuration(seconds: number): string;
  hourLabel(h: number): string;
  compute(input: UsageInput & { period: UsagePeriod; now: number }): UsageReport;
  team(current: TeamUsageRow[], previous: TeamUsageRow[], myId: string | null): UsageTeamReport;
}

declare global {
  interface Window {
    SBUsageAnalytics?: UsageAnalyticsApi;
  }
}

const SCRIPT = '/extension/shared/usage-analytics.js';

let pending: Promise<UsageAnalyticsApi> | null = null;

/**
 * Resolves once the shared module has installed its global. Rejects with an
 * actionable message if it cannot be served, so the page can say so instead of
 * printing zeros that look like real figures.
 */
export function loadUsageAnalytics(): Promise<UsageAnalyticsApi> {
  if (window.SBUsageAnalytics) return Promise.resolve(window.SBUsageAnalytics);
  if (pending) return pending;
  pending = loadScript(SCRIPT)
    .then(() => {
      const api = window.SBUsageAnalytics;
      if (!api) throw new Error('Usage analytics loaded but installed no interface');
      return api;
    })
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
