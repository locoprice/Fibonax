import type { LucideIcon } from 'lucide-react';
import { CalendarCheck, Clock, Layers, MousePointerClick } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/shared/Sparkline';
import type { UsageAnalyticsApi, UsageChange, UsageReport } from '@/lib/usageAnalytics';
import { ChangeBadge } from './ChangeBadge';

interface UsageSummaryProps {
  report: UsageReport;
  engine: UsageAnalyticsApi;
}

interface FigureProps {
  label: string;
  value: string;
  icon: LucideIcon;
  change: UsageChange;
  previous: string;
  hint: string;
  /** A small line of the period's daily counts beside the number. */
  trend?: number[];
}

/**
 * One headline figure: a quiet label and icon, the number, the change badge
 * with the figure before, and one line saying what it covers.
 */
function Figure({ label, value, icon: Icon, change, previous, hint, trend }: FigureProps) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        <Icon className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0 truncate text-[30px] font-semibold leading-none tracking-tight text-ink" title={value}>
          {value}
        </div>
        {trend ? <Sparkline values={trend} className="mb-0.5 h-7 w-20 shrink-0 text-primary" /> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <ChangeBadge change={change} />
        <span className="text-ink-muted">{previous}</span>
      </div>
      <p className="mt-2 truncate text-xs text-ink-subtle" title={hint}>{hint}</p>
    </Card>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
      {hint ? <dd className="text-xs text-ink-subtle">{hint}</dd> : null}
    </div>
  );
}

/** The four headline figures for the period, each against the one before it, and a row of detail. */
export function UsageSummary({ report, engine }: UsageSummaryProps) {
  const t = report.totals;
  const n = engine.formatCount;
  const before = `before: `;
  const streak = report.patterns.streak;
  return (
    <>
      <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
        <Figure
          label="Snippets inserted"
          value={n(t.uses.cur)}
          icon={MousePointerClick}
          change={t.uses}
          previous={`${before}${n(t.uses.prev)}`}
          hint={`${t.avgPerDay.cur} a day on average`}
          trend={report.series.map((p) => p.count)}
        />
        <Figure
          label="Time saved"
          value={engine.formatDuration(t.secondsSaved.cur)}
          icon={Clock}
          change={t.secondsSaved}
          previous={`${before}${engine.formatDuration(t.secondsSaved.prev)}`}
          hint={`Estimated at ${engine.SECONDS_PER_USE} seconds per insert`}
        />
        <Figure
          label="Active days"
          value={`${n(t.activeDays.cur)} of ${n(t.days)}`}
          icon={CalendarCheck}
          change={t.activeDays}
          previous={`${before}${n(t.activeDays.prev)}`}
          hint={t.activeDays.cur ? `${t.avgPerActiveDay} inserts on a day you used Fibonax` : 'No inserts in this period'}
        />
        <Figure
          label="Different snippets used"
          value={n(t.snippetsUsed.cur)}
          icon={Layers}
          change={t.snippetsUsed}
          previous={`${before}${n(t.snippetsUsed.prev)}`}
          hint={`${report.health.usedShare}% of the ${n(report.health.library)} snippets you can use`}
        />
      </div>
      <Card className="mt-5 px-6 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          <Fact
            label="Busiest day"
            value={t.bestDay ? `${t.bestDay.label}` : '—'}
            hint={t.bestDay ? `${n(t.bestDay.count)} inserts` : 'No inserts yet'}
          />
          <Fact
            label="Daily streak"
            value={`${streak.currentAtLeast ? 'At least ' : ''}${n(streak.current)} ${streak.current === 1 ? 'day' : 'days'}`}
            hint={`Longest in this period: ${n(streak.longestInPeriod)}`}
          />
          <Fact
            label="Fields filled per insert"
            value={String(t.avgFieldsPerUse)}
            hint={`${t.usesWithFieldsShare}% of inserts had a form`}
          />
          <Fact
            label="Weekdays"
            value={`${report.patterns.workdayShare}%`}
            hint="of inserts from Monday to Friday"
          />
        </dl>
      </Card>
    </>
  );
}
