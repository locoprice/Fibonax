/**
 * One line saying what a shared folder holds, for the folder rows on the Team
 * page: "3 snippets · 1 prompt", "1 snippet", or "Empty". Pure, so the wording
 * is pinned by a test rather than read off the screen.
 */
export function describeFolderContents(snippets: number, prompts: number): string {
  const parts: string[] = [];
  if (snippets > 0) parts.push(`${snippets} ${snippets === 1 ? 'snippet' : 'snippets'}`);
  if (prompts > 0) parts.push(`${prompts} ${prompts === 1 ? 'prompt' : 'prompts'}`);
  return parts.length === 0 ? 'Empty' : parts.join(' · ');
}
