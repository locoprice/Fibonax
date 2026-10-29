/**
 * The shared memory chunker, loaded into the dashboard (MEMORY-002 D1).
 *
 * `extension/shared/memory-chunk.js` decides where a long text is cut into
 * shard-sized pieces. The extension's chat capture already uses it, and the
 * document upload has the identical problem, so it loads the same file at
 * runtime rather than carrying a second splitter: two implementations would
 * eventually disagree, and the same file would chunk differently depending on
 * whether it arrived through the extension or through this page.
 *
 * Loaded the same way `fillFormEngine.ts` loads the formula engine, from
 * `/extension/*`, which `extensionScriptsPlugin` serves in dev and copies into
 * dist at build (lib/loadScript.ts).
 */
import { loadScript } from '@/lib/loadScript';

export interface SbChunkResult {
  chunks: string[];
  /** Pieces that had to be cut mid-paragraph, reported rather than hidden. */
  forced: number;
}

export interface SbMemoryChunkApi {
  MAX_BODY: number;
  chunkText(text: string, limit?: number): SbChunkResult;
  chunkBlocks(blocks: string[], limit?: number): SbChunkResult;
}

declare global {
  interface Window {
    SBMemoryChunk?: SbMemoryChunkApi;
  }
}

const CHUNKER_SRC = '/extension/shared/memory-chunk.js';

/** The chunker, loading it on first use. Throws if the file cannot be served. */
export async function loadMemoryChunk(): Promise<SbMemoryChunkApi> {
  if (window.SBMemoryChunk) return window.SBMemoryChunk;
  await loadScript(CHUNKER_SRC);
  const api = window.SBMemoryChunk;
  if (!api) throw new Error('The text splitter did not load');
  return api;
}
