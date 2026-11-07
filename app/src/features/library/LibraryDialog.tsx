import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fillForm, loadFillFormEngine } from '@/lib/fillFormEngine';
import { humanizeName } from '@/lib/formulaSteps';
import { DEFAULT_TRIGGER_CONFIG } from '@/lib/triggerUtils';
import { cn } from '@/lib/utils';
import { useMemoryStore } from '@/stores/memoryStore';
import { usePromptStore } from '@/stores/promptStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import { addBrains, addPrompts, addSnippets, promptForm, type AddResult } from './addFromLibrary';
import {
  LIBRARY_BRAINS,
  LIBRARY_FOLDER_NAME,
  LIBRARY_PROMPTS,
  LIBRARY_SNIPPETS,
  PROMPT_TOPICS,
  SNIPPET_TOPICS,
  type LibraryBrain,
  type LibraryPrompt,
  type LibrarySection,
  type LibrarySnippet,
  type LibraryTopic,
} from './catalogue';

// The starter library: one window, the same on Snippets, Prompts and Brains.
// Only what each section holds differs (Tripartite Parity, root CLAUDE.md):
// snippets and prompts come in topics and land in the "From the library"
// folder; Brains are whole outlines that become new Brains.

const NOUN: Record<LibrarySection, { one: string; many: string }> = {
  snippets: { one: 'snippet', many: 'snippets' },
  prompts: { one: 'prompt', many: 'prompts' },
  brains: { one: 'Brain', many: 'Brains' },
};

function count(n: number, section: LibrarySection): string {
  return `${n} ${n === 1 ? NOUN[section].one : NOUN[section].many}`;
}

/** The line a finished add leaves in the toast. */
export function addedMessage(section: LibrarySection, result: AddResult): string {
  const where = section === 'brains' ? '' : ` to ${LIBRARY_FOLDER_NAME}`;
  const there = result.skipped === 1 ? '1 was already there.' : `${result.skipped} were already there.`;
  if (result.added === 0) return `Already in your ${NOUN[section].many}. Nothing new to add.`;
  return `${count(result.added, section)} added${where}.${result.skipped > 0 ? ` ${there}` : ''}`;
}

type Entry =
  | { kind: 'snippets'; id: string; topic: string; name: string; token: string; item: LibrarySnippet }
  | { kind: 'prompts'; id: string; topic: string; name: string; token: string; item: LibraryPrompt }
  | { kind: 'brains'; id: string; topic: string; name: string; token: string; item: LibraryBrain };

function useEntries(section: LibrarySection): { entries: Entry[]; topics: LibraryTopic[] } {
  const snippetTrigger =
    useSettingsStore((s) => s.profile?.trigger_snippet_seq) || DEFAULT_TRIGGER_CONFIG.snippetTrigger;
  const promptTrigger =
    useSettingsStore((s) => s.profile?.trigger_prompt_seq) || DEFAULT_TRIGGER_CONFIG.promptTrigger;
  return useMemo(() => {
    if (section === 'snippets') {
      return {
        topics: SNIPPET_TOPICS,
        entries: LIBRARY_SNIPPETS.map((item) => ({
          kind: 'snippets' as const, id: item.id, topic: item.topic, name: item.name,
          token: `${snippetTrigger}${item.trigger}`, item,
        })),
      };
    }
    if (section === 'prompts') {
      return {
        topics: PROMPT_TOPICS,
        entries: LIBRARY_PROMPTS.map((item) => ({
          kind: 'prompts' as const, id: item.id, topic: item.topic, name: item.name,
          token: `${promptTrigger}${item.shortcut}`, item,
        })),
      };
    }
    return {
      topics: [],
      entries: LIBRARY_BRAINS.map((item) => ({
        kind: 'brains' as const, id: item.id, topic: '', name: item.name,
        token: `${item.items.length} items`, item,
      })),
    };
  }, [section, snippetTrigger, promptTrigger]);
}

