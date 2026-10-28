import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActivityData, ActivityMonth } from '@/types/database';

interface ContributionActivityProps {
  data: ActivityData;
  showPrivate: boolean;
}

/** Months shown before "Show earlier months"; keeps Usage and Top triggers in view. */
const VISIBLE_MONTHS = 1;

export function ContributionActivity({ data, showPrivate }: ContributionActivityProps) {
  const [expanded, setExpanded] = useState(false);
  const timeline = data.overview.timeline;
  const hiddenCount = Math.max(0, timeline.length - VISIBLE_MONTHS);
  const months = expanded ? timeline : timeline.slice(0, VISIBLE_MONTHS);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs uppercase tracking-wide text-ink-subtle">Contribution activity</h4>
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

      {timeline.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          No snippet activity yet. Expansions will show up here as you use your snippets.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {months.map((month) => (
            <MonthRow key={month.key} month={month} showPrivate={showPrivate} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MonthRow({ month, showPrivate }: { month: ActivityMonth; showPrivate: boolean }) {
  const folderWord = month.items.length === 1 ? 'folder' : 'folders';

  const headline = showPrivate
    ? `Expanded snippets ${month.total.toLocaleString()} times across ${month.items.length} ${folderWord}`
    : `Active across ${month.items.length} ${folderWord}`;

  return (
    <li className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
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
    </li>
  );
}
