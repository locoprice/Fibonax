import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { Check, FileUp, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LayoutFrame } from '@/features/snippets/LayoutFrame';
import { cleanLayout, LAYOUT_MAX_BYTES, layoutBytes, layoutSummary, layoutToPlain } from '@/lib/emailLayout';

interface EmailLayoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the body already holds text the layout will replace. */
  replaces: boolean;
  /** The cleaned layout to put in the body. */
  onUse: (html: string) => void;
}

const STEP = 'text-sm text-ink';
const STEP_NUMBER = 'mr-1.5 text-ink-subtle';
const NO_FORMATTING = 'That paste has no formatting. Copy the email itself, not just its text, or open its .html file.';
const NOTHING_IN = 'Nothing readable came in. Try copying the email again, or open its .html file.';
const TOO_BIG = `This email is too big to keep (over ${Math.round(LAYOUT_MAX_BYTES / 1000)} KB). Try one with fewer pictures or tables.`;

function summaryLine(html: string): string {
  const { tables, pictures } = layoutSummary(html);
  const parts = [];
  if (tables > 0) parts.push(`${tables} ${tables === 1 ? 'table' : 'tables'}`);
  if (pictures > 0) parts.push(`${pictures} ${pictures === 1 ? 'picture' : 'pictures'}`);
  return parts.length > 0 ? `Layout kept: ${parts.join(', ')}.` : 'Layout kept.';
}

/**
 * Brings an email layout into the snippet: paste the email, or open its .html
 * file, see it as it will look, and use it. The layout is cleaned as it comes
 * in, so nothing in it can run (lib/emailLayout.ts).
 */
export function EmailLayoutDialog({ open, onOpenChange, replaces, onUse }: EmailLayoutDialogProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Every opening starts empty: a layout pasted and left behind would land in
  // the next snippet.
  useEffect(() => {
    if (!open) return;
    setHtml(null);
    setProblem(null);
  }, [open]);

  function take(raw: string) {
    const clean = cleanLayout(raw);
    if (layoutBytes(clean) > LAYOUT_MAX_BYTES) {
      setProblem(TOO_BIG);
      return;
    }
    if (layoutToPlain(clean).trim() === '' && layoutSummary(clean).pictures === 0) {
      setProblem(NOTHING_IN);
      return;
    }
    setProblem(null);
    setHtml(clean);
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const rich = e.clipboardData.getData('text/html');
    if (!rich) {
      setProblem(NO_FORMATTING);
      return;
    }
    take(rich);
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    file.text().then(take, () => setProblem(NOTHING_IN));
  }

  function handleSubmit() {
    if (!html) return;
    onUse(html);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[600px] gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          pasteRef.current?.focus();
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Use an email layout</DialogTitle>
          <DialogDescription>The snippet looks exactly like the email, and its fields fill it in.</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-6 pb-2">
          <p className={STEP}>
            <span className={STEP_NUMBER}>1.</span>
            Copy the email (click in it, <kbd className="rounded border border-line px-1 font-mono text-[11px]">Ctrl</kbd>+<kbd className="rounded border border-line px-1 font-mono text-[11px]">A</kbd>, then <kbd className="rounded border border-line px-1 font-mono text-[11px]">Ctrl</kbd>+<kbd className="rounded border border-line px-1 font-mono text-[11px]">C</kbd>), or have its .html file ready.
          </p>

          <div>
            <p className={STEP}>
              <span className={STEP_NUMBER}>2.</span>
              Paste it here.
            </p>
            {html ? (
              <div className="mt-2 rounded-[10px] border border-line bg-bg-alt p-2">
                <LayoutFrame html={html} className="max-h-[320px]" />
                <div className="mt-2 flex items-center justify-between gap-3 px-1">
                  <p className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                    <Check className="h-3 w-3 text-success" aria-hidden />
                    {summaryLine(html)}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setHtml(null);
                      requestAnimationFrame(() => pasteRef.current?.focus());
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden />
                    Paste another
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded-[10px] border border-dashed border-line bg-bg-alt p-2">
                <textarea
                  ref={pasteRef}
                  aria-label="Paste the email here"
                  placeholder="Click here and paste"
                  rows={4}
                  onPaste={handlePaste}
                  onChange={() => undefined}
                  value=""
                  className="w-full resize-none rounded-[8px] border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <div className="mt-2 flex items-center justify-between gap-3 px-1">
                  <p className="text-[11px] text-ink-subtle">Copied text without its layout will not do.</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    className="hidden"
                    onChange={(e) => {
                      handleFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                    <FileUp className="mr-1 h-3 w-3" aria-hidden />
                    Open a file
                  </Button>
                </div>
              </div>
            )}
            {problem && (
              <p role="alert" className="mt-1.5 text-[11px] text-danger">
                {problem}
              </p>
            )}
          </div>

          <p className={STEP}>
            <span className={STEP_NUMBER}>3.</span>
            Use it. {replaces ? 'It replaces the text in this snippet.' : 'It becomes this snippet.'} Then select a value in it, like a name or an amount, and make it a field.
          </p>
        </div>

        <div className="mt-2 flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={!html}>
            Use this layout
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
