import type { ReactElement } from 'react';
import { Lock } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/card';

/**
 * Business Intelligence: a Pro section that is not built yet. The page holds
 * its place in the sidebar and says so plainly, then offers a Lichess puzzle.
 */
export function BusinessIntelligencePage(): ReactElement {
  return (
    <>
      <PageHeader title="Business Intelligence" />
      <Card className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold text-ink">Coming soon / Pro Users</h2>
        {/* A chess puzzle to try while the section is being built. Lichess's
            widget is a preview that navigates away on click, so the board
            takes no clicks itself: the link around it opens the puzzle on
            Lichess in a new tab and the dashboard stays where it is. */}
        <a
          href="https://lichess.org/training/daily"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open today's chess puzzle on Lichess (opens in a new tab)"
          className="mt-6 block max-w-full rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <iframe
            src="https://lichess.org/training/frame?theme=brown&bg=dark"
            title="Chess puzzle of the day"
            loading="lazy"
            tabIndex={-1}
            className="pointer-events-none block h-[666px] w-[600px] max-w-full rounded-[12px] border-0"
          />
        </a>
        <p className="text-xs text-ink-subtle">Click the board to play it on Lichess, in a new tab.</p>
      </Card>
    </>
  );
}
