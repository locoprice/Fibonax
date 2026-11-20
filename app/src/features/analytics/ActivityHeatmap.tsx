import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ActivityData, ActivityDay } from '@/types/database';
import { ContributionSettings } from './ContributionSettings';

interface ActivityHeatmapProps {
  data: ActivityData;
  showPrivate: boolean;
  showOverview: boolean;
  onChangePrivate: (next: boolean) => void;
  onChangeOverview: (next: boolean) => void;
  /** The breakdown under the grid; hidden with the "Show breakdown" switch. */
  children?: ReactNode;
}

const CELL = 11; // px — square size (matches GitHub)
const GAP = 3; // px — gap between cells
const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']; // rows Sun..Sat
const LEVELS = [0, 1, 2, 3, 4] as const;

/** Parse a 'YYYY-MM-DD' string as a local-noon Date (timezone-safe). */
function parseLocal(date: string): Date {
  const parts = date.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(y, m - 1, d, 12);
}

/** Map a raw count to an intensity level 0–4 against the window's peak. */
function levelFor(count: number, max: number): number {
  if (count <= 0) return 0;
  const step = Math.max(1, Math.ceil(max / 4));
  return Math.min(4, Math.ceil(count / step));
}

interface HoverState {
  text: string;
  x: number;
  y: number;
}

export function ActivityHeatmap({
  data,
  showPrivate,
  showOverview,
  onChangePrivate,
  onChangeOverview,
  children,
}: ActivityHeatmapProps) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const max = useMemo(
    () => data.days.reduce((m, d) => Math.max(m, d.count), 0),
    [data.days],
  );

  // Chunk the dense day list into week columns (start is a Sunday → 7 per column,
  // last column padded with null for days beyond today).
  const weeks = useMemo(() => {
    const cols: (ActivityDay | null)[][] = [];
    for (let i = 0; i < data.days.length; i += 7) {
      const col = data.days.slice(i, i + 7);
      while (col.length < 7) col.push(null as unknown as ActivityDay);
      cols.push(col);
    }
    return cols;
  }, [data.days]);

  // Month label per column — shown only when the month changes.
  const monthLabels = useMemo(() => {
    let prev = '';
    return weeks.map((col) => {
      const first = col.find(Boolean);
      if (!first) return '';
      const d = parseLocal(first.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (key === prev) return '';
      prev = key;
      return d.toLocaleString('en-US', { month: 'short' });
    });
  }, [weeks]);

  function tooltipFor(day: ActivityDay): string {
    const label = parseLocal(day.date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    if (!showPrivate) return `Counts hidden · ${label}`;
    if (day.count === 0) return `No inserts on ${label}`;
    return `${day.count} insert${day.count === 1 ? '' : 's'} on ${label}`;
  }

  function onCellEnter(e: React.MouseEvent<HTMLDivElement>, day: ActivityDay) {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover({
      text: tooltipFor(day),
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }

  const heading = showPrivate
    ? `${data.total.toLocaleString()} insert${data.total === 1 ? '' : 's'} in the last year`
    : 'Inserts in the last year';

  const labelColWidth = 30;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-ink">Daily activity</h3>
          <p className="mt-0.5 text-sm text-ink-muted">{heading}</p>
        </div>
        <ContributionSettings
          items={[
            {
              id: 'private',
              label: 'Show counts',
              description: 'Show exact insert counts in the heading and when you point at a square.',
              checked: showPrivate,
              onChange: onChangePrivate,
            },
            {
              id: 'overview',
              label: 'Show breakdown',
              description: 'Show the figures and the month by month view under the graph.',
              checked: showOverview,
              onChange: onChangeOverview,
            },
          ]}
        />
      </div>

      {/* One grid: a label column, then one column per week. The weeks share
          the width, so on a narrow card the squares shrink to fit instead of
          scrolling sideways, and they never grow past CELL. */}
      <div
        className="grid pb-1"
        style={{
          maxWidth: labelColWidth + weeks.length * (CELL + GAP),
          gridTemplateColumns: `${labelColWidth - GAP}px repeat(${weeks.length}, minmax(0, 1fr))`,
          gap: GAP,
        }}
      >
        {/* Month labels */}
        <div />
        {monthLabels.map((label, i) => (
          <div
            key={`m${i}`}
            className="overflow-visible whitespace-nowrap text-[10px] leading-none text-ink-muted"
            style={{ height: CELL }}
          >
            {label}
          </div>
        ))}

        {/* Weekday labels + squares, one row per weekday */}
        {WEEKDAY_LABELS.map((weekday, ri) => (
          <Fragment key={`r${ri}`}>
            <div className="self-center pr-1.5 text-right text-[9px] leading-none text-ink-muted">
              {weekday}
            </div>
            {weeks.map((col, ci) => {
              const day = col[ri];
              return day ? (
                <div
                  key={ci}
                  onMouseEnter={(e) => onCellEnter(e, day)}
                  onMouseLeave={() => setHover(null)}
                  className="aspect-square rounded-[2px]"
                  style={{
                    backgroundColor: `var(--activity-${levelFor(day.count, max)})`,
                    boxShadow: 'inset 0 0 0 1px var(--activity-cell-border)',
                  }}
                />
              ) : (
                <div key={ci} className="aspect-square" />
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-ink-subtle">Each square is one day. Darker means more inserts.</p>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span>Less</span>
          <div className="flex items-center" style={{ gap: GAP }}>
            {LEVELS.map((lvl) => (
              <div
                key={lvl}
                className="rounded-[2px]"
                style={{
                  width: CELL,
                  height: CELL,
                  backgroundColor: `var(--activity-${lvl})`,
                  boxShadow: 'inset 0 0 0 1px var(--activity-cell-border)',
                }}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>

      {showOverview && children ? (
        <div className="mt-5 space-y-5 border-t border-line pt-5">{children}</div>
      ) : null}

      {hover && (
        <div
          className={cn(
            'pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full',
            'rounded-[6px] bg-ink px-2 py-1 text-[11px] font-medium text-white shadow-md',
            'whitespace-nowrap',
          )}
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          {hover.text}
        </div>
      )}
    </Card>
  );
}
