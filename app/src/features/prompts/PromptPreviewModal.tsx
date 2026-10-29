import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useUiStore } from '@/stores/uiStore';
import { usePromptStore } from '@/stores/promptStore';
import { assembleBlocks } from '@/lib/promptUtils';
import {
  labelBrainTokens,
  promptBrainRefs,
  resolvePromptBrains,
  type ResolvedPrompt,
} from '@/lib/promptBrain';
import { applyInteractiveSteps, loadInteractiveSteps } from '@/lib/interactiveSteps';

/** Why a Brain the prompt names is not in the text, in plain words. */
function brainNote(brain: ResolvedPrompt['unavailable'][number]): string {
  const name = brain.name || 'The Brain';
  if (brain.reason === 'empty') return `The Brain “${name}” is empty, so there is nothing to add.`;
  if (brain.reason === 'failed') return `The Brain “${name}” could not be loaded. Check your connection and try again.`;
  return `The Brain “${name}” is not available here: it may be in the trash, or it belongs to the prompt's author.`;
}

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-7': 'Opus 4',
  'claude-sonnet-4-6': 'Sonnet 4',
  'claude-haiku-4-5': 'Haiku 4',
};

export function PromptPreviewModal() {
  const promptPreviewId = useUiStore((s) => s.promptPreviewId);
  const closePromptPreview = useUiStore((s) => s.closePromptPreview);
  const promptDraftContent = useUiStore((s) => s.promptDraftContent);
  const closePromptDraftPreview = useUiStore((s) => s.closePromptDraftPreview);
  const prompts = usePromptStore((s) => s.prompts);

  const [copied, setCopied] = useState(false);
  // Interactive Steps is switched in the prompt editor and kept by the browser
  // (lib/interactiveSteps). Read again on every open so the latest choice shows.
  const [stepsOn, setStepsOn] = useState(false);
  const timerRef = useRef<number | null>(null);

  const prompt = promptPreviewId
    ? (prompts.find((p) => p.id === promptPreviewId) ?? null)
    : null;

  const isDraftMode = promptPreviewId === null && promptDraftContent !== null;
  const isOpen = !!prompt || isDraftMode;

  const built: string = isDraftMode
    ? (promptDraftContent ?? '')
    : prompt
      ? (prompt.blocks && prompt.blocks.length > 0
          ? assembleBlocks(prompt.blocks, { askUserQuestions: prompt.ask_user_questions })
          : prompt.content)
      : '';

  // A Brain the prompt carries is read when the preview opens (lib/promptBrain),
  // so what is shown, and copied, holds the Brain as it is now. Until it has
  // arrived the text names the Brain in its place and Copy waits.
  const refs = useMemo(() => promptBrainRefs(built), [built]);
  const [brains, setBrains] = useState<(ResolvedPrompt & { built: string }) | null>(null);
  const [brainError, setBrainError] = useState(false);
  const [brainAttempt, setBrainAttempt] = useState(0);

  useEffect(() => {
    if (!isOpen || refs.length === 0) return;
    let live = true;
    setBrainError(false);
    resolvePromptBrains(built).then(
      (resolved) => {
        if (live) setBrains({ built, ...resolved });
      },
      () => {
        if (live) setBrainError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [isOpen, built, refs, brainAttempt]);

  const brainsReady = refs.length === 0 || brains?.built === built;
  const brainsPending = !brainsReady && !brainError;
  const unavailable = brainsReady && brains ? brains.unavailable : [];
  const assembled = brainsReady && brains ? brains.text : brainsReady ? built : labelBrainTokens(built);

  // What Copy puts on the clipboard, so the preview never differs from the paste.
  const output = applyInteractiveSteps(assembled, stepsOn);
  const canCopy = output.length > 0 && brainsReady;

  useEffect(() => {
    if (isOpen) setStepsOn(loadInteractiveSteps());
  }, [isOpen]);

  useEffect(() => {
    setCopied(false);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [prompt, promptDraftContent]);

  function handleOpenChange(open: boolean) {
    if (!open) {
      if (isDraftMode) closePromptDraftPreview();
      else closePromptPreview();
    }
  }

  async function handleCopy() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard denied — silent.
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {/* pr-10 makes room for the built-in DialogContent close button (absolute right-4 top-4) */}
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="border-b border-line px-6 pb-4 pt-6 pr-10">
          <DialogTitle className="text-base font-semibold text-ink">
            {isDraftMode ? 'Draft preview' : (prompt?.name ?? '')}
          </DialogTitle>
          {!isDraftMode && prompt && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {prompt.strategy_type && (
                <Badge variant="primary">{prompt.strategy_type}</Badge>
              )}
              {prompt.intent_category && (
                <Badge variant="neutral">{prompt.intent_category}</Badge>
              )}
              {prompt.preferred_model && (
                <Badge variant="outline">
                  {MODEL_LABELS[prompt.preferred_model] ?? prompt.preferred_model}
                </Badge>
              )}
              {prompt.thinking_mode && (
                <Badge variant="outline">{prompt.thinking_mode}</Badge>
              )}
            </div>
          )}
        </DialogHeader>

        {/* Assembled prompt text */}
        <div className="max-h-[420px] overflow-y-auto px-6 py-5">
          {output ? (
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-ink">
              {output}
            </pre>
          ) : (
            <p className="text-sm italic text-ink-subtle">
              {isDraftMode
                ? 'No content yet — enable at least one block and add text.'
                : 'This prompt has no content yet. Open the editor to add blocks.'}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-4">
          <div className="flex min-w-0 flex-col gap-1 text-xs text-ink-subtle">
            <p>
              {output.length > 0
                ? `${output.length.toLocaleString()} characters`
                : isDraftMode ? 'Empty draft' : 'Empty prompt'}
            </p>
            {brainsPending && (
              <p className="flex items-center gap-1.5" role="status">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Loading the Brain…
              </p>
            )}
            {brainError && (
              <p className="text-danger" role="alert">
                The Brain could not be loaded. Check your connection.{' '}
                <button
                  type="button"
                  onClick={() => setBrainAttempt((n) => n + 1)}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Try again
                </button>
              </p>
            )}
            {unavailable.map((brain) => (
              <p key={brain.id}>{brainNote(brain)}</p>
            ))}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!canCopy}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy to clipboard
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
