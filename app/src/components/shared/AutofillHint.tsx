import { Info } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';

/** What each account detail fills in, in the words the tooltip shows. */
const HINTS = {
  name: 'Snippets with Your name fill it in by themselves. Fill it in once and your signatures sign for you.',
  company:
    'Snippets with Company name, and your seasonal wishes, fill it in by themselves. Everyone in a team you created uses it too.',
  'job title': 'Snippets with Job title fill it in by themselves, so a signature carries your role.',
} as const;

/**
 * The small "i" beside an account detail that snippets fill in by themselves
 * ({my: …}), saying why it is worth filling in. One component, so Settings and
 * Create your team say it the same way.
 */
export function AutofillHint({ detail }: { detail: keyof typeof HINTS }) {
  return (
    <Tooltip
      label={HINTS[detail]}
      placement="top"
      className="inline-flex items-center align-middle text-ink-subtle hover:text-ink transition-colors"
    >
      <Info className="h-3 w-3" aria-label="Why fill this in" />
    </Tooltip>
  );
}
