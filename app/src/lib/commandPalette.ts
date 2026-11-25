/**
 * The search window ("Search or ask"), loaded into the dashboard.
 *
 * The window itself is `extension/shared/command-palette.js`, one vanilla
 * component for the popup, the dashboard and the phone, with
 * `extension/shared/recents.js` for what was opened lately and
 * `extension/shared/asset-search.js` for what matches. The dashboard loads the
 * three files at runtime rather than carrying a React copy: the same keys, the
 * same chips and the same results on every surface come from there being one
 * of them.
 *
 * Loaded the way `memoryChunk.ts` loads the chunker, from `/extension/*`,
 * which `extensionScriptsPlugin` serves in dev and copies into dist at build
 * (lib/loadScript.ts). This file adds what only the dashboard knows: how its
 * library becomes the window's items, and the address each item opens at.
 */
import { loadScript } from '@/lib/loadScript';
import { groupSnippetsByLanguage } from '@/lib/snippetGrouping';
import type { Folder, MemoryItem, MemorySpace, Prompt, SnippetRow } from '@/types/database';

export type PaletteKind = 'snippet' | 'prompt' | 'brain' | 'item';

/** One row of the window. The fields the shared file reads are listed at its top. */
export interface PaletteItem {
  key: string;
  kind: PaletteKind;
  title: string;
  shortcut: string;
  place: string;
  placeKey: string;
  byName: string;
  edited: number;
  labels: string[];
  keywords: string[];
  text: string[];
  /** The row to open. A snippet in several languages opens on its main one. */
  id: string;
  /** Every row behind this one: the language variants of a snippet. */
  ids: string[];
  /** A Brain item only: the Brain it sits in. */
  spaceId: string | null;
}

export interface RecentRow {
  k: string;
  t: number;
}

export interface SbRecentStore {
  ready(cb: () => void): void;
  list(): RecentRow[];
  record(key: string, now?: number): void;
  forget(keys: string[]): void;
  clear(): void;
}

interface SbRecentBackend {
  get(cb: (stored: unknown) => void): void;
  set(list: RecentRow[]): void;
}

export interface SbRecentsApi {
  localStore(name: string): SbRecentBackend;
  open(store: SbRecentBackend): SbRecentStore;
}

export interface SbPaletteAsk {
  /** A sentence when this account cannot ask yet, '' when it can. */
  readonly locked: string;
  minLength: number;
  show(el: HTMLElement, question: string): void;
  hide(el: HTMLElement): void;
}

export interface SbPaletteConfig {
  name: string;
  items(): PaletteItem[];
  loading(): boolean;
  recents: SbRecentStore;
  secondaryLabel: string;
  onOpen(item: PaletteItem, secondary: boolean): void;
  onToggle(open: boolean): void;
  trigger(): HTMLElement | null;
  ask: SbPaletteAsk;
}

export interface SbPaletteHandle {
  open(text?: string): void;
  close(): void;
  toggle(text?: string): void;
  isOpen(): boolean;
  refresh(): void;
  leaveAsk(): void;
  destroy(): void;
}

export interface SbCommandPaletteApi {
  create(cfg: SbPaletteConfig): SbPaletteHandle;
}

declare global {
  interface Window {
    SBCommandPalette?: SbCommandPaletteApi;
    SBRecents?: SbRecentsApi;
  }
}

// In the order they need each other: the rule, the recents, then the window.
const SCRIPTS = [
  '/extension/shared/asset-search.js',
  '/extension/shared/recents.js',
  '/extension/shared/command-palette.js',
];
const STYLES = '/extension/shared/command-palette.css';

