import { useMemo } from 'react';
import type { ActivityData, ActivityDay } from '@/types/database';

interface ActivityOverviewSectionProps {
  data: ActivityData;
  showPrivate: boolean;
}

interface Streaks {
  current: number;
  longest: number;
}

function computeStreaks(days: ActivityDay[]): Streaks {
  let longest = 0;
  let run = 0;
  let current = 0;
  days.forEach((d, i) => {
    if (d.count > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
    if (i === days.length - 1) current = run;
  });
  return { current, longest };
}

function days(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/**
 * Under the year grid: one row of figures, what the workspace holds
 * (snippets, prompts, folders, Brains) and how steadily it is used, then the
 * folders you insert from most.
 */
export function ActivityOverviewSection({ data, showPrivate }: ActivityOverviewSectionProps) {
  const streaks = useMemo(() => computeStreaks(data.days), [data.days]);
  const activeFolders = data.overview.activeFolders;

  return (
    <div>
      <dl className="grid grid-cols-7 gap-4">
        {data.overview.axes.map((axis) => (
          <Stat key={axis.key} label={axis.label} value={axis.count.toLocaleString()} />
        ))}
        <Stat label="Inserts this year" value={showPrivate ? data.total.toLocaleString() : 'Hidden'} />
        <Stat label="Current streak" value={days(streaks.current)} />
        <Stat label="Longest streak" value={days(streaks.longest)} />
      </dl>

      <div className="mt-5">
        <p className="text-xs font-medium text-ink-subtle">Most used folders</p>
        {activeFolders.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeFolders.map((name) => (
              <span
                key={name}
                className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary"
              >
                {name}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">No folder activity yet.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tracking-tight text-ink">{value}</dd>
    </div>
  );
}
