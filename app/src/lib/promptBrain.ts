/**
 * A Brain inside a prompt (v3.104.0).
 *
 * A prompt's Context block can carry a Brain. The prompt keeps a reference,
 * never the Brain's text: `{brain: id=<uuid>; name=<name>}` on its own line
 * where the Brain goes. At use time every surface swaps the token for the
 * Brain's items, as "Copy whole Brain" hands them out, so the prompt always
 * carries the Brain as it is that day.
 *
 * The rule lives once, in `extension/shared/memory-pack.js` (brainToken,
 * promptBrainRefs, formatBrainBlock, resolvePromptBrains, labelBrainTokens),
 * which the extension, its popup and the phone read. The dashboard loads that
 * same file at runtime for the resolution, as memoryChunk.ts loads the
 * chunker, so the block a prompt hands out is built in one place. The three
 * small readers below (write the token, list the Brains, label them for a
 * preview) run synchronously while the editor assembles a draft, so they are
 * written here too; app/src/__tests__/promptBrain.test.ts holds them to the
 * module, character for character.
 */
import { memoryApi } from '@/lib/api/memoryApi';
import { loadScript } from '@/lib/loadScript';
import type { PromptBrainRef } from '@/types/database';

/** One item as the module formats it: the name as a heading, the body under it. */
export interface SbBrainItem {
  name: string;
  body: string;
}

export type SbBrainReason = 'missing' | 'empty' | 'failed';

/** What the module needs to know about one Brain a prompt names. */
export interface SbBrainLookupEntry {
  name?: string;
  items?: SbBrainItem[];
  reason?: SbBrainReason;
}

/** A Brain a prompt names that is not handed out, and why. */
export interface SbBrainGap extends PromptBrainRef {
  reason: SbBrainReason;
}

export interface SbMemoryPackApi {
  brainToken(brain: PromptBrainRef): string;
  promptBrainRefs(text: string): PromptBrainRef[];
  /** `plain` leaves the block's markers off, for text that sits inside a block of its own. */
  formatBrainBlock(items: SbBrainItem[], plain?: boolean): string;
  brainLeadLine(name: string): string;
  brainUnavailableLine(name: string, reason?: SbBrainReason): string;
  resolvePromptBrains(
    text: string,
    lookup: Record<string, SbBrainLookupEntry>,
    fallbackReason?: SbBrainReason,
    plain?: boolean,
  ): string;
  labelBrainTokens(text: string): string;
  promptBrainGaps(
    text: string,
    lookup: Record<string, SbBrainLookupEntry>,
    fallbackReason?: SbBrainReason,
  ): SbBrainGap[];
  brainGapNote(gaps: SbBrainGap[]): string;
}

// Must equal BRAIN_TOKEN_RE and BRAIN_NAME_MAX in extension/shared/memory-pack.js.
const BRAIN_TOKEN_RE = /\{brain:\s*id=([0-9a-fA-F-]{36})\s*(?:;\s*name=([^}]*))?\}/g;
const BRAIN_NAME_MAX = 64;

/** A Brain's name as the token carries it: one line, no braces, at most 64. */
export function brainTokenName(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/[{}\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BRAIN_NAME_MAX);
}

/** The token the editor writes into the Context block. */
export function brainToken(brain: PromptBrainRef): string {
  const name = brainTokenName(brain.name);
  return `{brain: id=${brain.id}${name ? `; name=${name}` : ''}}`;
}

/** Every Brain a prompt carries, once each, in order. */
export function promptBrainRefs(text: string): PromptBrainRef[] {
  const out: PromptBrainRef[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(BRAIN_TOKEN_RE)) {
    const id = (match[1] ?? '').toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: brainTokenName(match[2]) });
  }
  return out;
}

/** The prompt as a card previews it: each token as "Brain: <name>". */
export function labelBrainTokens(text: string): string {
  return text.replace(BRAIN_TOKEN_RE, (_token, _id, name: string | undefined) => {
    const label = brainTokenName(name);
    return label ? `Brain: ${label}` : 'Brain';
  });
}

const PACK_SRC = '/extension/shared/memory-pack.js';

function installedPack(): SbMemoryPackApi | undefined {
  return (globalThis as { SBMemoryPack?: SbMemoryPackApi }).SBMemoryPack;
}

/** The shared module, loading it on first use. Throws if the file cannot be served. */
export async function loadMemoryPack(): Promise<SbMemoryPackApi> {
  const installed = installedPack();
  if (installed) return installed;
  await loadScript(PACK_SRC);
  const api = installedPack();
  if (!api) throw new Error('The memory pack did not load');
  return api;
}

/**
 * Reads the Brains a prompt names, as the extension and the phone read them:
 * live Brains only, live items only, archived items left out (they are kept to
 * be restored, never handed to an AI), pinned first, newest next, the id
 * breaking a tie. A Brain the reader cannot see is left out of the lookup,
 * which the module reads as "not available here": a teammate's Brain behind a
 * shared prompt, or one in the trash. A read that fails marks every Brain as
 * such, never as missing.
 */
export async function brainLookup(refs: PromptBrainRef[]): Promise<Record<string, SbBrainLookupEntry>> {
  const lookup: Record<string, SbBrainLookupEntry> = {};
  if (!refs.length) return lookup;
  try {
    const spaces = await memoryApi.listSpaces();
    const wanted = refs.filter((ref) => spaces.some((space) => space.id === ref.id));
    for (const ref of wanted) {
      const space = spaces.find((candidate) => candidate.id === ref.id);
      lookup[ref.id] = { name: space?.name ?? ref.name, items: [] };
    }
    const items = await memoryApi.listPromptBrainItems(wanted.map((ref) => ref.id));
    for (const item of items) lookup[item.space_id]?.items?.push({ name: item.name, body: item.body });
  } catch (error) {
    console.error('[Fibonax] Could not read the Brain a prompt carries:', error);
    for (const ref of refs) lookup[ref.id] = { name: ref.name, reason: 'failed' };
  }
  return lookup;
}

export interface ResolvedPrompt {
  text: string;
  /** The Brains that were not handed out, with the reason, for the surface to say so. */
  unavailable: SbBrainGap[];
}

/**
 * The prompt as it is handed out: every Brain token replaced by the Brain's
 * items, or by one visible line when the Brain could not be. Throws only when
 * the shared module cannot be loaded, which the caller reports as such.
 */
export async function resolvePromptBrains(text: string): Promise<ResolvedPrompt> {
  const refs = promptBrainRefs(text);
  if (!refs.length) return { text, unavailable: [] };
  const [pack, lookup] = await Promise.all([loadMemoryPack(), brainLookup(refs)]);
  return { text: pack.resolvePromptBrains(text, lookup), unavailable: pack.promptBrainGaps(text, lookup) };
}
