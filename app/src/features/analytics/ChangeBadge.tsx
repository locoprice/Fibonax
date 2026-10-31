import { cn } from '@/lib/utils';
import type { UsageChange } from '@/lib/usageAnalytics';

interface ChangeBadgeProps {
  change: UsageChange;
  /** For a figure where less is better (none today); flips the colour, never the arrow. */
  inverse?: boolean;
  className?: string;
}

/**
 * How a figure moved against the previous period: an arrow and the wording the
 * shared module decided ("+12%", "−3%", "New", "No change"). The arrow carries
 * the direction, so the meaning never rests on colour alone.
 */
export function ChangeBadge({ change, inverse = false, className }: ChangeBadgeProps) {
  const good = inverse ? change.dir === 'down' : change.dir === 'up';
  const bad = inverse ? change.dir === 'up' : change.dir === 'down';
  const arrow = change.dir === 'up' ? '↑' : change.dir === 'down' ? '↓' : '';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        good && 'bg-success/10 text-success',
        bad && 'bg-danger/10 text-danger',
        !good && !bad && 'bg-bg-alt text-ink-muted',
        className,
      )}
    >
      {arrow ? <span aria-hidden="true">{arrow}</span> : null}
      {change.text}
    </span>
  );
}
