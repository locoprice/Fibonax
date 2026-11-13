import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Lightbulb, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { addBrains, addPrompts, addSnippets, type AddResult } from '@/features/library/addFromLibrary';
import { LIBRARY_BRAINS, LIBRARY_PROMPTS, LIBRARY_SNIPPETS, type LibrarySection } from '@/features/library/catalogue';
import { addedMessage } from '@/features/library/LibraryDialog';
import { joinPrompts, joinSnippets } from '@/lib/joinItems';
import { rowBodies } from '@/lib/snippetBodies';
import type {
  SuggestMissing,
  SuggestTogether,
  UsageAnalyticsApi,
  UsageInput,
} from '@/lib/usageAnalytics';
import { useMemoryStore } from '@/stores/memoryStore';
import { usePromptStore } from '@/stores/promptStore';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';

// "Not now", per browser: a suggestion key to when it was chosen. The engine
// hides each one for DISMISS_DAYS, the same rule the phone follows.
const STORAGE_DISMISSED = 'sb.analytics.suggestDismissed';

function readDismissed(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_DISMISSED);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeDismissed(next: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_DISMISSED, JSON.stringify(next));
  } catch {
    /* storage unavailable: the choice holds until the page reloads */
  }
}

const KIND_NOUN: Record<SuggestMissing['kind'], string> = { snippet: 'snippet', prompt: 'prompt', brain: 'Brain' };
const SECTION: Record<SuggestMissing['kind'], LibrarySection> = { snippet: 'snippets', prompt: 'prompts', brain: 'brains' };

function addFromLibrary(s: SuggestMissing): Promise<AddResult> | null {
  if (s.kind === 'snippet') {
    const item = LIBRARY_SNIPPETS.find((x) => x.id === s.libraryId);
    return item ? addSnippets([item]) : null;
  }
  if (s.kind === 'prompt') {
    const item = LIBRARY_PROMPTS.find((x) => x.id === s.libraryId);
    return item ? addPrompts([item]) : null;
  }
  const item = LIBRARY_BRAINS.find((x) => x.id === s.libraryId);
  return item ? addBrains([item]) : null;
}

interface SuggestionsCardProps {
  engine: UsageAnalyticsApi;
  usage: UsageInput;
  now: number;
}

/**
 * What Fibonax noticed: snippets or prompts used one after the other again
 * and again, and starter library items the library seems to lack. Decided by
 * the shared engine (suggest), which the phone runs too. Reads the snippet,
 * prompt and Brain stores for the words, and loads any not loaded yet.
 * Nothing changes until the person picks an action: Join opens the editor
 * unsaved, Add puts a library item in "From the library".
 */
