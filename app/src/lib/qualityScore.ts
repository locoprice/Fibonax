// The shape of a quality score, shared by the prompt evaluator
// (usePromptEvaluator) and the snippet rating (snippetQuality), so one panel
// (components/shared/QualityPanel) draws both.
//
// Each criterion contributes value (0 to 1) x weight to a weighted average, so
// a weak criterion that matters a lot moves the score more than a strong one
// that matters little.

export type CriterionStatus = 'pass' | 'partial' | 'fail';

export interface EvalCriterion {
  id: string;
  label: string;
  description: string;
  /** Resolved status used for the icon and colour. */
  status: CriterionStatus;
  /** 0 to 1 graded value (partial credit). Drives the weighted score. */
  value: number;
  /** Relative importance in the weighted average. */
  weight: number;
  /** Why the criterion landed on this status: explains the score. */
  rationale: string;
  /** Concrete improvement example, shown for partial and fail. */
  example?: string;
  /** One-click auto-fix label (enable a block, apply a metadata default). */
  suggestionLabel?: string;
}

export interface EvalResult {
  /** Weighted 0 to 10, one decimal. */
  score: number;
  /** Weighted 0 to 100 (integer). */
  pct: number;
  criteria: EvalCriterion[];
}

/** Weighted score of a set of graded criteria. An empty set scores 0. */
export function scoreCriteria(criteria: EvalCriterion[]): EvalResult {
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const earned = criteria.reduce((sum, c) => sum + c.value * c.weight, 0);
  const ratio = totalWeight > 0 ? earned / totalWeight : 0;
  const pct = Math.round(ratio * 100);
  return { score: pct / 10, pct, criteria };
}

/** The word for a score, the same for prompts and snippets. */
export function qualityLabel(pct: number): string {
  if (pct >= 80) return 'Excellent';
  if (pct >= 50) return 'Good';
  return 'Needs improvement';
}

/** One-decimal display without a trailing ".0" (7 not 7.0, but 7.3 kept). */
export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
