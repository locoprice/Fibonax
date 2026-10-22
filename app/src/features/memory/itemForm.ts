import type { MemoryItemKind } from '@/types/database';

// The numbers and choices behind the Brain item window, kept apart from the
// component so they can be tested and so the limits are written once.

/** Mirrors the memory_shards_name_length CHECK. */
export const NAME_MAX = 64;
/** Mirrors memory_shards_summary_length. */
export const SUMMARY_MAX = 280;
/** Mirrors memory_shards_body_length. Anything larger is a document, not a fact. */
export const BODY_MAX = 20000;

export const KIND_LABELS: Record<MemoryItemKind, string> = {
  fact: 'Fact',
  note: 'Note',
  document: 'Document',
  conversation: 'Conversation',
};

/** Document pieces are produced by an upload, so the window does not offer that kind. */
const AUTHORABLE_KINDS: readonly MemoryItemKind[] = ['fact', 'note', 'conversation'];

/**
 * The kinds the menu lists. An item that already has a kind the window does not
 * offer (a piece of an uploaded file) keeps it in the list, so the menu shows
 * what is saved instead of the first choice.
 */
export function kindOptions(current: MemoryItemKind): MemoryItemKind[] {
  return AUTHORABLE_KINDS.includes(current) ? [...AUTHORABLE_KINDS] : [...AUTHORABLE_KINDS, current];
}

export type BodyUsageTone = 'ok' | 'warn' | 'over';

export interface BodyUsage {
  /** How full the bar is, 0 to 100. Any text at all shows at least a sliver. */
  percent: number;
  tone: BodyUsageTone;
  /** Characters past the limit, 0 while inside it. */
  over: number;
}

/** How much of the body limit the text uses, and whether to warn about it. */
export function bodyUsage(characters: number, max: number = BODY_MAX): BodyUsage {
  const over = Math.max(0, characters - max);
  if (over > 0) return { percent: 100, tone: 'over', over };
  const percent = characters === 0 ? 0 : Math.min(100, Math.max(1, Math.round((characters / max) * 100)));
  return { percent, tone: characters >= max * 0.8 ? 'warn' : 'ok', over: 0 };
}
