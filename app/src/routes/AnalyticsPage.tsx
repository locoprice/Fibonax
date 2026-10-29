import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { ActivityHeatmap } from '@/features/analytics/ActivityHeatmap';
import { ActivityOverviewSection } from '@/features/analytics/ActivityOverviewSection';
import { ContributionActivity } from '@/features/analytics/ContributionActivity';
import { LibraryHealth } from '@/features/analytics/LibraryHealth';
import { SnippetRanking } from '@/features/analytics/SnippetRanking';
import { TeamUsage } from '@/features/analytics/TeamUsage';
import { TimePatterns } from '@/features/analytics/TimePatterns';
import { UsageMix } from '@/features/analytics/UsageMix';
import { UsageSummary } from '@/features/analytics/UsageSummary';
import { UsageTrendChart } from '@/features/analytics/UsageTrendChart';
import { useAnalyticsStore } from '@/stores/analyticsStore';
import { useOrgStore } from '@/stores/orgStore';
import type { UsagePeriod } from '@/lib/usageAnalytics';

const STORAGE_PRIVATE = 'sb.activity.private';
const STORAGE_OVERVIEW = 'sb.activity.overview';
const STORAGE_PERIOD = 'sb.analytics.period';

const PERIOD_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '12 months' },
] as const;

type PeriodKey = (typeof PERIOD_OPTIONS)[number]['value'];

function readToggle(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice stays in memory only */
  }
}

function readPeriod(): PeriodKey {
  try {
    const raw = localStorage.getItem(STORAGE_PERIOD);
    const hit = PERIOD_OPTIONS.find((o) => o.value === raw);
    return hit ? hit.value : '30';
  } catch {
    return '30';
  }
}

export function AnalyticsPage() {
  const engine = useAnalyticsStore((s) => s.engine);
  const usage = useAnalyticsStore((s) => s.usage);
  const usageAt = useAnalyticsStore((s) => s.usageAt);
  const usageLoading = useAnalyticsStore((s) => s.usageLoading);
  const usageError = useAnalyticsStore((s) => s.usageError);
  const loadUsage = useAnalyticsStore((s) => s.loadUsage);
  const team = useAnalyticsStore((s) => s.team);
  const teamAvailable = useAnalyticsStore((s) => s.teamAvailable);
  const teamError = useAnalyticsStore((s) => s.teamError);
  const loadTeam = useAnalyticsStore((s) => s.loadTeam);
  const activity = useAnalyticsStore((s) => s.activity);
  const activityError = useAnalyticsStore((s) => s.activityError);
  const loadActivity = useAnalyticsStore((s) => s.loadActivity);

  const orgs = useOrgStore((s) => s.orgs);
  const orgsLoaded = useOrgStore((s) => s.loaded);
  const loadOrgs = useOrgStore((s) => s.load);

  const [periodKey, setPeriodKey] = useState<PeriodKey>(readPeriod);
  const period = Number(periodKey) as UsagePeriod;
  const [showPrivate, setShowPrivate] = useState(() => readToggle(STORAGE_PRIVATE, true));
  const [showOverview, setShowOverview] = useState(() => readToggle(STORAGE_OVERVIEW, true));

  function changePeriod(next: PeriodKey) {
    setPeriodKey(next);
    persist(STORAGE_PERIOD, next);
  }
  function changePrivate(next: boolean) {
    setShowPrivate(next);
    persist(STORAGE_PRIVATE, next ? '1' : '0');
  }
  function changeOverview(next: boolean) {
    setShowOverview(next);
    persist(STORAGE_OVERVIEW, next ? '1' : '0');
  }

  useEffect(() => {
    if (!usage && !usageLoading && !usageError) void loadUsage();
  }, [usage, usageLoading, usageError, loadUsage]);

  useEffect(() => {
    if (!activity && !activityError) void loadActivity();
  }, [activity, activityError, loadActivity]);

  useEffect(() => {
    if (!orgsLoaded) void loadOrgs();
  }, [orgsLoaded, loadOrgs]);

  const inTeam = orgs.length > 0;
  useEffect(() => {
    if (inTeam && teamAvailable && engine && usageAt !== null && !team[period] && !teamError) {
      void loadTeam(period);
    }
  }, [inTeam, teamAvailable, engine, usageAt, team, period, teamError, loadTeam]);

  const report = useMemo(
    () => (engine && usage && usageAt !== null ? engine.compute({ ...usage, period, now: usageAt }) : null),
    [engine, usage, usageAt, period],
  );

  const header = (
    <PageHeader
      title="Analytics"
      description={
        report
          ? `${report.label}: ${report.rangeLabel}, compared with ${report.prevRangeLabel}.`
          : 'How you use your snippets, compared with the period before.'
      }
      action={
        <>
          <Segmented
            ariaLabel="Period"
            className="shrink-0 [&>button]:whitespace-nowrap"
            options={PERIOD_OPTIONS}
            value={periodKey}
            onChange={changePeriod}
          />
          <button
            type="button"
            onClick={() => void loadUsage()}
            disabled={usageLoading}
            aria-label="Refresh figures"
            title="Refresh figures"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-line bg-card text-ink hover:bg-bg-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            <RefreshCw className={usageLoading ? 'h-4 w-4 animate-spin motion-reduce:animate-none' : 'h-4 w-4'} aria-hidden="true" />
          </button>
        </>
      }
    />
  );

  if (usageError && !report) {
    return (
      <>
        {header}
        <Card className="flex items-center justify-between gap-4 p-6">
          <div>
            <p className="font-medium text-ink">Your figures could not load.</p>
            <p className="mt-1 text-sm text-ink-muted">{usageError} Check your connection and try again.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadUsage()}
            className="shrink-0 rounded-[8px] bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Try again
          </button>
        </Card>
      </>
    );
  }

  if (!report || !engine) {
    return (
      <>
        {header}
        <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-[16px] bg-card" />
          ))}
        </div>
        <div className="mt-6 h-[340px] animate-pulse rounded-[16px] bg-card" />
      </>
    );
  }

  return (
    <>
      {header}

      <UsageSummary report={report} engine={engine} />

      <div className="mt-6">
        <UsageTrendChart report={report} />
      </div>

      <div className="mt-6">
        <SnippetRanking report={report} engine={engine} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <TimePatterns report={report} engine={engine} />
        <UsageMix report={report} engine={engine} />
      </div>

      {inTeam && teamAvailable ? (
        <div className="mt-6">
          <TeamUsage
            team={team[period]}
            error={teamError}
            engine={engine}
            onRetry={() => {
              useAnalyticsStore.setState({ teamError: null });
            }}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <LibraryHealth report={report} engine={engine} />
      </div>

      <div className="mt-6">
        {activity ? (
          <ActivityHeatmap
            data={activity}
            showPrivate={showPrivate}
            showOverview={showOverview}
            onChangePrivate={changePrivate}
            onChangeOverview={changeOverview}
          >
            <ActivityOverviewSection data={activity} showPrivate={showPrivate} />
            <ContributionActivity data={activity} showPrivate={showPrivate} />
          </ActivityHeatmap>
        ) : activityError ? (
          <Card className="flex items-center justify-between gap-4 p-6 text-sm">
            <span className="text-ink-muted">The year grid could not load. {activityError}</span>
            <button
              type="button"
              onClick={() => void loadActivity()}
              className="shrink-0 rounded-[8px] border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-bg-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Try again
            </button>
          </Card>
        ) : (
          <div className="h-[260px] animate-pulse rounded-[16px] bg-card" />
        )}
      </div>
    </>
  );
}
