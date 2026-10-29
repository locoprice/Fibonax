import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UsageAnalyticsApi, UsageRankRow, UsageReport } from '@/lib/usageAnalytics';
import { ChangeBadge } from './ChangeBadge';

interface UsageMixProps {
  report: UsageReport;
  engine: UsageAnalyticsApi;
}

function MixList({ title, rows, engine }: { title: string; rows: UsageRankRow[]; engine: UsageAnalyticsApi }) {
  return (
    <div className="min-w-0">
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      {rows.length ? (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink">{r.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-ink-muted">
                    {engine.formatCount(r.uses)} · {r.share}%
                  </span>
                  <ChangeBadge change={r.change} />
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-alt" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, r.share)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">No inserts in this period.</p>
      )}
    </div>
  );
}

/** Where your inserts go: by folder and by language, each with its change. */
export function UsageMix({ report, engine }: UsageMixProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where your use goes</CardTitle>
        <CardDescription>Your inserts in this period by folder and by language.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <MixList title="By folder" rows={report.byFolder} engine={engine} />
        <MixList title="By language" rows={report.byLanguage} engine={engine} />
      </CardContent>
    </Card>
  );
}
