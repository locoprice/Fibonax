import type { ReactElement } from 'react';
import { Lock } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/card';
import { PRO_SOON_LABEL } from '@/lib/proFeatures';

/**
 * Business Intelligence: a Pro section that is not built yet. The page holds
 * its place in the sidebar and says so plainly, with the same words every
 * locked Pro control uses (lib/proFeatures.ts), with a Lichess puzzle below.
 */
export function BusinessIntelligencePage(): ReactElement {
  return (
    <>
      <PageHeader title="Business Intelligence" />
      <Card className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold text-ink">Coming soon</h2>
        <p className="text-sm text-ink-muted">{PRO_SOON_LABEL}</p>
        {/* A chess puzzle to try while the section is being built. */}
        <iframe
          src="https://lichess.org/training/frame?theme=brown&bg=dark"
          title="Chess puzzle"
          loading="lazy"
          className="mt-6 h-[444px] w-[400px] max-w-full rounded-[12px] border-0"
        />
      </Card>
    </>
  );
}
