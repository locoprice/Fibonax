/**
 * What the three Import and export rows in Settings share: saving a JSON file,
 * reading one, and finding the list inside it. Snippets, prompts and Brains
 * each own their file's shape (`snippetIo`, `promptIo`, `brainIo`); the way a
 * file goes out and comes in is decided once, here.
 */

/** What an import store action reports: rows saved, rows that failed. */
export interface ImportBatchResult {
  imported: number;
  failed: number;
}

/** Saves `data` as `fibonax-<kind>-<today>.json` through a temporary link. */
export function downloadJson(kind: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `fibonax-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** The file's JSON, or an error a person can read. */
export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Invalid JSON file. Could not parse.');
  }
}

/** `value` as a plain object, or null when it is a list, text or empty. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The entries of a file: a bare list, or the list kept under `key`. */
export function listIn(parsed: unknown, key: string): unknown[] {
  if (Array.isArray(parsed)) return parsed as unknown[];
  const list = asRecord(parsed)?.[key];
  return Array.isArray(list) ? (list as unknown[]) : [];
}

/** What a row names its things: "snippet" and "snippets". */
export interface Noun {
  one: string;
  other: string;
}

export function countOf(noun: Noun, count: number): string {
  return `${count} ${count === 1 ? noun.one : noun.other}`;
}

/** "3 prompts imported." or "3 prompts imported, 1 skipped." */
export function importMessage(noun: Noun, count: number, skipped: number): string {
  const done = `${countOf(noun, count)} imported`;
  return skipped > 0 ? `${done}, ${skipped} skipped.` : `${done}.`;
}

export function exportMessage(noun: Noun, count: number): string {
  return `${countOf(noun, count)} exported.`;
}
