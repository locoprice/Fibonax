import type { ZodType } from 'zod';
import { asRecord, downloadJson, listIn, readJsonFile } from '@/lib/fileIo';
import { assembleBlocks } from '@/lib/promptUtils';
import { sanitizeTrigger } from '@/lib/snippetIo';
import type { Prompt, PromptBlock } from '@/types/database';
import { promptFormSchema, type PromptFormValues } from '@/types/schemas';

// ─── Export ───────────────────────────────────────────────────────────────────

/** What a prompt keeps in a file: what the editor sets, nothing the account owns (ids, owner, dates, counts). */
export type PromptExportSource = Pick<
  Prompt,
  | 'name'
  | 'content'
  | 'shortcut'
  | 'strategy_type'
  | 'thinking_mode'
  | 'preferred_model'
  | 'complexity_level'
  | 'intent_category'
  | 'output_type'
  | 'blocks'
  | 'ask_user_questions'
>;

/** The file for these prompts. */
export function buildPromptFile(prompts: readonly PromptExportSource[]) {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    prompts: prompts.map((p) => ({
      name: p.name,
      content: p.content,
      shortcut: p.shortcut ?? '',
      strategy_type: p.strategy_type,
      thinking_mode: p.thinking_mode,
      preferred_model: p.preferred_model,
      complexity_level: p.complexity_level,
      intent_category: p.intent_category,
      output_type: p.output_type,
      blocks: p.blocks,
      ask_user_questions: p.ask_user_questions,
    })),
  };
}

/** Saves every prompt as `fibonax-prompts-<today>.json`. */
export function exportPrompts(prompts: readonly PromptExportSource[]): void {
  downloadJson('prompts', buildPromptFile(prompts));
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface PromptParseResult {
  valid: PromptFormValues[];
  skipped: number;
}

const BLOCK_TYPES = new Set<string>(['role', 'objective', 'context', 'examples', 'constraints']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The value when the editor's own list allows it, else null: a setting from another version never sinks the prompt. */
function allowed<T>(field: ZodType<T | null>, value: unknown): T | null {
  const result = field.safeParse(value);
  return result.success ? result.data : null;
}

/** The blocks the editor knows, in the order the file has them; null when none are left. */
function blocksOf(raw: unknown): PromptBlock[] | null {
  if (!Array.isArray(raw)) return null;
  const blocks: PromptBlock[] = [];
  for (const entry of raw as unknown[]) {
    const block = asRecord(entry);
    if (!block || typeof block['type'] !== 'string' || !BLOCK_TYPES.has(block['type'])) continue;
    const brain = asRecord(block['brain']);
    blocks.push({
      type: block['type'] as PromptBlock['type'],
      content: typeof block['content'] === 'string' ? block['content'] : '',
      enabled: block['enabled'] !== false,
      ...(brain && typeof brain['id'] === 'string' && UUID.test(brain['id']) && typeof brain['name'] === 'string'
        ? { brain: { id: brain['id'], name: brain['name'] } }
        : {}),
    });
  }
  return blocks.length > 0 ? blocks : null;
}

/** One entry of a file as the form the store saves; null when it has no name or no text. */
function coerceItem(raw: Record<string, unknown>): PromptFormValues | null {
  const name = String(raw['name'] ?? raw['title'] ?? '').trim().slice(0, 100);
  const blocks = blocksOf(raw['blocks']);
  const ask = raw['ask_user_questions'] === true;
  const written = raw['content'] ?? raw['prompt'] ?? raw['text'];
  const text = typeof written === 'string' ? written : '';
  const content = text.trim() !== '' ? text : blocks ? assembleBlocks(blocks, { askUserQuestions: ask }) : '';
  if (!name || content.trim() === '') return null;

  const shortcutRaw = String(raw['shortcut'] ?? '').trim();
  const parsed = promptFormSchema.safeParse({
    name,
    content,
    shortcut: shortcutRaw === '' ? '' : sanitizeTrigger(shortcutRaw),
    strategy_type: allowed(promptFormSchema.shape.strategy_type, raw['strategy_type']),
    thinking_mode: allowed(promptFormSchema.shape.thinking_mode, raw['thinking_mode']),
    preferred_model: allowed(promptFormSchema.shape.preferred_model, raw['preferred_model']),
    complexity_level: allowed(promptFormSchema.shape.complexity_level, raw['complexity_level']),
    intent_category: allowed(promptFormSchema.shape.intent_category, raw['intent_category']),
    output_type: allowed(promptFormSchema.shape.output_type, raw['output_type']),
    blocks,
    ask_user_questions: ask,
    folder_id: null,
  });
  return parsed.success ? parsed.data : null;
}

/** The prompts in a parsed file: a Fibonax export `{ prompts: [...] }` or a plain list. */
export function promptsFromJson(parsed: unknown): PromptParseResult {
  const rawItems = listIn(parsed, 'prompts');
  if (rawItems.length === 0) {
    throw new Error('No prompts found in the file. Expected a Fibonax export or a JSON list of prompts.');
  }
  const valid: PromptFormValues[] = [];
  let skipped = 0;
  for (const item of rawItems) {
    const record = asRecord(item);
    const coerced = record ? coerceItem(record) : null;
    if (coerced) valid.push(coerced);
    else skipped++;
  }
  return { valid, skipped };
}

export async function parsePromptFile(file: File): Promise<PromptParseResult> {
  return promptsFromJson(await readJsonFile(file));
}
