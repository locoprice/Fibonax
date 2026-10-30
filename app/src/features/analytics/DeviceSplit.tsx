import { History, Monitor, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UsageAnalyticsApi, UsageDeviceSplit } from '@/lib/usageAnalytics';

interface DeviceSplitProps {
  split: UsageDeviceSplit;
  engine: UsageAnalyticsApi;
  /** `bar` draws the stacked bar with a legend under it; `compact` an icon line for a table row. */
  variant: 'bar' | 'compact';
  className?: string;
}

/** Computer, phone, then uses logged before devices were recorded, in that order everywhere. */
const PARTS = [
  { key: 'computer', fill: 'bg-primary', Icon: Monitor },
  { key: 'phone', fill: 'bg-[var(--activity-2)]', Icon: Smartphone },
  { key: 'unknown', fill: 'bg-line', Icon: History },
] as const;

function shareOf(split: UsageDeviceSplit, key: (typeof PARTS)[number]['key']): number {
  return key === 'computer' ? split.computerShare : key === 'phone' ? split.phoneShare : split.unknownShare;
}

/** One sentence a screen reader reads instead of the bar: "Computer 60%, Phone 40%". */
function spoken(split: UsageDeviceSplit, engine: UsageAnalyticsApi): string {
  return PARTS.filter((p) => split[p.key] > 0)
    .map((p) => `${engine.DEVICE_LABELS[p.key]} ${shareOf(split, p.key)}%`)
    .join(', ');
}

/**
 * Where uses happened: on a computer (the Chrome extension, the dashboard) or
 * on the phone app, and what was logged before devices were recorded. Never
 * colour alone: every part carries its icon (and, under the bar, its name) and
 * its percentage, and a row's parts add up to its uses.
 */
export function DeviceSplit({ split, engine, variant, className }: DeviceSplitProps) {
  const total = split.computer + split.phone + split.unknown;
  if (!total) return null;
  const shown = PARTS.filter((p) => split[p.key] > 0);

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center justify-end gap-2.5 text-xs tabular-nums text-ink-muted', className)}>
        <span className="sr-only">{spoken(split, engine)}</span>
        {split.unknown === total ? (
          <span className="text-ink-subtle" aria-hidden="true">
            {engine.DEVICE_LABELS.unknown}
          </span>
        ) : (
          shown.map(({ key, Icon }) => (
            <span
              key={key}
              className={cn('inline-flex items-center gap-1', key === 'unknown' && 'text-ink-subtle')}
              aria-hidden="true"
              title={engine.DEVICE_LABELS[key]}
            >
              <Icon className="h-3.5 w-3.5" />
              {Math.round(shareOf(split, key))}%
            </span>
          ))
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-bg-alt" role="img" aria-label={spoken(split, engine)}>
        {shown.map((p) => (
          <div key={p.key} className={cn('h-full', p.fill)} style={{ width: `${shareOf(split, p.key)}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted" aria-hidden="true">
        {shown.map(({ key, fill, Icon }) => (
          <li key={key} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', fill)} />
            <Icon className="h-3.5 w-3.5" />
            {engine.DEVICE_LABELS[key]}
            <span className="tabular-nums text-ink">{shareOf(split, key)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
