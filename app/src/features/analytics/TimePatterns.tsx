import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UsageAnalyticsApi, UsageReport } from '@/lib/usageAnalytics';

interface TimePatternsProps {
  report: UsageReport;
  engine: UsageAnalyticsApi;
}

const HOUR_TICKS = [0, 6, 12, 18];

/** The same five steps the year grid above uses (`--activity-0` to `--activity-4`). */
function level(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

/** When you insert: weekday by hour of the day, local time, with the peaks named in words. */
export function TimePatterns({ report, engine }: TimePatternsProps) {
  const p = report.patterns;
  const n = engine.formatCount;
  return (
    <Card>
      <CardHeader>
        <CardTitle>When you use snippets</CardTitle>
        <CardDescription>Inserts by weekday and hour, in your local time.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="border-separate" style={{ borderSpacing: 3 }}>
            <caption className="sr-only">Inserts by weekday (rows) and hour of the day (columns)</caption>
            <thead>
              <tr>
                <th scope="col" className="w-9" />
                {Array.from({ length: 24 }, (_, h) => (
                  <th
                    key={h}
                    scope="col"
                    className="w-3.5 p-0 text-left text-[10px] font-normal text-ink-subtle"
                  >
                    {HOUR_TICKS.includes(h) ? String(h).padStart(2, '0') : <span className="sr-only">{h}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.grid.map((row, w) => (
                <tr key={w}>
                  <th scope="row" className="pr-1.5 text-right text-[10px] font-normal text-ink-subtle">
                    {p.weekdays[w]?.name}
                  </th>
                  {row.map((count, h) => (
                    <td
                      key={h}
                      className="h-3.5 w-3.5 rounded-[2px] p-0"
                      style={{ backgroundColor: `var(--activity-${level(count, p.max)})` }}
                      title={`${p.weekdays[w]?.name} ${engine.hourLabel(h)}: ${n(count)} ${count === 1 ? 'insert' : 'inserts'}`}
                    >
                      <span className="sr-only">{count}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-muted">Busiest weekday</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">
              {p.peakWeekday ? `${p.peakWeekday.name}, ${p.peakWeekday.share}% of inserts` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Busiest hour</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">
              {p.peakHour ? `${p.peakHour.label}, ${p.peakHour.share}% of inserts` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Monday to Friday</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">{p.workdayShare}% of inserts</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
