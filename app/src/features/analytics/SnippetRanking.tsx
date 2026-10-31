import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/shared/Sparkline';
import type { UsageAnalyticsApi, UsageMover, UsageReport } from '@/lib/usageAnalytics';
import { ChangeBadge } from './ChangeBadge';

interface SnippetRankingProps {
  report: UsageReport;
  engine: UsageAnalyticsApi;
}

/** Rank · snippet · trend · inserts · share · change. One grid for the header and every row. */
const ROW_GRID = 'grid grid-cols-[1.25rem_minmax(0,1fr)_5rem_3.5rem_8rem_6rem] items-center gap-3';

function ShareBar({ share }: { share: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-alt" aria-hidden="true">
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, share)}%` }} />
    </div>
  );
}

function MoverList({
  title,
  icon: Icon,
  rows,
  empty,
  engine,
}: {
  title: string;
  icon: typeof TrendingUp;
  rows: UsageMover[];
  empty: string;
  engine: UsageAnalyticsApi;
}) {
  return (
    <div className="min-w-0">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        {title}
      </h4>
      {rows.length ? (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-ink">{m.title}</div>
                <div className="truncate text-xs text-ink-subtle">
                  {engine.formatCount(m.change.prev)} → {engine.formatCount(m.change.cur)} inserts
                </div>
              </div>
              <ChangeBadge change={m.change} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">{empty}</p>
      )}
    </div>
  );
}

/**
 * Your most-inserted snippets, ranked, each with its trend across the period,
 * its share of all inserts and its change, then the biggest movers against
 * the previous period.
 */
export function SnippetRanking({ report, engine }: SnippetRankingProps) {
  const n = engine.formatCount;
  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold tracking-tight text-ink">Top snippets</h3>
      <p className="mt-0.5 text-sm text-ink-muted">
        Your ten most-inserted snippets in this period, each with its share of all your inserts.
      </p>

      {report.top.length ? (
        <div className="mt-4">
          <div className={`${ROW_GRID} border-b border-line pb-2 text-xs text-ink-subtle`} aria-hidden="true">
            <span />
            <span>Snippet</span>
            <span>Trend</span>
            <span className="text-right">Inserts</span>
            <span>Share</span>
            <span className="text-right">vs before</span>
          </div>
          <ol className="divide-y divide-line">
            {report.top.map((row, i) => (
              <li key={row.key} className={`${ROW_GRID} py-2.5`}>
                <span className="text-xs tabular-nums text-ink-subtle">{i + 1}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{row.title}</div>
                  {row.detail ? <div className="truncate text-xs text-ink-subtle">{row.detail}</div> : null}
                </div>
                <Sparkline values={row.trend} className="text-primary" />
                <span className="text-right text-sm font-semibold tabular-nums text-ink">
                  {n(row.uses)}
                  <span className="sr-only"> inserts</span>
                </span>
                <div className="flex items-center gap-2">
                  <ShareBar share={row.share} />
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-muted">{row.share}%</span>
                </div>
                <div className="flex justify-end">
                  <ChangeBadge change={row.change} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          No inserts in this period yet. Type a shortcut anywhere and it shows up here.
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-6 border-t border-line pt-5 md:grid-cols-2">
        <MoverList
          title="Rising fastest"
          icon={TrendingUp}
          rows={report.rising}
          empty="Nothing is used more than in the period before."
          engine={engine}
        />
        <MoverList
          title="Falling fastest"
          icon={TrendingDown}
          rows={report.falling}
          empty="Nothing is used less than in the period before."
          engine={engine}
        />
      </div>
    </Card>
  );
}
