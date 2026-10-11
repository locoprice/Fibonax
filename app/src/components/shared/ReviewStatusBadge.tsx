import { Clock3 } from 'lucide-react';
import { reviewStatusHint, reviewStatusLabel, reviewTone, type ReviewStatus, type ReviewTone } from '@/lib/reviewStatus';
import { cn } from '@/lib/utils';

/**
 * Review status chip (AI-KNOWLEDGE P2), beside an item's name in every list:
 * the snippets table, the prompt cards and a Brain's items. One component for
 * all three so a status reads the same wherever it appears.
 *
 * Approved draws nothing: it is how most of a library stands, and a badge on
 * every row would stop meaning anything.
 */

const TONE_CLASS: Record<ReviewTone, string> = {
  muted: 'border-line bg-bg-alt text-ink-muted',
  info: 'border-primary/20 bg-primary-light text-primary',
  warning: 'border-warning-deep/20 bg-warning-bg text-warning-deep',
  danger: 'border-danger/20 bg-danger-bg text-danger',
};

interface ReviewStatusBadgeProps {
  status: ReviewStatus;
  className?: string;
}

export function ReviewStatusBadge({ status, className }: ReviewStatusBadgeProps) {
  const tone = reviewTone(status);
  if (tone === null) return null;
  return (
    <span
      title={reviewStatusHint(status)}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-semibold leading-4',
        status === 'under_review'
          ? 'gap-1 rounded-none border-0 bg-transparent px-0 font-medium text-ink-muted'
          : TONE_CLASS[tone],
        className,
      )}
    >
      {status === 'under_review' && <Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {reviewStatusLabel(status)}
    </span>
  );
}
