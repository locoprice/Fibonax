/**
 * Adds what a person ticked in the starter library to their own snippets,
 * prompts or Brains.
 *
 * The planners are pure, so the tests pin them: an item already there (same
 * name and same text) is skipped, and a trigger or shortcut already taken gets
 * a number (`thanks_2`), the rule AI drafts follow too (`uniqueToken`). The
 * runners then write through the stores, so the pages update the way they do
 * after any other add.
 */

import { foldersApi } from '@/lib/api/foldersApi';
import { memoryApi } from '@/lib/api/memoryApi';
import { uniqueToken } from '@/lib/aiDraft';
import { assembleBlocks } from '@/lib/promptUtils';
import { useMemoryStore } from '@/stores/memoryStore';
import { usePromptStore } from '@/stores/promptStore';
import { useSnippetStore } from '@/stores/snippetStore';
import type { Folder, PromptBlock } from '@/types/database';
import type { PromptFormValues, SnippetFormValues } from '@/types/schemas';
import {
  LIBRARY_FOLDER_NAME,
  type LibraryBrain,
  type LibraryPrompt,
  type LibrarySnippet,
} from './catalogue';

export interface AddResult {
  added: number;
  /** Already there, so left out. */
  skipped: number;
  /** Why the add stopped early, in plain words; null when everything went in. */
  error: string | null;
}

export interface Plan<T> {
  toAdd: T[];
  skipped: number;
}

