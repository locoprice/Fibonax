import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEMORY_CLEANUP_PROMPT } from '@/features/memory/memoryCleanup';

// The phone cannot import TypeScript, so it carries its own copy of the prompt.
// This holds the copy to the dashboard's, character for character.
describe('memory clean-up prompt', () => {
  it('is the same on the phone and the dashboard', () => {
    const mobile = readFileSync(resolve(process.cwd(), 'public', 'mobile', 'index.html'), 'utf8');
    const literal = /var MEM_CLEANUP_PROMPT=("(?:[^"\\]|\\.)*");/.exec(mobile)?.[1];
    expect(literal).toBeDefined();
    expect(JSON.parse(literal ?? '""')).toBe(MEMORY_CLEANUP_PROMPT);
  });

  it('keeps the four steps and stays free of long dashes', () => {
    expect(MEMORY_CLEANUP_PROMPT).toMatch(/^1\. List every memory/m);
    expect(MEMORY_CLEANUP_PROMPT).toMatch(/^4\. Then show me the cleaned version/m);
    expect(MEMORY_CLEANUP_PROMPT).not.toMatch(/[–—]/);
  });
});
