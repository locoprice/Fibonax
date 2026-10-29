import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UsageAnalyticsApi, UsageTeamReport } from '@/lib/usageAnalytics';
import { ChangeBadge } from './ChangeBadge';

interface TeamUsageProps {
  team: UsageTeamReport | undefined;
  error: string | null;
  engine: UsageAnalyticsApi;
  onRetry: () => void;
}

/**
 * Who on the team uses the shared snippets, from team_usage_by_member(). It
 * counts only snippets in team folders you can open, and gives one total per
 * person: never single inserts or times.
 */
export function TeamUsage({ team, error, engine, onRetry }: TeamUsageProps) {
  const n = engine.formatCount;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          Inserts of shared snippets in this period, by person. Only team folders you can open are counted.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {error ? (
          <div className="flex items-center justify-between gap-4 px-6 pb-6 text-sm">
            <span className="text-ink-muted">The team figures could not load. {error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 rounded-[8px] border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-bg-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Try again
            </button>
          </div>
        ) : !team ? (
          <div className="mx-6 mb-6 h-24 animate-pulse rounded-[12px] bg-bg-alt" />
        ) : team.members.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-ink-muted">
            Nobody has used a shared snippet in this period. Share a folder with your team and its use shows up here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  <th scope="col" className="border-b border-line bg-bg-alt px-6 py-2.5 w-10">#</th>
                  <th scope="col" className="border-b border-line bg-bg-alt px-3 py-2.5">Person</th>
                  <th scope="col" className="border-b border-line bg-bg-alt px-3 py-2.5 text-right">Inserts</th>
                  <th scope="col" className="border-b border-line bg-bg-alt px-3 py-2.5 text-right">Snippets</th>
                  <th scope="col" className="border-b border-line bg-bg-alt px-3 py-2.5 w-[20%]">Share</th>
                  <th scope="col" className="border-b border-line bg-bg-alt px-6 py-2.5 text-right">vs before</th>
                </tr>
              </thead>
              <tbody>
                {team.members.map((m, i) => (
                  <tr key={m.id} className={i === team.members.length - 1 ? '' : 'border-b border-line'}>
                    <td className="px-6 py-3 tabular-nums text-ink-subtle">{m.rank}</td>
                    <td className="max-w-0 px-3 py-3">
                      <span className="block truncate font-medium text-ink">
                        {m.name}
                        {m.isMe ? <span className="ml-1.5 font-normal text-ink-muted">(you)</span> : null}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-ink">{n(m.uses)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-ink">{n(m.snippets)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-alt" aria-hidden="true">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, m.share)}%` }} />
                        </div>
                        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-muted">{m.share}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <ChangeBadge change={m.change} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line text-sm">
                  <td className="px-6 py-3" />
                  <th scope="row" className="px-3 py-3 text-left font-semibold text-ink">Whole team</th>
                  <td className="px-3 py-3 text-right font-mono text-xs font-semibold tabular-nums text-ink">{n(team.total.cur)}</td>
                  <td className="px-3 py-3" />
                  <td className="px-3 py-3" />
                  <td className="px-6 py-3 text-right">
                    <ChangeBadge change={team.total} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
