import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, ChevronDown, Clock, Pin } from 'lucide-react';
import { BrainIcon } from '@/components/shared/BrainIcon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { estimateTokens } from '@/lib/memory/engine';
import { sanitizeName } from '@/lib/nameText';
import type { MemoryItem, MemoryItemKind } from '@/types/database';
import type { SaveMemoryItemInput } from '@/lib/api/memoryApi';
import { ReviewStatusMenu } from '@/components/shared/ReviewStatusMenu';
import {
  DraftFromTextButton,
  DraftNotice,
  type DraftNoticeState,
} from '@/components/shared/DraftWithAi';
import { memoryDraftFields, type DraftResult } from '@/lib/aiDraft';
import { findSimilar, memoryCandidates } from '@/lib/draftSimilar';
import { useDraftStore } from '@/stores/draftStore';
import { useReviewApprover } from '@/lib/useReviewApprover';
import { useMemoryStore } from '@/stores/memoryStore';
import {
  BODY_MAX,
  KIND_LABELS,
  NAME_MAX,
  SUMMARY_MAX,
  bodyUsage,
  kindOptions,
} from '@/features/memory/itemForm';

// Create or edit one memory item.
//
// The token count is computed with estimateTokens from the engine rather than a
// local formula. It is the same arithmetic the database generates and the same
// number a budget is measured against, so a number shown here has to come from
// that function or it is a fourth implementation of a rule that already exists
// three times.
//
// The header and the footer stay put while the form scrolls, so the title, the
// review status and the Save button are in view on any screen height.

const BAR_TONE = { ok: 'bg-primary', warn: 'bg-warning', over: 'bg-danger' } as const;

interface ItemEditorProps {
  /** 'new' creates in `spaceId`; an item edits it; null is closed. */
  target: 'new' | MemoryItem | null;
  spaceId: string;
  onClose: () => void;
  onSave: (input: SaveMemoryItemInput) => Promise<unknown>;
  /** Opens this item's saved versions. Absent where history is not offered. */
  onOpenHistory?: (item: MemoryItem) => void;
  /** Opens another item's editor in place of this one (Draft with AI's similar items). */
  onOpenItem: (id: string) => void;
}

