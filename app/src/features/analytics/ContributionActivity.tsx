import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActivityData, ActivityMonth } from '@/types/database';

interface ContributionActivityProps {
  data: ActivityData;
  showPrivate: boolean;
}

/**
 * Month by month, under the year grid. Folded, it is one line about the
 * current month, so the sections below stay in view. Unfolded, every month
 * gets a compact block with one thin bar per folder, in columns, so a year of
 * history fits on one screen.
 */
export function ContributionActivity({ data, showPrivate }: ContributionActivityProps) {
  const [expanded, setExpanded] = useState(false);
  const timeline = data.overview.timeline;
  const current = timeline[0];
  const hiddenCount = Math.max(0, timeline.length - 1);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-medium text-ink-subtle">Month by month</h4>
        {hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show less' : `Show earlier months (${hiddenCount})`}
          </Button>
        )}
      </div>

      {!current ? (
        <p className="mt-2 text-sm text-ink-muted">
          No inserts yet. Months show up here as you use your snippets.
        </p>
      ) : expanded ? (
        <div className="mt-3 grid grid-cols-2 gap-x-10 gap-y-6 2xl:grid-cols-3">
          {timeline.map((month) => (
            <MonthGroup key={month.key} month={month} showPrivate={showPrivate} />
          ))}
        </div>
      ) : (
        <MonthLine month={current} showPrivate={showPrivate} />
      )}
    </div>
  );
}

function folderWord(n: number): string {
  return n === 1 ? 'folder' : 'folders';
}

/** The current month as one line: its total and a chip per folder. */
function MonthLine({ month, showPrivate }: { month: ActivityMonth; showPrivate: boolean }) {
  const headline = showPrivate
    ? `${month.total.toLocaleString()} inserts across ${month.items.length} ${folderWord(month.items.length)}`
    : `Active across ${month.items.length} ${folderWord(month.items.length)}`;

  return (
    <div className="mt-2 flex items-center gap-4">
      <div className="w-72 shrink-0">
        <p className="text-sm font-semibold text-ink">{month.label}</p>
        <p className="text-xs text-ink-muted">{headline}</p>
      </div>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {month.items.map((item) => (
          <span
            key={item.label}
            className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full bg-bg-alt px-2.5 py-1 text-xs text-ink"
            title={item.label}
          >
            <span className="truncate">{item.label}</span>
            {showPrivate && (
              <span className="tabular-nums text-ink-muted">{item.count.toLocaleString()}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One month as a compact block: its total, then a thin bar per folder. */
function MonthGroup({ month, showPrivate }: { month: ActivityMonth; showPrivate: boolean }) {
  const maxCount = Math.max(1, ...month.items.map((i) => i.count));
  const summary = showPrivate
    ? `${month.total.toLocaleString()} inserts · ${month.items.length} ${folderWord(month.items.length)}`
    : `${month.items.length} ${folderWord(month.items.length)}`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{month.label}</p>
        <p className="text-xs tabular-nums text-ink-muted">{summary}</p>
      </div>
      <div className="mt-2 space-y-1.5">
        {month.items.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs text-ink-muted" title={item.label}>
              {item.label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-alt">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round((item.count / maxCount) * 100)}%` }}
              />
            </div>
            <span className="w-7 shrink-0 text-right text-xs tabular-nums text-ink">
              {showPrivate ? item.count.toLocaleString() : '·'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
