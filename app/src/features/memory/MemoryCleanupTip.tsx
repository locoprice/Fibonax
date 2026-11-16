import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MEMORY_CLEANUP_PROMPT } from '@/features/memory/memoryCleanup';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

/**
 * One quiet line under the Brains grid. Opened, it says why an AI's memory
 * should stay small and hands out the prompt that cleans it.
 */
export function MemoryCleanupTip() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const showToast = useUiStore((s) => s.showToast);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(MEMORY_CLEANUP_PROMPT);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('Could not copy. Select the text and copy it yourself.', 'error');
    }
  }

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="memory-cleanup-tip"
        className="flex w-full items-center gap-3 rounded-[16px] px-5 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary-light text-primary">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold text-ink">Keep your AI&apos;s memory small</span>
          <span className="text-xs text-ink-muted">Clean it once in a while. Copy a prompt that does it for you.</span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-ink-subtle transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div id="memory-cleanup-tip" className="flex flex-col gap-3 border-t border-line px-5 pb-5 pt-4">
          <p className="text-sm text-ink-muted">
            The top layer of an AI&apos;s memory has to stay small. When it grows too big, the AI has too much to
            remember and starts to lose track. Once in a while, open the AI you use, paste this prompt and answer
            its questions.
          </p>
          <pre className="whitespace-pre-wrap rounded-[10px] border border-line bg-bg-alt p-4 font-sans text-xs leading-relaxed text-ink">
            {MEMORY_CLEANUP_PROMPT}
          </pre>
          <div>
            <Button size="sm" onClick={() => void copyPrompt()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy prompt'}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