function sameText(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** The snippet as the store saves it. English, in the library folder. */
export function snippetForm(item: LibrarySnippet, folderId: string | null): SnippetFormValues {
  return {
    name: item.name,
    trigger: item.trigger,
    content: item.body,
    bodies: { EN: item.body },
    language: 'EN',
    folder_id: folderId,
    pinned: false,
    alternative_queries: [],
    check_unfinished: true,
  };
}

/** The five blocks in the editor's order; Context and Examples are on only when they hold text. */
export function promptBlocks(item: LibraryPrompt): PromptBlock[] {
  return [
    { type: 'role', content: item.role, enabled: true },
    { type: 'objective', content: item.objective, enabled: true },
    { type: 'context', content: item.context, enabled: item.context !== '' },
    { type: 'examples', content: '', enabled: false },
    { type: 'constraints', content: item.constraints, enabled: true },
  ];
}

/** The prompt as the store saves it, with Ask User Questions on (the editor's default). */
export function promptForm(item: LibraryPrompt, folderId: string | null): PromptFormValues {
  const blocks = promptBlocks(item);
  return {
    name: item.name,
    content: assembleBlocks(blocks, { askUserQuestions: true }),
    shortcut: item.shortcut,
    strategy_type: null,
    thinking_mode: null,
    preferred_model: null,
    complexity_level: null,
    intent_category: item.intent,
    output_type: item.output,
    blocks,
    ask_user_questions: true,
    folder_id: folderId,
  };
}

/** Which ticked snippets to add, each with a trigger nobody else has. */
export function planSnippets(
  picked: readonly LibrarySnippet[],
  existing: readonly { name: string; content: string; triggers: readonly string[] }[],
): Plan<LibrarySnippet> {
  const taken = existing.flatMap((s) => s.triggers);
  const toAdd: LibrarySnippet[] = [];
  let skipped = 0;
  for (const item of picked) {
    if (existing.some((s) => s.name === item.name && sameText(s.content, item.body))) {
      skipped++;
      continue;
    }
    const trigger = uniqueToken(item.trigger, taken);
    taken.push(trigger);
    toAdd.push({ ...item, trigger });
  }
  return { toAdd, skipped };
}

/** Which ticked prompts to add, each with a shortcut nobody else has. */
export function planPrompts(
  picked: readonly LibraryPrompt[],
  existing: readonly { name: string; content: string; shortcut: string | null }[],
): Plan<LibraryPrompt> {
  const taken = existing.map((p) => p.shortcut ?? '').filter((s) => s !== '');
  const toAdd: LibraryPrompt[] = [];
  let skipped = 0;
  for (const item of picked) {
    const content = promptForm(item, null).content;
    if (existing.some((p) => p.name === item.name && sameText(p.content, content))) {
      skipped++;
      continue;
    }
    const shortcut = uniqueToken(item.shortcut, taken);
    taken.push(shortcut);
    toAdd.push({ ...item, shortcut });
  }
  return { toAdd, skipped };
}

/** Which ticked Brains to add. A name already used, in the trash too, is skipped. */
export function planBrains(
  picked: readonly LibraryBrain[],
  existingNames: readonly string[],
): Plan<LibraryBrain> {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const toAdd = picked.filter((b) => !taken.has(b.name.toLowerCase()));
  return { toAdd, skipped: picked.length - toAdd.length };
}

function reason(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong.';
}

/**
 * The person's own "From the library" folder, made the first time. Read fresh
 * from the server, so a folder made from the other page is found, not doubled.
 */
async function libraryFolder(create: () => Promise<Folder>): Promise<Folder> {
  const folders = await foldersApi.listFolders();
  const found = folders.find(
    (f) => f.name === LIBRARY_FOLDER_NAME && f.parent_id === null && f.organization_id === null,
  );
  return found ?? create();
}

const FOLDER_FORM = { name: LIBRARY_FOLDER_NAME, icon: 'star', parent_id: null, description: null };

export async function addSnippets(picked: readonly LibrarySnippet[]): Promise<AddResult> {
  const store = useSnippetStore.getState();
  const plan = planSnippets(picked, store.snippets);
  if (plan.toAdd.length === 0) return { added: 0, skipped: plan.skipped, error: null };
  try {
    const folder = await libraryFolder(() => useSnippetStore.getState().addFolder(FOLDER_FORM));
    const known = useSnippetStore.getState().folders.some((f) => f.id === folder.id);
    const { imported, failed } = await store.importSnippets(plan.toAdd.map((s) => snippetForm(s, folder.id)));
    // A folder made from the Prompts page since this list loaded: reload so
    // the rail shows it beside the snippets just put in it.
    if (!known) await useSnippetStore.getState().load();
    return {
      added: imported,
      skipped: plan.skipped,
      error: failed > 0 ? `${failed} could not be saved. Try adding them again.` : null,
    };
  } catch (err) {
    return { added: 0, skipped: plan.skipped, error: reason(err) };
  }
}

export async function addPrompts(picked: readonly LibraryPrompt[]): Promise<AddResult> {
  const store = usePromptStore.getState();
  const plan = planPrompts(picked, store.prompts);
  if (plan.toAdd.length === 0) return { added: 0, skipped: plan.skipped, error: null };
  let added = 0;
  try {
    const folder = await libraryFolder(() => usePromptStore.getState().addFolder(FOLDER_FORM));
    const known = usePromptStore.getState().folders.some((f) => f.id === folder.id);
    for (const item of plan.toAdd) {
      await store.addPrompt(promptForm(item, folder.id));
      added++;
    }
    if (!known) await usePromptStore.getState().load();
    return { added, skipped: plan.skipped, error: null };
  } catch (err) {
    return { added, skipped: plan.skipped, error: reason(err) };
  }
}

export async function addBrains(picked: readonly LibraryBrain[]): Promise<AddResult> {
  const store = useMemoryStore.getState();
  const names = [...store.spaces, ...store.trashedSpaces].map((s) => s.name);
  const plan = planBrains(picked, names);
  if (plan.toAdd.length === 0) return { added: 0, skipped: plan.skipped, error: null };
  let added = 0;
  try {
    for (const brain of plan.toAdd) {
      const space = await store.createSpace(brain.name, brain.description);
      for (const item of brain.items) {
        await memoryApi.saveItem({ space_id: space.id, name: item.name, summary: item.summary, body: item.body });
      }
      added++;
    }
    return { added, skipped: plan.skipped, error: null };
  } catch (err) {
    return { added, skipped: plan.skipped, error: reason(err) };
  } finally {
    // Item counts and sizes come from the server's totals; one reload covers
    // every Brain made, a half-filled one included when an item failed.
    await useMemoryStore.getState().loadSpaces();
  }
}
