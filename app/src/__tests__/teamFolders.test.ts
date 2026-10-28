import { describe, expect, it } from 'vitest';
import { describeFolderContents } from '@/lib/teamFolders';

// The Team page lists each shared folder as one row with a short line saying
// what it holds. The line is what a teammate reads to decide whether the
// folder is worth opening, so its wording is pinned here.

describe('describeFolderContents', () => {
  it('says Empty when a folder holds nothing', () => {
    expect(describeFolderContents(0, 0)).toBe('Empty');
  });

  it('counts one kind on its own', () => {
    expect(describeFolderContents(1, 0)).toBe('1 snippet');
    expect(describeFolderContents(3, 0)).toBe('3 snippets');
    expect(describeFolderContents(0, 1)).toBe('1 prompt');
    expect(describeFolderContents(0, 4)).toBe('4 prompts');
  });

  it('joins both kinds with a middle dot, snippets first', () => {
    expect(describeFolderContents(49, 4)).toBe('49 snippets · 4 prompts');
    expect(describeFolderContents(1, 1)).toBe('1 snippet · 1 prompt');
  });
});
