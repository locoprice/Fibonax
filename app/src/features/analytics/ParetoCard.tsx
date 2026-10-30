import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import type { ParetoKindReport, ParetoReport, ParetoRow, UsageAnalyticsApi } from '@/lib/usageAnalytics';
import { DeviceSplit } from './DeviceSplit';
import { ParetoChart } from './ParetoChart';

export type ParetoKind = 'snippet' | 'prompt';

interface ParetoCardProps {
  report: ParetoReport;
  engine: UsageAnalyticsApi;
  kind: ParetoKind;
  onKindChange: (next: ParetoKind) => void;
  showChart: boolean;
  onShowChartChange: (next: boolean) => void;
}

const KIND_OPTIONS = [
  { value: 'snippet', label: 'Snippets' },
  { value: 'prompt', label: 'Prompts' },
] as const;

/** How many of "the rest" show before "Show all". */
const REST_PREVIEW = 5;

/** Rank · item · uses · share · where. One grid for the header and every row. */
const ROW_GRID = 'grid grid-cols-[1.5rem_minmax(0,1fr)_3.5rem_8rem_10.5rem] items-center gap-3';

function ShareBar({ share, muted }: { share: number; muted: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-alt" aria-hidden="true">
      <div className={muted ? 'h-full rounded-full bg-ink-subtle/50' : 'h-full rounded-full bg-primary'} style={{ width: `${Math.min(100, share)}%` }} />
    </div>
  );
}

function ParetoRows({ rows, muted, engine }: { rows: ParetoRow[]; muted: boolean; engine: UsageAnalyticsApi }) {
  return (
    <ol className="divide-y divide-line">
      {rows.map((row) => (
        <li key={row.key} className={`${ROW_GRID} py-2.5`}>
          <span className="text-xs tabular-nums text-ink-subtle">{row.rank}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{row.title}</div>
            {row.detail ? <div className="truncate text-xs text-ink-subtle">{row.detail}</div> : null}
          </div>
          <span className="text-right text-sm font-semibold tabular-nums text-ink">
            {engine.formatCount(row.uses)}
            <span className="sr-only"> uses</span>
          </span>
          <div className="flex items-center gap-2">
            <ShareBar share={row.share} muted={muted} />
            <span className="w-11 shrink-0 text-right text-xs tabular-nums text-ink-muted">{row.share}%</span>
          </div>
          <DeviceSplit split={row.device} engine={engine} variant="compact" />
        </li>
      ))}
    </ol>
  );
}

function GroupHeading({
  title,
  count,
  noun,
  share,
  engine,
}: {
  title: string;
  count: number;
  noun: [string, string];
  share: number;
  engine: UsageAnalyticsApi;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <span className="text-xs tabular-nums text-ink-muted">
        {engine.formatCount(count)} {count === 1 ? noun[0] : noun[1]} · {share}% of uses
      </span>
    </div>
  );
}

function KindBody({ report, engine, showChart }: { report: ParetoKindReport; engine: UsageAnalyticsApi; showChart: boolean }) {
  const [restOpen, setRestOpen] = useState(false);
  const noun = report.kind === 'prompt' ? 'prompts' : 'snippets';
  const nounOne = report.kind === 'prompt' ? 'prompt' : 'snippet';

  if (report.empty) {
    return (
      <div className="mt-5 rounded-[12px] bg-bg-alt px-4 py-5">
        <p className="text-sm font-medium text-ink">{report.headline}.</p>
        <p className="mt-1 text-sm text-ink-muted">{report.summary}</p>
      </div>
    );
  }

  const restRows = restOpen ? report.rest : report.rest.slice(0, REST_PREVIEW);
  const hiddenRest = report.rest.length - restRows.length;

  return (
    <>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:items-end">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-ink">{report.headline}</p>
          {report.summary ? <p className="mt-1 text-sm text-ink-muted">{report.summary}</p> : null}
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">Where your {noun} were used</p>
          <DeviceSplit split={report.device} engine={engine} variant="bar" />
        </div>
      </div>

      {showChart ? (
        <div className="mt-5 border-t border-line pt-5">
          <ParetoChart report={report} engine={engine} />
        </div>
      ) : null}

      <div className="mt-5">
        <div className={`${ROW_GRID} border-b border-line pb-2 text-xs text-ink-subtle`} aria-hidden="true">
          <span />
          <span className="capitalize">{nounOne}</span>
          <span className="text-right">Uses</span>
          <span>Share</span>
          <span className="text-right">Where used</span>
        </div>

        <div className="pt-4">
          <GroupHeading
            title={`Your key ${noun}`}
            count={report.keyGroup.count}
            noun={[nounOne, noun]}
            share={report.keyGroup.share}
            engine={engine}
          />
          <ParetoRows rows={report.key} muted={false} engine={engine} />
        </div>

        {report.rest.length ? (
          <div className="mt-4 border-t border-line pt-4">
            <GroupHeading
              title="The rest"
              count={report.restGroup.count}
              noun={[nounOne, noun]}
              share={report.restGroup.share}
              engine={engine}
            />
            <ParetoRows rows={restRows} muted engine={engine} />
            {report.rest.length > REST_PREVIEW ? (
              <button
                type="button"
                onClick={() => setRestOpen((v) => !v)}
                aria-expanded={restOpen}
                className="mt-2 rounded-[8px] px-2 py-1 text-xs font-medium text-primary hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {restOpen ? 'Show fewer' : `Show all ${engine.formatCount(report.rest.length)} (${engine.formatCount(hiddenRest)} more)`}
              </button>
            ) : null}
          </div>
        ) : null}

        {report.unused ? (
          <p className="mt-4 border-t border-line pt-4 text-sm text-ink-muted">
            {engine.formatCount(report.unused)} {report.unused === 1 ? nounOne : noun} in your library{' '}
            {report.unused === 1 ? 'was' : 'were'} not used in this period.
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * The 80/20 view: the few snippets or prompts that did most of your work in
 * the period, the rest under them, and where each was used. Every figure and
 * every sentence comes from the shared module (engine.pareto), so the phone
 * prints the same.
 */
export function ParetoCard({ report, engine, kind, onKindChange, showChart, onShowChartChange }: ParetoCardProps) {
  const current = kind === 'prompt' && report.prompts ? report.prompts : report.snippets;
  const options = report.prompts ? KIND_OPTIONS : KIND_OPTIONS.slice(0, 1);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-ink">What does most of your work</h3>
          <p className="mt-0.5 text-sm text-ink-muted">
            Ranked by uses in this period. Your key {current.kind === 'prompt' ? 'prompts' : 'snippets'} are the top
            ones that together reach {current.target}% of them.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {options.length > 1 ? (
            <Segmented ariaLabel="Show" options={options} value={current.kind} onChange={onKindChange} />
          ) : null}
          {!current.empty ? (
            <button
              type="button"
              onClick={() => onShowChartChange(!showChart)}
              aria-pressed={showChart}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-card px-3 text-xs font-medium text-ink hover:bg-bg-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              {showChart ? 'Hide chart' : 'Show chart'}
            </button>
          ) : null}
        </div>
      </div>

      <KindBody key={current.kind} report={current} engine={engine} showChart={showChart} />
    </Card>
  );
}
