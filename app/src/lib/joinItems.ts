import { uniqueToken } from '@/lib/aiDraft';
import { rowBodies } from '@/lib/snippetBodies';
import type { Prompt, PromptBlock, PromptBlockType, Snippet } from '@/types/database';
import type { SnippetFormValues } from '@/types/schemas';

/**
 * "Join into one" for the Suggestions on Analytics: the snippets, or prompts,
 * a person keeps using one after the other become one new item, in that order.
 *
 * Nothing is saved here. The result opens in the editor, unsaved, so the
 * person reads it and saves it, or cancels and nothing changes. The items it
 * came from are never touched. Pure, so src/__tests__/joinItems.test.ts pins it.
 */

const NAME_MAX = 100;

/** "A, B and C", cut to the name limit. */
export function joinedName(titles: readonly string[]): string {
  const clean = titles.map((t) => t.trim()).filter((t) => t !== '');
  const text =
    clean.length <= 1 ? clean.join('') : `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
  return text.length > NAME_MAX ? text.slice(0, NAME_MAX).trim() : text;
}

/**
 * One snippet holding the others' text, a blank line apart, in the first one's
 * language. A snippet without that language gives its own text. The plain text
 * is joined: bold, italic and lists stay in the snippets it came from. It goes
 * into the first one's folder when that folder is personal, otherwise no folder.
 */
export function joinSnippets(parts: readonly Snippet[], takenTriggers: Iterable<string>): SnippetFormValues {
  const first = parts[0];
  const language = first ? first.language : 'EN';
  const content = parts
    .map((s) => (rowBodies(s)[language] ?? s.content).trim())
    .filter((t) => t !== '')
    .join('\n\n');
  const name = joinedName(parts.map((s) => s.name));
  return {
    name,
    trigger: uniqueToken(name, takenTriggers),
    content,
    bodies: { [language]: content },
    bodies_html: {},
    folder_id: first && first.organization_id === null ? first.folder_id : null,
    language,
    pinned: false,
    alternative_queries: [],
    check_unfinished: true,
  };
}

/** What a new prompt opens with. */
export interface PromptSeed {
  name: string;
  blocks: PromptBlock[];
  folder_id: string | null;
  ask_user_questions: boolean;
}

const BLOCK_ORDER: PromptBlockType[] = ['role', 'objective', 'context', 'examples', 'constraints'];

/** A prompt's blocks; an older prompt saved as plain text reads as its objective. */
function blocksOf(p: Prompt): PromptBlock[] {
  if (p.blocks && p.blocks.length) return p.blocks;
  return [{ type: 'objective', content: p.content, enabled: true }];
}

function textOf(p: Prompt, type: PromptBlockType): string {
  const b = blocksOf(p).find((x) => x.type === type);
  return b && b.enabled ? b.content.trim() : '';
}

/**
 * One prompt that does the others' jobs in order. The objective lists each
 * prompt's objective as a numbered step, under its name. The role is the first
 * prompt's. Context, examples and constraints are each kept once, in order, and
 * the first Brain a Context block carries stays on it. "Ask questions first"
 * is on when any of them asked.
 */
export function joinPrompts(parts: readonly Prompt[]): PromptSeed {
  const first = parts[0];
  const steps = parts
    .map((p) => ({ name: p.name.trim(), text: textOf(p, 'objective') }))
    .filter((s) => s.text !== '')
    .map((s, i) => `${i + 1}. ${s.name}: ${s.text}`);
  const objective = steps.length ? `Do these in order:\n\n${steps.join('\n\n')}` : '';

  function distinct(type: PromptBlockType): string {
    const seen: string[] = [];
    for (const p of parts) {
      const t = textOf(p, type);
      if (t !== '' && !seen.includes(t)) seen.push(t);
    }
    return seen.join('\n\n');
  }

  const brain =
    parts
      .map((p) => blocksOf(p).find((b) => b.type === 'context' && b.enabled && b.brain)?.brain ?? null)
      .find((b) => b !== null) ?? null;

  const blocks = BLOCK_ORDER.map((type): PromptBlock => {
    const content =
      type === 'role' ? parts.map((p) => textOf(p, 'role')).find((t) => t !== '') ?? ''
      : type === 'objective' ? objective
      : distinct(type);
    const block: PromptBlock = {
      type,
      content,
      enabled: type === 'role' || type === 'objective' || content !== '' || (type === 'context' && brain !== null),
    };
    if (type === 'context' && brain) block.brain = brain;
    return block;
  });

  return {
    name: joinedName(parts.map((p) => p.name)),
    blocks,
    folder_id: first && first.organization_id === null ? first.folder_id : null,
    ask_user_questions: parts.some((p) => p.ask_user_questions),
  };
}