/** "Browse library" beside each page's New button. */
export function LibraryButton({ section }: { section: LibrarySection }) {
  const openLibrary = useUiStore((s) => s.openLibrary);
  return (
    <Button variant="ghost" size="md" onClick={() => openLibrary(section)}>
      <BookOpen className="h-4 w-4" />
      Browse library
    </Button>
  );
}

interface LibraryEmptyActionsProps {
  section: LibrarySection;
  newLabel: string;
  onNew: () => void;
}

/** The two ways to start an empty page: make your own, or take a ready one. */
export function LibraryEmptyActions({ section, newLabel, onNew }: LibraryEmptyActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button onClick={onNew}>
        <Plus className="h-4 w-4" />
        {newLabel}
      </Button>
      <LibraryButton section={section} />
    </div>
  );
}

const PANE_LABEL = 'mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle';
const PANE_TEXT = 'whitespace-pre-wrap rounded-[12px] border border-line bg-bg px-4 py-3 text-sm leading-relaxed text-ink';

function SnippetPane({ item }: { item: LibrarySnippet }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadFillFormEngine()
      .then(() => live && setReady(true))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  const view = ready ? fillForm(item.body, item.example, { lang: 'EN' }) : null;
  if (failed) {
    return <p className="text-sm text-danger">The preview could not load. Reload the page to try again.</p>;
  }
  return (
    <>
      {view && view.fields.length > 0 && (
        <div>
          <p className={PANE_LABEL}>Asks for</p>
          <ul className="flex flex-wrap gap-1.5">
            {view.fields.map((f) => (
              <li key={f.key} className="rounded-full bg-bg-alt px-2.5 py-0.5 text-xs text-ink-muted">
                {f.label || humanizeName(f.key)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className={PANE_LABEL}>How it reads, filled in with an example</p>
        <div className={PANE_TEXT}>{view ? view.preview : 'Loading the preview…'}</div>
      </div>
    </>
  );
}

function PromptPane({ item }: { item: LibraryPrompt }) {
  return (
    <div>
      <p className={PANE_LABEL}>What it tells the AI</p>
      <div className={cn(PANE_TEXT, 'font-mono text-xs')}>{promptForm(item, null).content}</div>
    </div>
  );
}

function BrainPane({ item }: { item: LibraryBrain }) {
  return (
    <>
      <p className="text-sm text-ink-muted">{item.description}</p>
      <div>
        <p className={PANE_LABEL}>Items to fill in</p>
        <ul className="flex flex-col gap-2">
          {item.items.map((it) => (
            <li key={it.name} className="rounded-[12px] border border-line bg-bg px-4 py-2.5">
              <p className="text-sm font-medium text-ink">{it.name}</p>
              <p className="text-xs text-ink-muted">{it.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * Whether the section's own list is in. Adding before it is would skip the
 * duplicate check and could hand out a trigger that is already taken.
 */
function useSectionReady(section: LibrarySection): boolean {
  const snippetsLoading = useSnippetStore((s) => s.loading);
  const promptsLoading = usePromptStore((s) => s.loading);
  const brainsLoaded = useMemoryStore((s) => s.loaded);
  if (section === 'snippets') return !snippetsLoading;
  if (section === 'prompts') return !promptsLoading;
  return brainsLoaded;
}

function runAdd(section: LibrarySection, chosen: Entry[]): Promise<AddResult> {
  if (section === 'snippets') {
    return addSnippets(chosen.flatMap((e) => (e.kind === 'snippets' ? [e.item] : [])));
  }
  if (section === 'prompts') {
    return addPrompts(chosen.flatMap((e) => (e.kind === 'prompts' ? [e.item] : [])));
  }
  return addBrains(chosen.flatMap((e) => (e.kind === 'brains' ? [e.item] : [])));
}

/**
 * The library window for one section. Opened by `openLibrary(section)`, or by
 * `?library` in the page's address, which the extension's empty states link to.
 */
export function LibraryDialog({ section }: { section: LibrarySection }) {
  const open = useUiStore((s) => s.libraryOpen === section);
  const openLibrary = useUiStore((s) => s.openLibrary);
  const closeLibrary = useUiStore((s) => s.closeLibrary);
  const showToast = useUiStore((s) => s.showToast);
  const [params, setParams] = useSearchParams();
  const { entries, topics } = useEntries(section);
  const ready = useSectionReady(section);

  const [topic, setTopic] = useState('all');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.has('library')) return;
    openLibrary(section);
    const next = new URLSearchParams(params);
    next.delete('library');
    setParams(next, { replace: true });
  }, [params, setParams, openLibrary, section]);

  // Every opening starts clean: nothing ticked, the first item in view.
  useEffect(() => {
    if (!open) return;
    setTopic('all');
    setPicked(new Set());
    setFocusedId(null);
    setError(null);
  }, [open]);

  const visible = topic === 'all' ? entries : entries.filter((e) => e.topic === topic);
  const focused = visible.find((e) => e.id === focusedId) ?? visible[0] ?? null;
  const allVisiblePicked = visible.length > 0 && visible.every((e) => picked.has(e.id));
  const noun = NOUN[section];

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const e of visible) {
        if (allVisiblePicked) next.delete(e.id);
        else next.add(e.id);
      }
      return next;
    });
  }

  async function handleAdd() {
    setBusy(true);
    setError(null);
    const result = await runAdd(section, entries.filter((e) => picked.has(e.id)));
    setBusy(false);
    if (result.error) {
      const sofar = result.added > 0 ? `${count(result.added, section)} added, then it stopped. ` : '';
      setError(`${sofar}${result.error}`);
      return;
    }
    closeLibrary();
    showToast(addedMessage(section, result));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && closeLibrary()}>
      <DialogContent className="max-w-[1000px] gap-0 p-0">
        <DialogHeader className="border-b border-line px-6 pb-4 pt-6">
          <DialogTitle>Starter library</DialogTitle>
          <DialogDescription>
            Ready-made {noun.many}. Tick the ones you want and add them in one click. They become
            yours, to change like any other.
          </DialogDescription>
          {topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2" role="group" aria-label="Topics">
              {[{ id: 'all', label: 'All' }, ...topics].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={topic === t.id}
                  onClick={() => setTopic(t.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    topic === t.id
                      ? 'border-primary/30 bg-primary-light text-primary'
                      : 'border-line bg-card text-ink-muted hover:text-ink',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="grid h-[min(60vh,560px)] grid-cols-[1fr_1.618fr]">
          <div className="flex min-h-0 flex-col border-r border-line">
            <label className="flex cursor-pointer items-center gap-2.5 border-b border-line px-6 py-2.5 text-xs font-medium text-ink-muted">
              <input
                type="checkbox"
                checked={allVisiblePicked}
                onChange={toggleAllVisible}
                className="h-4 w-4 cursor-pointer accent-primary"
              />
              Select all
            </label>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {visible.map((e) => (
                <li
                  key={e.id}
                  onMouseEnter={() => setFocusedId(e.id)}
                  onFocus={() => setFocusedId(e.id)}
                  className={cn(focused?.id === e.id && 'bg-bg-alt')}
                >
                  <label className="flex cursor-pointer items-center gap-2.5 px-6 py-2">
                    <input
                      type="checkbox"
                      checked={picked.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.name}</span>
                    <code className="shrink-0 rounded-md bg-bg-alt px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                      {e.token}
                    </code>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
            {focused && <h3 className="text-base font-semibold text-ink">{focused.name}</h3>}
            {focused?.kind === 'snippets' && <SnippetPane key={focused.id} item={focused.item} />}
            {focused?.kind === 'prompts' && <PromptPane item={focused.item} />}
            {focused?.kind === 'brains' && <BrainPane item={focused.item} />}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-4">
          <p className={cn('text-sm', error ? 'text-danger' : 'text-ink-muted')} role={error ? 'alert' : undefined}>
            {error ?? (picked.size === 0 ? `Tick the ${noun.many} you want.` : `${picked.size} selected`)}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={closeLibrary} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void handleAdd()} disabled={busy || !ready || picked.size === 0}>
              {busy ? 'Adding…' : picked.size === 0 ? `Add ${noun.many}` : `Add ${count(picked.size, section)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
