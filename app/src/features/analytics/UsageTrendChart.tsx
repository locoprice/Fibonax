import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UsageReport } from '@/lib/usageAnalytics';

interface UsageTrendChartProps {
  report: UsageReport;
}

const SERIES_NAMES: Record<string, string> = {
  count: 'Inserts',
  prev: 'Previous period',
  avg7: '7-day average',
};

/**
 * Inserts per day for the period, the same day of the previous period beside
 * them, and a trailing 7-day average from 30 days up. Colours come from the
 * theme: Azure bars (the wrapper's text-primary, read as currentColor) for this
 * period, a muted dashed line for the one before, and the ink line for the
 * average, so "now" always reads first.
 */
export function UsageTrendChart({ report }: UsageTrendChartProps) {
  const days = report.series.length;
  // About eight labels across the axis whatever the period.
  const interval = Math.max(0, Math.ceil(days / 8) - 1);
  const showAvg = report.series.some((p) => p.avg7 !== null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inserts per day</CardTitle>
        <CardDescription>
          {report.rangeLabel}, with {report.prevRangeLabel} dashed for comparison.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full text-primary">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={report.series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--color-ink-subtle)' }}
                axisLine={{ stroke: 'var(--color-line)' }}
                tickLine={false}
                interval={interval}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'var(--color-ink-subtle)' }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                cursor={{ fill: 'var(--color-bg-alt)' }}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid var(--color-line)',
                  background: 'var(--color-card)',
                  fontSize: 12,
                }}
                labelFormatter={(label: string, payload) => {
                  const point = payload?.[0]?.payload as { weekday?: string } | undefined;
                  return point?.weekday ? `${point.weekday} ${label}` : label;
                }}
                formatter={(value: number | string, name: string) => [value ?? '—', SERIES_NAMES[name] ?? name]}
              />
              <Legend
                formatter={(name: string) => SERIES_NAMES[name] ?? name}
                wrapperStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="count" fill="currentColor" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Line
                type="linear"
                dataKey="prev"
                stroke="var(--color-ink-subtle)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
              {showAvg ? (
                <Line
                  type="monotone"
                  dataKey="avg7"
                  stroke="var(--color-ink)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
