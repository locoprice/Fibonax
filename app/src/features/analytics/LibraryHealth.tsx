import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UsageAnalyticsApi, UsageListRow, UsageReport } from '@/lib/usageAnalytics';

interface LibraryHealthProps {
  report: UsageReport;
  engine: UsageAnalyticsApi;
}

function Gauge({ label, value, total, engine }: { label: string; value: number; total: number; engine: UsageAnalyticsApi }) {
  const pct = total ? Math.round((value / total) * 1000) / 10 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink">{label}</span>
        <span className="tabular-nums text-ink-muted">
          {engine.formatCount(value)} of {engine.formatCount(total)} · {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-alt" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function SnippetList({ title, total, rows, sinceWord, empty }: {
  title: string;
  total: number;
  rows: UsageListRow[];
  sinceWord: string;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <h4 className="text-sm font-semibold text-ink">
        {title} <span className="font-normal tabular-nums text-ink-muted">({total})</span>
      </h4>
      {rows.length ? (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate text-ink">{r.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-subtle">
                {r.days === null ? '' : `${sinceWord} ${r.days} ${r.days === 1 ? 'day' : 'days'}`}
              </span>
            </li>
          ))}
          {total > rows.length ? (
            <li className="py-2 text-xs text-ink-subtle">and {total - rows.length} more</li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">{empty}</p>
      )}
    </div>
  );
}

/**
 * How much of the library earns its place. "Never used" and "not used for 90
 * days" read every insert ever recorded, yours and your team's on a shared
 * snippet, not only this period.
 */
export function LibraryHealth({ report, engine }: LibraryHealthProps) {
  const h = report.health;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Library health</CardTitle>
        <CardDescription>
          The {engine.formatCount(h.library)} snippets you can use, yours and shared with you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Gauge label="Used in this period" value={h.usedInPeriod} total={h.library} engine={engine} />
          <Gauge label="Have a shortcut" value={h.withShortcut} total={h.library} engine={engine} />
          <Gauge label="In a folder" value={h.inFolder} total={h.library} engine={engine} />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <SnippetList
            title="Never used"
            total={h.neverUsed}
            rows={h.neverUsedList}
            sinceWord="created"
            empty="Every snippet has been used at least once."
          />
          <SnippetList
            title={`Not used for ${h.dormantDays} days`}
            total={h.dormant}
            rows={h.dormantList}
            sinceWord="last used"
            empty={`Everything was used in the last ${h.dormantDays} days.`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