function loadStyles(): void {
  if (document.querySelector(`link[data-sb-style="${STYLES}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLES;
  link.dataset.sbStyle = STYLES;
  document.head.appendChild(link);
}

/** The window and the recents helper, loading them on first use. */
export async function loadCommandPalette(): Promise<{ palette: SbCommandPaletteApi; recents: SbRecentsApi }> {
  loadStyles();
  for (const src of SCRIPTS) await loadScript(src);
  const palette = window.SBCommandPalette;
  const recents = window.SBRecents;
  if (!palette || !recents) throw new Error('The search window did not load');
  return { palette, recents };
}

/** Where the list of recently opened items is kept on this device, per account. */
export function recentsStorageKey(userId: string | null): string {
  return `sb_recents_${userId ?? 'guest'}`;
}

export interface PaletteLibrary {
  snippets: readonly SnippetRow[];
  prompts: readonly Prompt[];
  folders: readonly Folder[];
  spaces: readonly MemorySpace[];
  /** Items across every Brain. */
  items: readonly MemoryItem[];
  /** Label names assigned to a snippet id. */
  snippetLabels: (id: string) => string[];
  /** Label names assigned to a prompt id. */
  promptLabels: (id: string) => string[];
  /** "You", a teammate's name, or '' when the id is not known here. */
  personName: (userId: string) => string;
}

function when(iso: string | null | undefined): number {
  if (!iso) return 0;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value !== '')));
}

/**
 * The dashboard's library as the rows the window lists.
 *
 * A snippet written in several languages is one row, as it is one row in the
 * snippets table: found by the text of any of its languages, opened on its
 * main one.
 */
export function buildPaletteItems(library: PaletteLibrary): PaletteItem[] {
  const folderNames = new Map(library.folders.map((folder) => [folder.id, folder.name]));
  const out: PaletteItem[] = [];

  for (const group of groupSnippetsByLanguage([...library.snippets])) {
    const master = group.master;
    const text: string[] = [];
    for (const variant of group.variants) {
      text.push(variant.content);
      for (const body of Object.values(variant.bodies)) if (typeof body === 'string') text.push(body);
    }
    out.push({
      key: `snippet:${master.id}`,
      kind: 'snippet',
      title: master.name,
      shortcut: master.triggers[0] ?? '',
      place: master.folder_id ? (folderNames.get(master.folder_id) ?? master.folder_name ?? '') : '',
      placeKey: master.folder_id ? `folder:${master.folder_id}` : '',
      byName: library.personName(master.user_id),
      edited: Math.max(...group.variants.map((variant) => when(variant.updated_at))),
      labels: unique(group.variants.flatMap((variant) => library.snippetLabels(variant.id))),
      keywords: unique(group.variants.flatMap((variant) => variant.alternative_queries)),
      text: unique(text),
      id: master.id,
      ids: group.variants.map((variant) => variant.id),
      spaceId: null,
    });
  }

  for (const prompt of library.prompts) {
    out.push({
      key: `prompt:${prompt.id}`,
      kind: 'prompt',
      title: prompt.name,
      shortcut: prompt.shortcut ?? '',
      place: prompt.folder_id ? (folderNames.get(prompt.folder_id) ?? '') : '',
      placeKey: prompt.folder_id ? `folder:${prompt.folder_id}` : '',
      byName: library.personName(prompt.user_id),
      edited: when(prompt.updated_at),
      labels: library.promptLabels(prompt.id),
      keywords: prompt.intent_category ? [prompt.intent_category] : [],
      text: [prompt.content],
      id: prompt.id,
      ids: [prompt.id],
      spaceId: null,
    });
  }

  const spaceNames = new Map<string, string>();
  for (const space of library.spaces) {
    if (space.deleted_at !== null) continue;
    spaceNames.set(space.id, space.name);
    out.push({
      key: `brain:${space.id}`,
      kind: 'brain',
      title: space.name,
      shortcut: '',
      place: '',
      placeKey: `brain:${space.id}`,
      byName: library.personName(space.user_id),
      edited: when(space.updated_at),
      labels: [],
      keywords: [],
      text: [space.description],
      id: space.id,
      ids: [space.id],
      spaceId: null,
    });
  }

  for (const item of library.items) {
    // An item in the trash, or in a Brain that is, is not offered.
    const spaceName = spaceNames.get(item.space_id);
    if (item.deleted_at !== null || spaceName === undefined) continue;
    out.push({
      key: `item:${item.id}`,
      kind: 'item',
      title: item.name,
      shortcut: '',
      place: spaceName,
      placeKey: `brain:${item.space_id}`,
      byName: library.personName(item.user_id),
      edited: when(item.updated_at),
      labels: [],
      keywords: [],
      text: [item.summary, item.body],
      id: item.id,
      ids: [item.id],
      spaceId: item.space_id,
    });
  }

  return out;
}

/**
 * The address an item opens at. The same links the extension's Review button
 * uses: the page reads the id, opens the item and takes the id off the address.
 */
export function paletteItemPath(item: Pick<PaletteItem, 'kind' | 'id' | 'spaceId'>): string {
  if (item.kind === 'snippet') return `/?snippet=${encodeURIComponent(item.id)}`;
  if (item.kind === 'prompt') return `/prompts?prompt=${encodeURIComponent(item.id)}`;
  if (item.kind === 'brain') return `/memory/${encodeURIComponent(item.id)}`;
  return `/memory/${encodeURIComponent(item.spaceId ?? '')}?item=${encodeURIComponent(item.id)}`;
}
