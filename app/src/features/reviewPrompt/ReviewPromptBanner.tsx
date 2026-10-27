import { useEffect } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  REVIEW_PROMPT_MESSAGE,
  REVIEW_PROMPT_REVIEW_ARIA_LABEL,
  REVIEW_PROMPT_REVIEW_LABEL,
  REVIEW_PROMPT_STOP_LABEL,
  REVIEW_PROMPT_URL,
} from '@/lib/reviewPrompt';
import { useAuthStore } from '@/stores/authStore';
import { useReviewPromptStore } from '@/stores/reviewPromptStore';

/**
 * Asks a free account for a Chrome Web Store review: one line and a button, in
 * the strip the invitation notice uses. It decides for itself whether to
 * appear (see the review prompt store), so the layout just mounts it.
 */
export function ReviewPromptBanner() {
  const userId = useAuthStore((s) => s.user?.id);
  const visible = useReviewPromptStore((s) => s.visible);
  const check = useReviewPromptStore((s) => s.check);
  const review = useReviewPromptStore((s) => s.review);
  const dismiss = useReviewPromptStore((s) => s.dismiss);

  useEffect(() => {
    if (userId) void check(userId);
  }, [userId, check]);

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Review Fibonax"
      className="flex items-center gap-3 border-b border-line bg-primary-light px-8 py-2 text-sm text-ink"
    >
      <Star className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{REVIEW_PROMPT_MESSAGE}</span>
      <Button asChild size="sm">
        <a
          href={REVIEW_PROMPT_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={REVIEW_PROMPT_REVIEW_ARIA_LABEL}
          onClick={review}
        >
          {REVIEW_PROMPT_REVIEW_LABEL}
        </a>
      </Button>
      <Button type="button" variant="link" size="sm" onClick={dismiss}>
        {REVIEW_PROMPT_STOP_LABEL}
      </Button>
    </div>
  );
}