export function ItemEditor({ target, spaceId, onClose, onSave, onOpenHistory, onOpenItem }: ItemEditorProps) {
  const editing = target !== null && target !== 'new' ? target : null;
  // The item as the store has it now: the status menu below changes the row
  // while the editor is open, and the page handed in a copy from before.
  const live = useMemoryStore((s) =>
    editing ? (s.items.find((item) => item.id === editing.id) ?? editing) : null,
  );
  const setReviewStatus = useMemoryStore((s) => s.setReviewStatus);
  const isApprover = useReviewApprover();

  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<MemoryItemKind>('fact');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Draft with AI: what the notice says, and whether a new item came from a
  // draft, in which case it is saved as AI generated rather than approved.
  const [draftNotice, setDraftNotice] = useState<DraftNoticeState | null>(null);
  const [aiDrafted, setAiDrafted] = useState(false);

  useEffect(() => {
    if (target === null) return;
    setName(editing?.name ?? '');
    setSummary(editing?.summary ?? '');
    setBody(editing?.body ?? '');
    setKind(editing?.kind ?? 'fact');
    setPinned(editing?.pinned ?? false);
    setError(null);
    setSaving(false);
    setDraftNotice(null);
    setAiDrafted(false);
    // An AI update drafted from a new item's "Update it instead": shown over
    // the saved text, unsaved.
    const handed = editing ? useDraftStore.getState().take('memory', editing.id) : null;
    if (handed?.kind === 'memory') {
      setName(handed.draft.name);
      setSummary(handed.draft.summary);
      setBody(handed.draft.body);
      setKind(handed.draft.kind);
      setDraftNotice({ mode: 'update', changes: handed.changes, text: '', similar: [] });
    }
  }, [target, editing]);

  // A new draft replaces what the form holds: the person asked for it, and
  // nothing has been saved yet. Every item is needed twice here: names are
  // unique per person, and the similar check reads the whole library.
  async function applyDraft(result: DraftResult, text: string) {
    if (result.kind !== 'memory') return;
    const store = useMemoryStore.getState();
    await store.loadAllItems();
    const all = useMemoryStore.getState().allItems;
    const fields = memoryDraftFields(result.draft, all.map((item) => item.name));
    setName(fields.name);
    setSummary(fields.summary);
    setBody(fields.body);
    setKind(fields.kind);
    setError(null);
    setAiDrafted(true);
    setDraftNotice({
      mode: 'new',
      changes: '',
      text,
      similar: findSimilar(
        { title: result.draft.name, text: `${result.draft.summary} ${result.draft.body}` },
        memoryCandidates(all),
      ),
    });
  }

  const tokens = useMemo(() => estimateTokens(body), [body]);
  const usage = useMemo(() => bodyUsage(body.length), [body]);
  const trimmedName = name.trim();
  const overLength = usage.tone === 'over';
  const canSave = trimmedName.length > 0 && body.length > 0 && !overLength && !saving;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: editing?.id ?? null,
        space_id: spaceId,
        name: trimmedName,
        summary,
        body,
        kind,
        pinned,
        priority: editing?.priority ?? 0,
        ...(aiDrafted && !editing ? { reviewStatus: 'ai_generated' as const } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this item.');
      setSaving(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-line px-6 pb-4 pt-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3 pr-8">
            <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-primary-light text-primary"
              >
                <BrainIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <DialogTitle>{editing ? 'Edit item' : 'Add text'}</DialogTitle>
                <DialogDescription>One item, one fact.</DialogDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!editing ? (
                <DraftFromTextButton
                  kind="memory"
                  noun="Brain item"
                  disabled={saving}
                  onDrafted={applyDraft}
                />
              ) : null}
              {live ? (
                <ReviewStatusMenu
                  noun="item"
                  status={live.review_status}
                  reviewedBy={live.reviewed_by}
                  reviewedAt={live.reviewed_at}
                  approver={isApprover(null, live.user_id)}
                  onChange={(next) => setReviewStatus(live.id, next)}
                />
              ) : null}
              {/* Only an existing item has anything behind it to look at. */}
              {editing && onOpenHistory ? (
                <button
                  type="button"
                  onClick={() => onOpenHistory(editing)}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-card px-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-bg-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  History
                </button>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
            {draftNotice ? (
              <DraftNotice
                notice={draftNotice}
                kind="memory"
                onOpen={onOpenItem}
                onDismiss={() => setDraftNotice(null)}
              />
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="item-name" className="text-xs font-medium text-ink-muted">
                  Name
                </label>
                <Input
                  id="item-name"
                  value={name}
                  maxLength={NAME_MAX}
                  autoFocus
                  placeholder="house-style"
                  onChange={(event) => setName(sanitizeName(event.target.value))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="item-kind" className="text-xs font-medium text-ink-muted">
                  Kind
                </label>
                <div className="relative">
                  <select
                    id="item-kind"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as MemoryItemKind)}
                    className="h-10 w-full appearance-none rounded-[12px] border border-line bg-card pl-3 pr-9 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {kindOptions(kind).map((value) => (
                      <option key={value} value={value}>
                        {KIND_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                    aria-hidden
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="item-summary" className="text-xs font-medium text-ink-muted">
                  Summary
                </label>
                {summary.length > 0 ? (
                  <span className="text-[11px] tabular-nums text-ink-subtle">
                    {summary.length}/{SUMMARY_MAX}
                  </span>
                ) : null}
              </div>
              <Input
                id="item-summary"
                value={summary}
                maxLength={SUMMARY_MAX}
                placeholder="How output should be written"
                aria-describedby="item-summary-hint"
                onChange={(event) => setSummary(event.target.value)}
              />
              <p id="item-summary-hint" className="text-xs leading-relaxed text-ink-subtle">
                One line. Assistants read it first to decide what is worth opening, so it matters
                more than the body.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="item-body" className="text-xs font-medium text-ink-muted">
                  Body
                </label>
                <span className="text-[11px] tabular-nums text-ink-subtle">
                  {tokens.toLocaleString()} tokens
                </span>
              </div>
              <textarea
                id="item-body"
                value={body}
                rows={9}
                placeholder="Short sentences. No filler."
                aria-invalid={overLength || undefined}
                onChange={(event) => setBody(event.target.value)}
                className={cn(
                  'w-full resize-y rounded-[12px] border bg-card px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2',
                  overLength
                    ? 'border-danger focus:border-danger focus:ring-danger/20'
                    : 'border-line focus:border-primary focus:ring-primary/20',
                )}
              />
              <div className="flex items-center gap-3">
                <div
                  role="progressbar"
                  aria-label="Characters used"
                  aria-valuemin={0}
                  aria-valuemax={BODY_MAX}
                  aria-valuenow={Math.min(body.length, BODY_MAX)}
                  className="h-1 flex-1 overflow-hidden rounded-full bg-bg-alt"
                >
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-200',
                      BAR_TONE[usage.tone],
                    )}
                    style={{ width: `${usage.percent}%` }}
                  />
                </div>
                <span
                  className={cn(
                    'shrink-0 text-[11px] tabular-nums',
                    overLength ? 'font-medium text-danger' : 'text-ink-subtle',
                  )}
                >
                  {body.length.toLocaleString()} / {BODY_MAX.toLocaleString()}
                </span>
              </div>
              {overLength ? (
                <p role="alert" className="text-xs leading-relaxed text-danger">
                  Over the limit by {usage.over.toLocaleString()} characters. Something this long
                  is a document: split it into separate items so a budget can still hold one.
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-[12px] border border-line bg-bg-alt/50 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-colors',
                    pinned
                      ? 'border-primary/30 bg-primary-light text-primary'
                      : 'border-line bg-card text-ink-subtle',
                  )}
                >
                  <Pin className={cn('h-4 w-4', pinned && 'fill-current')} />
                </span>
                <div className="min-w-0">
                  <label
                    htmlFor="item-pinned"
                    className="block cursor-pointer text-sm font-medium text-ink"
                  >
                    Always attached
                  </label>
                  <p id="item-pinned-hint" className="text-xs text-ink-muted">
                    {pinned
                      ? 'Added to every context, even when no step asks for it.'
                      : 'Added only when a step asks for it.'}
                  </p>
                </div>
              </div>
              <Switch
                id="item-pinned"
                checked={pinned}
                onChange={setPinned}
                aria-describedby="item-pinned-hint"
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-3 rounded-b-[16px] border-t border-line bg-bg-alt/40 px-6 py-4">
            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-[10px] bg-danger-bg px-3 py-2 text-sm text-danger"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
