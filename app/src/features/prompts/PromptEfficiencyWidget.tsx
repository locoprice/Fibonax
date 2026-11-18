import { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp } from 'lucide-react';
import { QualityPanel, qualityAnnouncement } from '@/components/shared/QualityPanel';
import { formatScore } from '@/lib/qualityScore';
import type { EvalResult } from '@/lib/usePromptEvaluator';

/** Percentile of this prompt against the user's existing prompt corpus. */
export interface PromptBenchmark {
  /** 0–100: % of the corpus this prompt scores higher than. */
  percentile: number;
  /** Number of other prompts the percentile was computed against. */
  corpusSize: number;
  /** When set, the percentile is scoped to prompts of this intent (e.g. "Coding"). */
  scopeLabel?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(pct: number): string {
  if (pct >= 80) return '#34C759'; // success
  if (pct >= 50) return '#1B4FD8'; // primary
  return '#FEBC2E';                // warning
}

// ── Main widget ────────────────────────────────────────────────────────────────

export interface PromptEfficiencyWidgetProps {
  result: EvalResult;
  onApply: (criterionId: string) => void;
  /** Optional corpus benchmark; hidden when the library is too small to be meaningful. */
  benchmark?: PromptBenchmark | null;
}

export function PromptEfficiencyWidget({ result, onApply, benchmark }: PromptEfficiencyWidgetProps) {
  const [expanded, setExpanded] = useState(true);
  const { score, pct, criteria } = result;
  const color = scoreColor(pct);
  const attentionCount = criteria.filter((c) => c.status !== 'pass').length;

  return (
    <div className="border-b border-[#161619]">
      {/*
        Dedicated live region outside the button — screen readers announce score
        changes here. Placing role="status" inside a <button> causes it to be
        ignored by most AT.
      */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {qualityAnnouncement('Prompt efficiency', result)
          + (benchmark
            ? ` Stronger than ${benchmark.percentile}% of your ${benchmark.corpusSize}`
              + `${benchmark.scopeLabel ? ` ${benchmark.scopeLabel}` : ''} prompts.`
            : '')}
      </span>

      {/* ── Collapsible header ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[#0A0A0F] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#1B4FD8]/40"
        aria-expanded={expanded}
        aria-controls="prompt-efficiency-panel"
      >
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#83838D]">
          Efficiency Score
        </span>

        {/* Visual score badge — screen readers use the sr-only live region above. */}
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{ color, backgroundColor: `${color}1A` }}
          aria-hidden="true"
        >
          {formatScore(score)}/10
        </span>

        {/* Pending-work summary when collapsed */}
        {attentionCount > 0 && !expanded && (
          <span className="text-[10px] text-[#5A5A62]">
            · {attentionCount} to improve
          </span>
        )}

        <span className="ml-auto">
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 text-[#5A5A62]" />
            : <ChevronDown className="h-3.5 w-3.5 text-[#5A5A62]" />}
        </span>
      </button>

      {/*
        Panel is always in the DOM so aria-controls always has a valid target.
        The HTML hidden attribute removes it from layout and the a11y tree when
        collapsed, without breaking the aria-controls reference.
      */}
      <div id="prompt-efficiency-panel" hidden={!expanded} className="px-5 pb-4">
        <QualityPanel
          result={result}
          tone="dark"
          idPrefix="crit"
          listLabel="Prompt evaluation criteria"
          onApply={onApply}
        >
          {/* Corpus benchmark: percentile against the user's existing prompts */}
          {benchmark && (
            <div className="mb-3 flex items-center gap-2 rounded-[8px] border border-[#161619] bg-[#0A0A0D] px-3 py-2">
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-[#1B4FD8]" aria-hidden="true" />
              <p className="text-[11px] text-[#9A9AA5]">
                Stronger than{' '}
                <span className="font-semibold text-[#D6D6DE]">{benchmark.percentile}%</span>
                {' '}of your {benchmark.corpusSize}
                {benchmark.scopeLabel ? ` ${benchmark.scopeLabel}` : ''} prompts
              </p>
            </div>
          )}
        </QualityPanel>
      </div>
    </div>
  );
}
