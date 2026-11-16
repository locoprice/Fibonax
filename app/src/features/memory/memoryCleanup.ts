/**
 * The memory clean-up tip on the Brains page.
 *
 * An AI's own memory (ChatGPT, Claude, Gemini) works best when its top layer
 * stays small. The tip explains that and hands out one prompt that asks the AI
 * to review what it remembers. The phone carries the same words in
 * `app/public/mobile/index.html` (MEM_CLEANUP_PROMPT); memoryCleanup.test.ts
 * holds the two together, character for character.
 */
export const MEMORY_CLEANUP_PROMPT = [
  'Look at everything you remember about me.',
  '',
  'Goal: a short, correct memory.',
  '',
  '1. List every memory, one line each.',
  "2. Mark each one: KEEP, FIX (wrong or outdated) or DELETE (a one-off, or something you can find again in my chats).",
  "3. Ask me about anything you're not sure of, with clickable options.",
  '4. Then show me the cleaned version, under 30 lines, and tell me where to click to change it.',
  '',
  'Reminder: a lighter memory is better, and it leaves you more room in the future.',
].join('\n');
