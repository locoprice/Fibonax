import { useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { formatScore, qualityLabel, type CriterionStatus, type EvalCriterion, type EvalResult } from '@/lib/qualityScore';
import { cn } from '@/lib/utils';

/**
 * The body of a quality score: the ring, the word for it, and one row per
 * criterion that opens to say why and how to fix it. One component for the
 * prompt editor's Efficiency Score and the snippet editor's Quality window, so
 * the two read the same way.
 *
 * `tone="dark"` draws it in the prompt editor's dark side-panel palette (the
 * documented exception in docs/DESIGN_SYSTEM.md); `tone="light"` uses the
 * dashboard tokens and follows the theme.
 */

export type QualityTone = 'light' | 'dark';

interface ToneClasses {
  track: string;
  excellent: string;
  good: string;
  weak: string;
  scoreText: (pct: number) => string;
  outOf: string;
  heading: string;
  sub: string;
  rowHover: string;
  ring: string;
  label: string;
  labelPassed: string;
  chevron: string;
  rationale: string;
  description: string;
  example: string;
  exampleLead: string;
  hairline: string;
  apply: string;
  hint: string;
  pass: string;
  partial: string;
  fail: string;
}

// Dark: the prompt editor's own hexes, unchanged from the widget it replaced.
const TONES: Record<QualityTone, ToneClasses> = {
  dark: {
    track: 'stroke-[#1C1C20]',
    excellent: 'stroke-[#34C759]',
    good: 'stroke-[#1B4FD8]',
    weak: 'stroke-[#FEBC2E]',
    scoreText: (pct) => (pct >= 80 ? 'text-[#34C759]' : pct >= 50 ? 'text-[#1B4FD8]' : 'text-[#FEBC2E]'),
    outOf: 'text-[#5A5A62]',
    heading: 'text-[#E0E0E8]',
    sub: 'text-[#83838D]',
    rowHover: 'hover:bg-[#0E0E13]',
    ring: 'focus-visible:ring-[#1B4FD8]/40',
    label: 'text-[#D6D6DE]',
    labelPassed: 'text-[#83838D]',
    chevron: 'text-[#4A4A52]',
    rationale: 'text-[#9A9AA5]',
    description: 'text-[#5A5A62]',
    example: 'border-[#1A1A1E] bg-[#0A0A0D] text-[#8A8A95]',
    exampleLead: 'text-[#4A4A52]',
    hairline: 'bg-[#111114]',
    apply: 'border-[#26262B] bg-[#0E0E11] text-[#6080C8] hover:border-[#1B4FD8]/40 hover:bg-[#0A1020] hover:text-[#1B4FD8] focus:ring-[#1B4FD8]/30',
    hint: 'text-[#4A4A52]',
    pass: 'text-[#34C759]',
    partial: 'text-[#FEBC2E]',
    fail: 'text-[#FF5F57]',
  },
  light: {
    track: 'stroke-line',
    excellent: 'stroke-success',
    good: 'stroke-primary',
    weak: 'stroke-warning',
    scoreText: () => 'text-ink',
    outOf: 'text-ink-subtle',
    heading: 'text-ink',
    sub: 'text-ink-muted',
    rowHover: 'hover:bg-bg-alt',
    ring: 'focus-visible:ring-primary/40',
    label: 'text-ink',
    labelPassed: 'text-ink-muted',
    chevron: 'text-ink-subtle',
    rationale: 'text-ink',
    description: 'text-ink-subtle',
    example: 'border-line bg-bg-alt text-ink-muted',
    exampleLead: 'text-ink-subtle',
    hairline: 'bg-line',
    apply: 'border-line bg-card text-primary hover:border-primary/40 hover:bg-primary-light focus:ring-primary/30',
    hint: 'text-ink-subtle',
    pass: 'text-success',
    partial: 'text-warning-deep',
    fail: 'text-danger',
  },
};

function ringStroke(t: ToneClasses, pct: number): string {
  if (pct >= 80) return t.excellent;
  if (pct >= 50) return t.good;
  return t.weak;
}

const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ScoreRing({ pct, score, t }: { pct: number; score: number; t: ToneClasses }) {
  const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
  return (
    <div className="relative h-14 w-14 shrink-0">
      {/* -rotate-90 so progress starts at 12 o'clock */}
      <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx={28} cy={28} r={RING_RADIUS}
          fill="none" strokeWidth={4} className={t.track}
          strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={0}
        />
        <circle
          cx={28} cy={28} r={RING_RADIUS}
          fill="none" strokeWidth={4} strokeLinecap="round" className={ringStroke(t, pct)}
          strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 400ms cubic-bezier(0.4,0,0.2,1), stroke 400ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-sm font-bold leading-none tabular-nums', t.scoreText(pct))}>
          {formatScore(score)}
        </span>
        <span className={cn('text-[9px] leading-none', t.outOf)}>/10</span>
      </div>
    </div>
  );
}

function StatusIcon({ status, t }: { status: CriterionStatus; t: ToneClasses }) {
  if (status === 'pass') return <CheckCircle2 className={cn('h-3.5 w-3.5 shrink-0', t.pass)} aria-hidden="true" />;
  if (status === 'partial') return <AlertCircle className={cn('h-3.5 w-3.5 shrink-0', t.partial)} aria-hidden="true" />;
  return <XCircle className={cn('h-3.5 w-3.5 shrink-0', t.fail)} aria-hidden="true" />;
}

const STATUS_WORD: Record<CriterionStatus, string> = {
  pass: 'passed',
  partial: 'needs improvement',
  fail: 'not met',
};

interface CriterionRowProps {
  criterion: EvalCriterion;
  index: number;
  total: number;
  idPrefix: string;
  t: ToneClasses;
  onApply?: (id: string) => void;
}

function CriterionRow({ criterion, index, total, idPrefix, t, onApply }: CriterionRowProps) {
  const { id, label, status, suggestionLabel, description, rationale, example } = criterion;
  const [open, setOpen] = useState(false);
  const detailId = `${idPrefix}-detail-${id}`;

  return (
    <li className="rounded-[6px]">
      <div className="flex items-center gap-2">
        {/* Expand toggle: reveals rationale and example */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex flex-1 items-center gap-2 rounded-[6px] py-0.5 text-left transition-colors focus:outline-none focus-visible:ring-1',
            t.rowHover,
            t.ring,
          )}
          aria-expanded={open}
          aria-controls={detailId}
        >
          <StatusIcon status={status} t={t} />
          <span
            className={cn('flex-1 truncate text-[13px]', status === 'pass' ? t.labelPassed : t.label)}
            aria-label={`${label}: ${STATUS_WORD[status]}`}
          >
            {label}
          </span>
          {open
            ? <ChevronUp className={cn('h-3 w-3 shrink-0', t.chevron)} aria-hidden="true" />
            : <ChevronDown className={cn('h-3 w-3 shrink-0', t.chevron)} aria-hidden="true" />}
        </button>

        {/* One-click fix, where the section offers one */}
        {suggestionLabel && onApply && (
          <button
            type="button"
            onClick={() => onApply(id)}
            className={cn(
              'shrink-0 rounded-[6px] border px-2 py-0.5 text-[10px] font-medium transition-colors focus:outline-none focus:ring-1',
              t.apply,
            )}
          >
            + {suggestionLabel}
          </button>
        )}
      </div>

      <div id={detailId} hidden={!open} className="pb-1.5 pl-[22px] pr-1 pt-1">
        <p className={cn('text-xs leading-relaxed', t.rationale)}>{rationale}</p>
        {description && (
          <p className={cn('mt-0.5 text-[10px] leading-relaxed', t.description)}>{description}</p>
        )}
        {example && (
          <p className={cn('mt-1.5 rounded-[6px] border px-2.5 py-1.5 font-mono text-[10px] leading-relaxed', t.example)}>
            <span className={cn('mr-1 select-none', t.exampleLead)}>e.g.</span>
            {example}
          </p>
        )}
      </div>

      {/* Hairline between rows, not after the last */}
      {index < total - 1 && <div className={cn('ml-[22px] h-px', t.hairline)} />}
    </li>
  );
}

