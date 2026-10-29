import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UsageAnalyticsApi, UsageMover, UsageReport } from '@/lib/usageAnalytics';
import { ChangeBadge } from './ChangeBadge';

interface SnippetRankingProps {
  report: UsageReport;
  engine: UsageAnalyticsApi;
}

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

/** Your most-inserted snippets with their share of all inserts, and the biggest movers against the previous period. */
export function SnippetRanking({ report, engine }: SnippetRankingProps) {
  const n = engine.formatCount;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top snippets</CardTitle>
        <CardDescription>
          Your ten most-inserted snippets in this period, each with its share of all your inserts.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {report.top.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  <th scope="col" className="border-b border-line bg-bg-alt px-6 py-2.5 w-10">#</th>
                  <th scope="col" className="border-b border-line bg-bg-alt px-3 py-2.5">Snippet</th>
                  <th scope="col" className="border-b border-line bg-bg-alt px-3 py-2.5 text-right">Inserts</th>
                  <th scope="col" className="border-b border-line bg-bg-alt px-3 py-2.5 w-[22%]">Share</th>
                  <th scope="col" className="border-b border-line bg-bg-alt px-6 py-2.5 text-right">vs before</th>
                </tr>
              </thead>
              <tbody>
                {report.top.map((row, i) => (
                  <tr key={row.key} className={i === report.top.length - 1 ? '' : 'border-b border-line'}>
                    <td className="px-6 py-3 tabular-nums text-ink-subtle">{i + 1}</td>
                    <td className="max-w-0 px-3 py-3">
                      <div className="truncate font-medium text-ink">{row.title}</div>
                      {row.detail ? <div className="truncate text-xs text-ink-subtle">{row.detail}</div> : null}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-ink">{n(row.uses)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <ShareBar share={row.share} />
                        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-muted">{row.share}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <ChangeBadge change={row.change} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-6 pb-6 text-sm text-ink-muted">
            No inserts in this period yet. Type a shortcut anywhere and it shows up here.
          </p>
        )}
      </CardContent>
      <div className="grid grid-cols-1 gap-6 border-t border-line px-6 py-5 md:grid-cols-2">
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