export function SuggestionsCard({ engine, usage, now }: SuggestionsCardProps) {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const openNewSnippetFrom = useUiStore((s) => s.openNewSnippetFrom);
  const openNewPromptFrom = useUiStore((s) => s.openNewPromptFrom);

  const snippets = useSnippetStore((s) => s.snippets);
  const snippetsLoading = useSnippetStore((s) => s.loading);
  const snippetsError = useSnippetStore((s) => s.error);
  const loadSnippets = useSnippetStore((s) => s.load);
  const prompts = usePromptStore((s) => s.prompts);
  const promptsLoading = usePromptStore((s) => s.loading);
  const promptsError = usePromptStore((s) => s.error);
  const loadPrompts = usePromptStore((s) => s.load);
  const spaces = useMemoryStore((s) => s.spaces);
  const spacesLoaded = useMemoryStore((s) => s.loaded);
  const spacesLoading = useMemoryStore((s) => s.loadingSpaces);
  const loadSpaces = useMemoryStore((s) => s.loadSpaces);

  const [dismissed, setDismissed] = useState<Record<string, string>>(readDismissed);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  // One read each, on the first visit: a library that is already in hand is not refetched.
  useEffect(() => {
    if (asked) return;
    setAsked(true);
    if (snippets.length === 0 && !snippetsLoading) void loadSnippets();
    if (prompts.length === 0 && !promptsLoading) void loadPrompts();
    if (!spacesLoaded) void loadSpaces();
  }, [asked, snippets.length, snippetsLoading, loadSnippets, prompts.length, promptsLoading, loadPrompts, spacesLoaded, loadSpaces]);

  // A library that could not load would read as one with nothing in it, and
  // suggest pieces that are already there: say so instead.
  const failed = asked && !snippetsLoading && !promptsLoading && (snippetsError !== null || promptsError !== null);
  // Brains failing to load costs only the Brain ideas, never the rest.
  const ready = asked && !snippetsLoading && !promptsLoading && !spacesLoading && !failed;

  function retry() {
    void loadSnippets();
    void loadPrompts();
    if (!spacesLoaded) void loadSpaces();
  }

  const report = useMemo(() => {
    if (!ready) return null;
    const result = engine.suggest({
      now,
      events: usage.events,
      promptEvents: usage.promptEvents,
      // Archived items never expand, so they neither join nor count.
      snippets: snippets
        .filter((s) => s.review_status !== 'archived')
        .map((s) => {
          const bodies = Object.entries(rowBodies(s)).filter(([, text]) => (text ?? '').trim() !== '');
          return {
            id: s.id,
            title: s.name,
            text: bodies.map(([, text]) => text).join('\n\n'),
            langs: bodies.map(([lang]) => lang),
          };
        }),
      prompts: prompts
        .filter((p) => p.review_status !== 'archived')
        .map((p) => ({ id: p.id, name: p.name, text: p.content })),
      brains: spaces.map((b) => ({ name: b.name, description: b.description })),
      dismissed,
    });
    if (spacesLoaded) return result;
    // Brains that could not be read would look like no Brains at all: no Brain
    // ideas then, rather than wrong ones.
    const missing = result.missing.filter((m) => m.kind !== 'brain');
    return { ...result, missing, empty: result.together.length === 0 && missing.length === 0 };
  }, [ready, engine, now, usage, snippets, prompts, spaces, spacesLoaded, dismissed]);

  function notNow(key: string) {
    const cutoff = Date.now() - engine.DISMISS_DAYS * 86_400_000;
    const next: Record<string, string> = { [key]: new Date().toISOString() };
    for (const [k, at] of Object.entries(dismissed)) {
      if (k !== key && Date.parse(at) > cutoff) next[k] = at;
    }
    setDismissed(next);
    writeDismissed(next);
  }

  function join(s: SuggestTogether) {
    if (s.kind === 'snippet') {
      const parts = s.ids.map((id) => snippets.find((x) => x.id === id)).filter((x) => x !== undefined);
      if (parts.length !== s.ids.length) return;
      openNewSnippetFrom(joinSnippets(parts, snippets.flatMap((x) => x.triggers)));
      navigate('/');
      return;
    }
    const parts = s.ids.map((id) => prompts.find((x) => x.id === id)).filter((x) => x !== undefined);
    if (parts.length !== s.ids.length) return;
    openNewPromptFrom(joinPrompts(parts));
    navigate('/prompts');
  }

  async function add(s: SuggestMissing) {
    const run = addFromLibrary(s);
    if (!run) return;
    setBusyKey(s.key);
    const result = await run;
    setBusyKey(null);
    if (result.error) {
      showToast(`The ${KIND_NOUN[s.kind]} could not be added. ${result.error}`, 'error');
      return;
    }
    showToast(addedMessage(SECTION[s.kind], result));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggestions</CardTitle>
        <CardDescription>
          What Fibonax noticed in your last {engine.SUGGEST_DAYS} days of use and in your library. Nothing changes
          until you choose.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {failed ? (
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-ink-muted">Your library could not load, so there are no suggestions right now.</span>
            <Button size="sm" variant="ghost" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : !report ? (
          <div className="h-24 animate-pulse rounded-[12px] bg-bg-alt" aria-label="Reading your library" />
        ) : report.empty ? (
          <p className="text-sm text-ink-muted">
            Nothing to suggest yet. As you use your snippets and prompts, Fibonax spots the ones you use together.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)]">
            <section aria-labelledby="suggest-together">
              <h4 id="suggest-together" className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
                Often used together
              </h4>
              {report.together.length ? (
                <ul className="mt-3 space-y-3">
                  {report.together.map((s) => (
                    <li key={s.key} className="rounded-[12px] border border-line p-4">
                      <p className="text-xs font-medium text-ink-subtle">{s.kind === 'snippet' ? 'Snippets' : 'Prompts'}</p>
                      <ol className="mt-2 flex flex-wrap items-center gap-1.5 text-sm" aria-label="In the order you used them">
                        {s.titles.map((title, i) => (
                          <li key={s.ids[i]} className="flex items-center gap-1.5">
                            {i > 0 ? <ArrowRight className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" /> : null}
                            <span className="rounded-full bg-primary-light px-2.5 py-0.5 font-medium text-primary">{title}</span>
                          </li>
                        ))}
                      </ol>
                      <p className="mt-2 text-sm text-ink-muted">{s.text}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => join(s)}>
                          {s.kind === 'snippet' ? 'Join into one snippet' : 'Join into one prompt'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => notNow(s.key)}>
                          Not now
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">
                  No snippets or prompts used one after the other often enough yet.
                </p>
              )}
            </section>
            <section aria-labelledby="suggest-missing">
              <h4 id="suggest-missing" className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Lightbulb className="h-4 w-4 text-primary" aria-hidden="true" />
                You may need
              </h4>
              {report.missing.length ? (
                <ul className="mt-3 space-y-3">
                  {report.missing.map((s) => (
                    <li key={s.key} className="rounded-[12px] border border-line p-4">
                      <p className="text-xs font-medium text-ink-subtle">A {KIND_NOUN[s.kind]} from the starter library</p>
                      <p className="mt-1 text-sm font-semibold text-ink">{s.title}</p>
                      <p className="mt-1 text-sm text-ink-muted">{s.text}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => void add(s)} disabled={busyKey === s.key}>
                          {busyKey === s.key ? 'Adding…' : `Add ${KIND_NOUN[s.kind]}`}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => notNow(s.key)} disabled={busyKey === s.key}>
                          Not now
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">Your library covers the usual needs.</p>
              )}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
