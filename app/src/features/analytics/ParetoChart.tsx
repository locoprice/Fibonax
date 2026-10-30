import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { ParetoKindReport, ParetoRow, UsageAnalyticsApi } from '@/lib/usageAnalytics';

interface ParetoChartProps {
  report: ParetoKindReport;
  engine: UsageAnalyticsApi;
}

/** More bars than this turn into hairlines; the rest are still in the list. */
const CHART_LIMIT = 30;
const AXIS_TICK = { fontSize: 11, fill: 'var(--color-ink-muted)' };

interface ChartPoint extends ParetoRow {
  isKey: boolean;
}

function ParetoTooltip({ active, payload, engine }: TooltipProps<number, string> & { engine: UsageAnalyticsApi }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as ChartPoint | undefined;
  if (!point) return null;
  return (
    <div className="max-w-[240px] rounded-[10px] border border-line bg-card px-3 py-2 text-xs shadow-md">
      <p className="truncate font-semibold text-ink">
        {point.rank}. {point.title}
      </p>
      <p className="mt-1 tabular-nums text-ink">
        {engine.formatCount(point.uses)} {point.uses === 1 ? 'use' : 'uses'} · {point.share}%
      </p>
      <p className="mt-0.5 tabular-nums text-ink-muted">Top {point.rank} together: {point.cumShare}%</p>
    </div>
  );
}

/**
 * The classic 80/20 picture: one bar per item, most used first, and the
 * running total as a line against an 80% marker. Bars in the key group are
 * Azure; the rest are a lighter tint of it, so the split reads at a glance.
 */
export function ParetoChart({ report, engine }: ParetoChartProps) {
  const rows = report.key.concat(report.rest);
  const data: ChartPoint[] = rows.slice(0, CHART_LIMIT).map((r) => ({ ...r, isKey: r.rank <= report.keyGroup.count }));
  const noun = report.kind === 'prompt' ? 'prompts' : 'snippets';
  return (
    <div>
      <div
        className="h-[240px] w-full"
        role="img"
        aria-label={`Chart of your ${noun} by uses. ${report.headline}.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="rank" tick={AXIS_TICK} axisLine={{ stroke: 'var(--color-line)' }} tickLine={false} tickMargin={6} />
            <YAxis yAxisId="uses" allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} />
            <YAxis
              yAxisId="share"
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 50, report.target, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip cursor={{ fill: 'var(--color-bg-alt)' }} content={<ParetoTooltip engine={engine} />} />
            <ReferenceLine
              yAxisId="share"
              y={report.target}
              stroke="var(--color-ink-subtle)"
              strokeDasharray="4 4"
            />
            <Bar yAxisId="uses" dataKey="uses" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.isKey ? 'var(--activity-4)' : 'var(--activity-1)'} />
              ))}
            </Bar>
            <Line
              yAxisId="share"
              type="monotone"
              dataKey="cumShare"
              stroke="var(--color-ink)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: 'var(--color-ink)', stroke: 'var(--color-card)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--activity-4)]" aria-hidden="true" />
          Your key {noun}
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--activity-1)]" aria-hidden="true" />
          The rest
        </li>
        <li className="flex items-center gap-2">
          <span className="w-4 border-t-2 border-ink" aria-hidden="true" />
          Running total
        </li>
        <li className="flex items-center gap-2">
          <span className="w-4 border-t-2 border-dashed border-ink-subtle" aria-hidden="true" />
          {report.target}% mark
        </li>
        {rows.length > CHART_LIMIT ? (
          <li className="text-ink-subtle">
            Showing your top {CHART_LIMIT} of {engine.formatCount(rows.length)}.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
