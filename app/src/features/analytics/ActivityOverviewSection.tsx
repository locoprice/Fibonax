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

/**
 * One row of figures under the activity grid: what the workspace holds
 * (snippets, prompts, folders, Brains) and how steadily it is used.
 */
export function ActivityOverviewSection({ data, showPrivate }: ActivityOverviewSectionProps) {
  const streaks = useMemo(() => computeStreaks(data.days), [data.days]);

  return (
    <dl className="grid grid-cols-7 gap-4">
      {data.overview.axes.map((axis) => (
        <Stat key={axis.key} label={axis.label} value={axis.count.toLocaleString()} />
      ))}
      <Stat label="Total this year" value={showPrivate ? data.total.toLocaleString() : 'Hidden'} />
      <Stat label="Current streak" value={`${streaks.current}d`} />
      <Stat label="Longest streak" value={`${streaks.longest}d`} />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
