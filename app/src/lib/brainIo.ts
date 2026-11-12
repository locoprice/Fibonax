import { asRecord, downloadJson, listIn, readJsonFile } from '@/lib/fileIo';
import { memoryApi } from '@/lib/api/memoryApi';
import type { MemoryItem, MemoryItemKind, MemorySpace } from '@/types/database';

// A Brain file carries text only: each Brain's name and description, and its
// items' name, summary, text, kind and pin. Uploaded files and version history
// stay behind. The limits are the database's own (memory_spaces and
// memory_shards check constraints), so what comes in is what a Brain can hold.

const NAME_MAX = 64;
const SUMMARY_MAX = 280;
const DESCRIPTION_MAX = 280;
const BODY_MAX = 20000;

/** The kinds the item editor offers. A file chunk ('document') comes back as a fact. */
const IMPORT_KINDS = new Set<MemoryItemKind>(['fact', 'note', 'conversation']);

// ─── Export ───────────────────────────────────────────────────────────────────

export interface BrainFileItem {
  name: string;
  summary: string;
  body: string;
  kind: MemoryItemKind;
  pinned: boolean;
}

export interface BrainFileEntry {
  name: string;
  description: string;
  items: BrainFileItem[];
}

/** The file for these Brains and the live items inside them. */
export function buildBrainFile(
  spaces: readonly Pick<MemorySpace, 'id' | 'name' | 'description'>[],
  items: readonly Pick<MemoryItem, 'space_id' | 'name' | 'summary' | 'body' | 'kind' | 'pinned'>[],
) {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    brains: spaces.map<BrainFileEntry>((space) => ({
      name: space.name,
      description: space.description,
      items: items
        .filter((item) => item.space_id === space.id)
        .map((item) => ({
          name: item.name,
          summary: item.summary,
          body: item.body,
          kind: item.kind,
          pinned: item.pinned,
        })),
    })),
  };
}

/** Saves every live Brain as `fibonax-brains-<today>.json`; returns how many went in. */
export async function exportBrains(): Promise<number> {
  const [spaces, items] = await Promise.all([memoryApi.listSpaces(false), memoryApi.listAllItems()]);
  downloadJson('brains', buildBrainFile(spaces, items));
  return spaces.length;
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface BrainParseResult {
  valid: BrainFileEntry[];
  /** Brains and items in the file that had no name or no text, or too much of it. */
  skipped: number;
}

function itemOf(raw: unknown): BrainFileItem | null {
  const item = asRecord(raw);
  if (!item) return null;
  const name = String(item['name'] ?? item['title'] ?? '').trim().slice(0, NAME_MAX).trim();
  const body = typeof item['body'] === 'string' ? item['body'] : '';
  if (!name || body.trim() === '' || body.length > BODY_MAX) return null;
  const kind = item['kind'] as MemoryItemKind;
  return {
    name,
    summary: String(item['summary'] ?? '').trim().slice(0, SUMMARY_MAX),
    body,
    kind: IMPORT_KINDS.has(kind) ? kind : 'fact',
    pinned: item['pinned'] === true,
  };
}

/** The Brains in a parsed file: a Fibonax export `{ brains: [...] }` or a plain list. */
export function brainsFromJson(parsed: unknown): BrainParseResult {
  const rawBrains = listIn(parsed, 'brains');
  if (rawBrains.length === 0) {
    throw new Error('No Brains found in the file. Expected a Fibonax export or a JSON list of Brains.');
  }
  const valid: BrainFileEntry[] = [];
  let skipped = 0;
  for (const raw of rawBrains) {
    const brain = asRecord(raw);
    const name = brain ? String(brain['name'] ?? brain['title'] ?? '').trim().slice(0, NAME_MAX).trim() : '';
    if (!brain || !name) {
      skipped++;
      continue;
    }
    const items: BrainFileItem[] = [];
    for (const rawItem of Array.isArray(brain['items']) ? (brain['items'] as unknown[]) : []) {
      const item = itemOf(rawItem);
      if (item) items.push(item);
      else skipped++;
    }
    valid.push({
      name,
      description: String(brain['description'] ?? '').trim().slice(0, DESCRIPTION_MAX),
      items,
    });
  }
  return { valid, skipped };
}

export async function parseBrainFile(file: File): Promise<BrainParseResult> {
  return brainsFromJson(await readJsonFile(file));
}
