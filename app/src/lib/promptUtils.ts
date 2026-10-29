import { brainToken } from '@/lib/promptBrain';
import type { PromptBlock, PromptBrainRef } from '@/types/database';

/**
 * Closing section for a prompt with "Ask User Questions" on. It comes last so
 * the model reads the whole task before it decides what to ask.
 */
export const ASK_USER_QUESTIONS_SECTION =
  '## Questions\nBefore you start, ask me clarifying questions about anything you need to know to do this task well.\nAsk one question at a time and wait for my answer, so I can respond easily.\nAsk no more than 5 questions in total.\nOnce you have enough information, ask me to confirm before you give the final result.';

export interface AssembleOptions {
  /** End the prompt with ASK_USER_QUESTIONS_SECTION. */
  askUserQuestions?: boolean;
}

/** A block as the assembler reads it: a stored or edited block, Brain included. */
export interface AssemblableBlock {
  type: string;
  content: string;
  enabled: boolean;
  brain?: PromptBrainRef | null;
}

/**
 * The text of one block. A Context block that carries a Brain starts with the
 * Brain's token on its own line, then a blank line, then whatever was typed:
 * at use time the token becomes the Brain's items (lib/promptBrain.ts), and
 * the typed text follows them.
 */
function blockText(block: AssemblableBlock): string {
  const text = block.content.trim();
  // Only the Context block carries a Brain; a stray key on any other block is ignored.
  if (block.type !== 'context' || !block.brain) return text;
  const token = brainToken(block.brain);
  return text ? `${token}\n\n${text}` : token;
}

/**
 * Assembles enabled prompt blocks into a plain-text prompt string.
 * Block headers follow the ## Markdown convention used by Claude.
 */
export function assembleBlocks(
  blocks: AssemblableBlock[],
  options: AssembleOptions = {},
): string {
  const assembled = blocks
    .filter((b) => b.enabled && (b.content.trim() || (b.type === 'context' && b.brain)))
    .map(
      (b) =>
        `## ${b.type.charAt(0).toUpperCase()}${b.type.slice(1)}\n${blockText(b)}`,
    )
    .join('\n\n');
  // An empty prompt stays empty: with no task written there is nothing to ask
  // about, and the editor's empty-draft states depend on ''.
  if (!assembled || !options.askUserQuestions) return assembled;
  return `${assembled}\n\n${ASK_USER_QUESTIONS_SECTION}`;
}

/** A block as it is stored, which can still be the retired Reasoning type. */
export interface StoredPromptBlock {
  type: string;
  content: string;
  enabled: boolean;
  /** The Brain a Context block carries (lib/promptBrain.ts), kept through the fold. */
  brain?: PromptBrainRef | null;
}

/**
 * Reasoning was retired as a block, and prompts saved before that still carry
 * one. Its text moves into Constraints, ahead of any text already there, so
 * nothing is hidden or lost and the assembled prompt keeps the same words in
 * the same order under a Constraints heading. The database move
 * (20260913000000_move_prompt_reasoning_into_constraints.sql) applies the same
 * rule. Returns the input itself when there is no Reasoning block.
 */
export function foldReasoningIntoConstraints(blocks: StoredPromptBlock[]): PromptBlock[] {
  const reasoning = blocks.find((b) => b.type === 'reasoning');
  // Reasoning is the only retired type, so without it every block is current.
  if (!reasoning) return blocks as PromptBlock[];

  const rest = blocks.filter((b) => b !== reasoning) as PromptBlock[];
  const reasoningText = reasoning.content.trim();
  if (!reasoningText) return rest;

  const constraints = rest.find((b) => b.type === 'constraints');
  const constraintsText = constraints ? constraints.content.trim() : '';
  const merged: PromptBlock =
    constraints && constraintsText
      ? {
          type: 'constraints',
          content: `${reasoningText}\n\n${constraintsText}`,
          // Either one on keeps all the text visible in the editor, where the
          // author sees it before anything is saved.
          enabled: reasoning.enabled || constraints.enabled,
        }
      : { type: 'constraints', content: reasoning.content, enabled: reasoning.enabled };

  if (constraints) return rest.map((b) => (b === constraints ? merged : b));
  // No Constraints block: the text takes Reasoning's place in the order.
  return blocks.map((b) => (b === reasoning ? merged : b)) as PromptBlock[];
}
