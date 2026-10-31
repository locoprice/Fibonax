import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { Card } from '@/components/ui/card';
import type { UsageReport, UsageSeriesPoint } from '@/lib/usageAnalytics';

interface UsageTrendChartProps {
  report: UsageReport;
}

const AXIS_TICK = { fontSize: 11, fill: 'var(--color-ink-muted)' };

function TrendTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as UsageSeriesPoint | undefined;
  if (!point) return null;
  return (
    <div className="rounded-[10px] border border-line bg-card px-3 py-2 text-xs shadow-md">
      <p className="text-ink-muted">
        {point.weekday} {point.label}
      </p>
      <p className="mt-1 font-semibold tabular-nums text-ink">
        {point.count.toLocaleString()} {point.count === 1 ? 'insert' : 'inserts'}
      </p>
      <p className="mt-0.5 tabular-nums text-ink-muted">{point.prev.toLocaleString()} the period before</p>
      {point.avg7 !== null ? (
        <p className="tabular-nums text-ink-muted">{point.avg7.toLocaleString()} on average over 7 days</p>
      ) : null}
    </div>
  );
}

/**
 * Inserts per day for the period as one soft area, the same day of the
 * previous period as a thin dashed line, and a trailing 7-day average from
 * 30 days up. Colours come from the theme: the wrapper's text-primary is read
 * as currentColor for this period, a muted dashed line for the one before,
 * and the ink line for the average, so "now" always reads first.
 */
export function UsageTrendChart({ report }: UsageTrendChartProps) {
  const showAvg = report.series.some((p) => p.avg7 !== null);
  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold tracking-tight text-ink">Inserts per day</h3>
      <p className="mt-0.5 text-sm text-ink-muted">
        {report.rangeLabel}, with {report.prevRangeLabel} dashed for comparison.
      </p>
      <div className="mt-4 h-[260px] w-full text-primary">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={report.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              axisLine={{ stroke: 'var(--color-line)' }}
              tickLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              allowDecimals={false}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip cursor={{ stroke: 'var(--color-line)', strokeWidth: 1 }} content={<TrendTooltip />} />
            <Area
              type="monotone"
              dataKey="count"
              stroke="currentColor"
              strokeWidth={2}
              fill="currentColor"
              fillOpacity={0.08}
              dot={false}
              activeDot={{ r: 4, fill: 'currentColor', stroke: 'var(--color-card)', strokeWidth: 2 }}
            />
            <Line
              type="linear"
              dataKey="prev"
              stroke="var(--color-ink-subtle)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
            />
            {showAvg ? (
              <Line
                type="monotone"
                dataKey="avg7"
                stroke="var(--color-ink)"
                strokeWidth={2}
                dot={false}
                activeDot={false}
                connectNulls
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-4 rounded-[3px] border-t-2 border-primary bg-primary/10" aria-hidden="true" />
          Inserts
        </li>
        <li className="flex items-center gap-2">
          <span className="w-4 border-t-2 border-dashed border-ink-subtle" aria-hidden="true" />
          Previous period
        </li>
        {showAvg ? (
          <li className="flex items-center gap-2">
            <span className="w-4 border-t-2 border-ink" aria-hidden="true" />
            7-day average
          </li>
        ) : null}
      </ul>
    </Card>
  );
}
