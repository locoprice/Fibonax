import { useMemo, useState } from 'react';
import { AlertCircle, Gauge, Loader2, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QualityPanel, qualityAnnouncement } from '@/components/shared/QualityPanel';
import { ProSoon, ProSoonLock, PRO_SOON_CONTROL } from '@/components/shared/ProSoon';
import { snippetReviewApi, type ReviewArea, type SnippetReview } from '@/lib/api/snippetReviewApi';
import { findSimilar, type SimilarCandidate } from '@/lib/draftSimilar';
import { isProFeatureAvailable } from '@/lib/proFeatures';
import { formatScore, qualityLabel } from '@/lib/qualityScore';
import { evaluateSnippet, isShortSnippet } from '@/lib/snippetQuality';
import { useUnfinishedRule } from '@/lib/useUnfinishedRule';
import { cn } from '@/lib/utils';

// The snippet rating in the editor: a small Quality button beside the body's
// word count, and the window it opens. The score comes from fixed rules in the
// browser (lib/snippetQuality.ts) and updates as the body changes; Improve with
// AI, for Pro accounts, adds written suggestions and never changes the score.

const AREA_WORDS: Record<ReviewArea, string> = {
  clarity: 'Clarity',
  completeness: 'Completeness',
  value: 'Value and trust',
  title: 'Title',
  care: 'Care',
};

interface SnippetQualityButtonProps {
  name: string;
  /** The body of the language being edited. */
  body: string;
  /** EN, IT, ES, FR or MULTI: the language being edited. */
  language: string;
  /** Other snippets, one per group, for the "looks like" note. */
  others: readonly SimilarCandidate[];
  disabled?: boolean;
}

export function SnippetQualityButton({ name, body, language, others, disabled = false }: SnippetQualityButtonProps) {
  const [open, setOpen] = useState(false);
  const { rule, failed } = useUnfinishedRule();
  const empty = body.trim() === '';

  const result = useMemo(
    () => (rule && !empty ? evaluateSnippet({ name, body, unfinished: rule }) : null),
    [rule, empty, name, body],
  );

  if (failed) {
    return (
      <span
        className="text-[11px] text-ink-subtle"
        title="The quality check did not load. Reload the page to try again."
      >
        Quality unavailable
      </span>
    );
  }
  if (!result) return null;

  const word = qualityLabel(result.pct);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={`${word}. See why, and how to improve it.`}
        aria-label={`Quality ${formatScore(result.score)} out of 10, ${word}. See why, and how to improve it.`}
        className="inline-flex items-center gap-1 rounded-[6px] border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink-subtle transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary disabled:pointer-events-none disabled:opacity-40"
      >
        <Gauge className="h-3 w-3" aria-hidden />
        Quality <span className="tabular-nums">{formatScore(result.score)}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Snippet quality</DialogTitle>
            <DialogDescription>
              How clear, complete and trustworthy this snippet reads. Checked on this computer as you write.
            </DialogDescription>
          </DialogHeader>

          <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {qualityAnnouncement('Snippet quality', result)}
          </span>

          <div>
            <QualityPanel
              result={result}
              tone="light"
              idPrefix="snippet-quality"
              listLabel="Snippet quality criteria"
            >
              {isShortSnippet(body) && (
                <p className="mb-3 rounded-[10px] bg-bg-alt px-3 py-2 text-xs text-ink-muted">
                  A short snippet is judged on clarity, its title and anything left unfinished, never on length.
                </p>
              )}
            </QualityPanel>
            {open && <SimilarNote name={name} body={body} others={others} />}
          </div>

          <ImproveWithAi name={name} body={body} language={language} />

          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A note when another snippet says much the same thing. Not part of the score. */
function SimilarNote({ name, body, others }: { name: string; body: string; others: readonly SimilarCandidate[] }) {
  const match = useMemo(
    () => findSimilar({ title: name, text: body }, others, 1)[0] ?? null,
    [name, body, others],
  );
  if (!match) return null;
  return (
    <p className="mt-3 rounded-[10px] border border-line px-3 py-2 text-xs text-ink-muted">
      This reads a lot like <span className="font-medium text-ink">{match.title}</span>. If they say the same
      thing, keep one and update it.
    </p>
  );
}

function ImproveWithAi({ name, body, language }: { name: string; body: string; language: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<SnippetReview | null>(null);
  const [reviewedFor, setReviewedFor] = useState('');
  const current = `${name}\u0000${body}`;

  if (!isProFeatureAvailable('review')) {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-ink-muted">Get written suggestions for this snippet.</p>
        <ProSoon className="shrink-0">
          <button
            type="button"
            aria-disabled="true"
            onClick={(event) => event.preventDefault()}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-line bg-card px-2.5 text-xs font-medium text-ink-muted',
              PRO_SOON_CONTROL,
            )}
          >
            <WandSparkles className="h-3.5 w-3.5" aria-hidden />
            Improve with AI
            <ProSoonLock />
          </button>
        </ProSoon>
      </div>
    );
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const next = await snippetReviewApi.review({ name, body, language });
      setReview(next);
      setReviewedFor(current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the AI service. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          Your text is sent to Claude, by Anthropic, for suggestions. They never change the score or your snippet.
        </p>
        <Button type="button" size="sm" onClick={run} disabled={busy || body.trim() === ''} className="shrink-0">
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Reading…
            </>
          ) : (
            <>
              <WandSparkles className="h-3.5 w-3.5" aria-hidden />
              {review ? 'Check again' : 'Improve with AI'}
            </>
          )}
        </Button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-[10px] bg-danger-bg px-3 py-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {review && (
        <div aria-live="polite" className="flex flex-col gap-2">
          {reviewedFor !== current && (
            <p className="text-[11px] text-ink-subtle">Written for an earlier version of the text.</p>
          )}
          {review.summary && <p className="text-sm text-ink">{review.summary}</p>}
          {review.suggestions.length === 0 ? (
            <p className="text-xs text-ink-muted">No suggestions: it reads well as it is.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {review.suggestions.map((s, i) => (
                <li key={i} className="rounded-[10px] border border-line px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{AREA_WORDS[s.area]}</p>
                  <p className="mt-0.5 text-xs text-ink">{s.issue}</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">{s.fix}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
