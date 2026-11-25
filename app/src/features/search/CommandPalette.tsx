import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ASK_QUESTION_MIN, type AskSource } from '@/lib/askKnowledge';
import {
  buildPaletteItems,
  loadCommandPalette,
  paletteItemPath,
  recentsStorageKey,
  type PaletteItem,
  type SbPaletteHandle,
  type SbRecentStore,
} from '@/lib/commandPalette';
import { PRO_SOON_LABEL, isProFeatureAvailable } from '@/lib/proFeatures';
import { labelNameLookup, spaceForPath } from '@/lib/searchIndex';
import { AskAnswer } from '@/features/search/AskAnswer';
import { useAuthStore } from '@/stores/authStore';
import { useLabelStore } from '@/stores/labelStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { useOrgStore } from '@/stores/orgStore';
import { usePromptStore } from '@/stores/promptStore';
import { useSearchStore } from '@/stores/searchStore';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';

// The search window ("Search or ask") on the dashboard.
//
// Clicking the search bar in the header, or Ctrl+K from anywhere, opens it. It
// replaced the panel that listed results by type: the window is the one the
// extension popup and the phone open too (extension/shared/command-palette.js),
// so this file draws nothing of its own. It hands the window the library,
// says what "open" means on the dashboard, and puts FiboChat's answer into the
// room the window keeps for it.
//
// It loads whatever has not been fetched yet. Opening it from the snippets
// page on a fresh session has to find prompts and Brain items, and those load
// only when their own page mounts. What is already in the stores shows at
// once; what arrives after is merged in with the highlight left where it was.

