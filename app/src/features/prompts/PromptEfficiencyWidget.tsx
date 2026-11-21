import { Gauge, TrendingUp } from 'lucide-react';
import { QualityPanel, qualityAnnouncement } from '@/components/shared/QualityPanel';
import { formatScore } from '@/lib/qualityScore';
import type { EvalResult } from '@/lib/usePromptEvaluator';
import { PanelDisclosure } from '@/features/prompts/PanelDisclosure';

/** Percentile of this prompt against the user's existing prompt corpus. */
export interface PromptBenchmark {
  /** 0 to 100: % of the corpus this prompt scores higher than. */
  percentile: number;
  /** Number of other prompts the percentile was computed against. */
  corpusSize: number;
  /** When set, the percentile is scoped to prompts of this intent (e.g. "Coding"). */
  scopeLabel?: string;
}

export interface PromptEfficiencyWidgetProps {
  result: EvalResult;
  onApply: (criterionId: string) => void;
  /** Optional corpus benchmark; hidden when the library is too small to be meaningful. */
  benchmark?: PromptBenchmark | null;
}

/**
 * The prompt's Quality score in the editor: one closed row with the score and
 * how many tips are waiting, opening to the same panel the snippet editor's
 * Quality window shows.
 */
export function PromptEfficiencyWidget({ result, onApply, benchmark }: PromptEfficiencyWidgetProps) {
  const { score, criteria } = result;
  const tips = criteria.filter((c) => c.status !== 'pass').length;

  return (
    <>
      {/*
        Dedicated live region outside the button: screen readers announce score
        changes here. Placing role="status" inside a <button> causes it to be
        ignored by most AT.
      */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {qualityAnnouncement('Prompt quality', result)
          + (benchmark
            ? ` Stronger than ${benchmark.percentile}% of your ${benchmark.corpusSize}`
              + `${benchmark.scopeLabel ? ` ${benchmark.scopeLabel}` : ''} prompts.`
            : '')}
      </span>

      <PanelDisclosure
        id="prompt-quality-panel"
        icon={Gauge}
        title={
          <>
            Quality{' '}
            <span className="font-semibold tabular-nums text-primary">{formatScore(score)}/10</span>
          </>
        }
        summary={tips === 0 ? 'Every check passes' : `${tips} ${tips === 1 ? 'tip' : 'tips'} to improve`}
      >
        <QualityPanel
          result={result}
          tone="light"
          idPrefix="crit"
          listLabel="Prompt quality checks"
          onApply={onApply}
        >
          {/* Corpus benchmark: percentile against the user's existing prompts */}
          {benchmark && (
            <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-line bg-bg-alt px-3 py-2">
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-xs text-ink-muted">
                Stronger than{' '}
                <span className="font-semibold text-ink">{benchmark.percentile}%</span>
                {' '}of your {benchmark.corpusSize}
                {benchmark.scopeLabel ? ` ${benchmark.scopeLabel}` : ''} prompts
              </p>
            </div>
          )}
        </QualityPanel>
      </PanelDisclosure>
    </>
  );
}