export interface QualityPanelProps {
  result: EvalResult;
  tone: QualityTone;
  /** Prefix for element ids, unique per panel on the page. */
  idPrefix: string;
  /** Names the list for screen readers: "Prompt evaluation criteria". */
  listLabel: string;
  /** One-click fixes, for criteria that carry a suggestionLabel. */
  onApply?: (criterionId: string) => void;
  /** Shown between the score and the list (the prompts' benchmark). */
  children?: ReactNode;
}

export function QualityPanel({ result, tone, idPrefix, listLabel, onApply, children }: QualityPanelProps) {
  const t = TONES[tone];
  const { score, pct, criteria } = result;
  const attentionCount = criteria.filter((c) => c.status !== 'pass').length;

  return (
    <>
      <div className="mb-4 flex items-center gap-4">
        <ScoreRing pct={pct} score={score} t={t} />
        <div className="min-w-0">
          <p className={cn('text-sm font-semibold', t.heading)}>{qualityLabel(pct)}</p>
          <p className={cn('text-xs', t.sub)}>
            {pct}%
            {' · '}
            {attentionCount === 0
              ? 'All criteria met'
              : `${attentionCount} of ${criteria.length} need attention`}
          </p>
        </div>
      </div>

      {children}

      <ul className="-mx-1" role="list" aria-label={listLabel}>
        {criteria.map((c, i) => (
          <CriterionRow
            key={c.id}
            criterion={c}
            index={i}
            total={criteria.length}
            idPrefix={idPrefix}
            t={t}
            onApply={onApply}
          />
        ))}
      </ul>

      <p className={cn('mt-3 text-[10px] leading-relaxed', t.hint)}>
        Click any item to see why it scored that way and a concrete example.
      </p>
    </>
  );
}

/** The sentence a screen reader hears when a score changes. */
export function qualityAnnouncement(noun: string, result: EvalResult): string {
  const attention = result.criteria.filter((c) => c.status !== 'pass').length;
  return `${noun}: ${formatScore(result.score)} out of 10. ${qualityLabel(result.pct)}. `
    + `${attention} of ${result.criteria.length} criteria need attention.`;
}