export function CommandPalette() {
  const open = useSearchStore((s) => s.paletteOpen);
  const closePalette = useSearchStore((s) => s.closePalette);

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const members = useOrgStore((s) => s.members);
  const loadOrg = useOrgStore((s) => s.load);

  const snippets = useSnippetStore((s) => s.snippets);
  const snippetFolders = useSnippetStore((s) => s.folders);
  const snippetsLoading = useSnippetStore((s) => s.loading);
  const loadSnippets = useSnippetStore((s) => s.load);
  const prompts = usePromptStore((s) => s.prompts);
  const promptFolders = usePromptStore((s) => s.folders);
  const promptsLoading = usePromptStore((s) => s.loading);
  const loadPrompts = usePromptStore((s) => s.load);
  const spaces = useMemoryStore((s) => s.spaces);
  const memoryLoaded = useMemoryStore((s) => s.loaded);
  const loadSpaces = useMemoryStore((s) => s.loadSpaces);
  const allItems = useMemoryStore((s) => s.allItems);
  const loadAllItems = useMemoryStore((s) => s.loadAllItems);

  const labels = useLabelStore((s) => s.labels);
  const snippetLabels = useLabelStore((s) => s.snippetLabels);
  const promptLabels = useLabelStore((s) => s.promptLabels);
  const labelsLoaded = useLabelStore((s) => s.loaded);
  const loadLabels = useLabelStore((s) => s.load);

  const editSnippetId = useUiStore((s) => s.editSnippetId);
  const editPromptId = useUiStore((s) => s.editPromptId);
  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  const openEditPrompt = useUiStore((s) => s.openEditPrompt);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // The window once its files have loaded. State, not a ref: opening has to
  // wait for it, and a ref would not ask for another render.
  const [handle, setHandle] = useState<SbPaletteHandle | null>(null);
  const [recents, setRecents] = useState<SbRecentStore | null>(null);
  // FiboChat's answer, drawn into the room the window keeps for it.
  const [answer, setAnswer] = useState<{ el: HTMLElement; question: string } | null>(null);

  const items = useMemo(() => {
    const snippetNames = labelNameLookup(labels, snippetLabels);
    const promptNames = labelNameLookup(labels, promptLabels);
    const names = new Map(members.map((member) => [member.user_id, member.display_name]));
    return buildPaletteItems({
      snippets,
      prompts,
      // One folder tree serves snippets and prompts; either store may be the
      // one that has loaded it.
      folders: [...snippetFolders, ...promptFolders],
      spaces,
      items: allItems,
      snippetLabels: snippetNames,
      promptLabels: promptNames,
      personName: (id) => (id === userId ? 'You' : (names.get(id) ?? 'Teammate')),
    });
  }, [
    snippets,
    prompts,
    snippetFolders,
    promptFolders,
    spaces,
    allItems,
    labels,
    snippetLabels,
    promptLabels,
    members,
    userId,
  ]);

  // The window asks for these whenever it draws, long after the render that
  // created it, so it reads them through refs.
  const itemsRef = useRef<PaletteItem[]>(items);
  const loadingRef = useRef(false);
  const openItemRef = useRef<(item: PaletteItem, secondary: boolean) => void>(() => undefined);

  const openItem = useCallback(
    (item: PaletteItem, secondary: boolean) => {
      if (secondary) {
        window.open(paletteItemPath(item), '_blank', 'noopener');
        return;
      }
      if (item.kind === 'snippet') {
        navigate('/');
        openEditSnippet(item.id);
      } else if (item.kind === 'prompt') {
        navigate('/prompts');
        openEditPrompt(item.id);
      } else {
        navigate(paletteItemPath(item));
      }
    },
    [navigate, openEditSnippet, openEditPrompt],
  );

  useEffect(() => {
    itemsRef.current = items;
    loadingRef.current = snippetsLoading || promptsLoading || !memoryLoaded;
    openItemRef.current = openItem;
    handle?.refresh();
  }, [items, snippetsLoading, promptsLoading, memoryLoaded, openItem, handle]);

  // One window per account: the recently opened list belongs to who is signed in.
  useEffect(() => {
    let cancelled = false;
    const made: { handle: SbPaletteHandle | null } = { handle: null };
    void loadCommandPalette()
      .then(({ palette, recents: recentsApi }) => {
        if (cancelled) return;
        const store = recentsApi.open(recentsApi.localStore(recentsStorageKey(userId)));
        made.handle = palette.create({
          name: 'sb-search',
          items: () => itemsRef.current,
          loading: () => loadingRef.current,
          recents: store,
          secondaryLabel: 'Open in new tab',
          onOpen: (item, secondary) => openItemRef.current(item, secondary),
          onToggle: (isOpen) => {
            if (!isOpen) closePalette();
          },
          trigger: () => document.querySelector<HTMLElement>('[data-search-bar]'),
          ask: {
            // Read each time it is drawn: an account can become Pro mid-session.
            get locked() {
              return isProFeatureAvailable('ask') ? '' : PRO_SOON_LABEL;
            },
            minLength: ASK_QUESTION_MIN,
            show: (el, question) => setAnswer({ el, question }),
            hide: () => setAnswer(null),
          },
        });
        setRecents(store);
        setHandle(made.handle);
      })
      .catch((err: unknown) => {
        console.error('[Fibonax] The search window could not load:', err);
      });
    return () => {
      cancelled = true;
      made.handle?.destroy();
      setHandle(null);
      setRecents(null);
      setAnswer(null);
    };
  }, [userId, closePalette]);

  // The store says whether it is open (the search bar and Ctrl+K write there).
  useEffect(() => {
    if (!handle) return;
    if (open) handle.open();
    else handle.close();
  }, [open, handle]);

  // Everything the window reads, fetched the first time it is opened. Each
  // store guards its own refetch, so this is safe to call on every open.
  useEffect(() => {
    if (!open) return;
    if (snippets.length === 0) void loadSnippets();
    if (prompts.length === 0) void loadPrompts();
    if (!memoryLoaded) void loadSpaces();
    if (!labelsLoaded) void loadLabels();
    void loadAllItems();
    void loadOrg();
  }, [
    open,
    snippets.length,
    prompts.length,
    memoryLoaded,
    labelsLoaded,
    loadSnippets,
    loadPrompts,
    loadSpaces,
    loadLabels,
    loadAllItems,
    loadOrg,
  ]);

  // "Recently opened" means opened anywhere on the dashboard, not only from
  // the window: an editor that opens, a Brain that is visited.
  useEffect(() => {
    if (!recents || !editSnippetId) return;
    const row = itemsRef.current.find((item) => item.kind === 'snippet' && item.ids.includes(editSnippetId));
    if (row) recents.record(row.key);
  }, [recents, editSnippetId]);

  useEffect(() => {
    if (recents && editPromptId) recents.record(`prompt:${editPromptId}`);
  }, [recents, editPromptId]);

  const visitedSpace = spaceForPath(pathname);
  useEffect(() => {
    if (recents && visitedSpace) recents.record(`brain:${visitedSpace}`);
  }, [recents, visitedSpace]);

  function openSource(source: AskSource) {
    closePalette();
    if (source.kind === 'snippet') {
      navigate('/');
      openEditSnippet(source.id);
    } else {
      navigate(source.space_id ? `/memory/${source.space_id}` : '/memory');
    }
  }

  if (!answer) return null;
  return createPortal(
    <AskAnswer
      question={answer.question}
      onBack={() => handle?.leaveAsk()}
      onOpenSource={openSource}
    />,
    answer.el,
  );
}
