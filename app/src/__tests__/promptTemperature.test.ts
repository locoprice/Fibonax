import { describe, expect, it } from 'vitest';
import { assembleBlocks, ASK_USER_QUESTIONS_SECTION } from '@/lib/promptUtils';
import {
  DEFAULT_TEMPERATURE,
  TEMPERATURE_PRESETS,
  temperaturePreset,
  temperatureSection,
} from '@/lib/promptTemperature';
import { buildPromptFile, promptsFromJson, type PromptExportSource } from '@/lib/promptIo';

// Prompt temperature (Valentina, 2026-11-24). Chat apps take no temperature
// number, so the choice is saved on the prompt and written into its text as
// one "Answer style" section. Null means no choice: the text stays as written.

const blocks = [
  { type: 'role', content: 'You are an editor.', enabled: true },
  { type: 'objective', content: 'Fix typos.', enabled: true },
];
const TASK = '## Role\nYou are an editor.\n\n## Objective\nFix typos.';

describe('the three steps', () => {
  it('are Precise 0.2, Balanced 0.5 and Creative 0.9, starting on Balanced', () => {
    expect(TEMPERATURE_PRESETS.map((p) => [p.label, p.value])).toEqual([
      ['Precise', 0.2],
      ['Balanced', 0.5],
      ['Creative', 0.9],
    ]);
    expect(DEFAULT_TEMPERATURE).toBe(0.5);
  });

  it('place any number from 0 to 2 on a step, and nothing else', () => {
    expect([0, 0.2, 0.3].map((t) => temperaturePreset(t)?.label)).toEqual(['Precise', 'Precise', 'Precise']);
    expect([0.31, 0.5, 0.7].map((t) => temperaturePreset(t)?.label)).toEqual(['Balanced', 'Balanced', 'Balanced']);
    expect([0.71, 0.9, 2].map((t) => temperaturePreset(t)?.label)).toEqual(['Creative', 'Creative', 'Creative']);
    expect([null, undefined, -0.1, 2.1, Number.NaN].map((t) => temperaturePreset(t))).toEqual([null, null, null, null, null]);
  });

  it('name the number in the sentence the AI reads', () => {
    expect(temperatureSection(0.2)).toMatch(/^## Answer style\nAnswer as if your temperature were set to 0\.2: precise/);
    expect(temperatureSection(0.9)).toContain('0.9: creative');
    expect(temperatureSection(null)).toBe('');
  });
});

describe('the prompt text', () => {
  it('stays as written when no step was picked', () => {
    expect(assembleBlocks(blocks, { temperature: null })).toBe(TASK);
    expect(assembleBlocks(blocks)).toBe(TASK);
  });

  it('puts the answer style after the task and before the questions', () => {
    expect(assembleBlocks(blocks, { temperature: 0.5 })).toBe(`${TASK}\n\n${temperatureSection(0.5)}`);
    expect(assembleBlocks(blocks, { temperature: 0.2, askUserQuestions: true })).toBe(
      `${TASK}\n\n${temperatureSection(0.2)}\n\n${ASK_USER_QUESTIONS_SECTION}`,
    );
  });

  it('keeps an empty prompt empty', () => {
    expect(assembleBlocks([{ type: 'role', content: ' ', enabled: true }], { temperature: 0.9 })).toBe('');
  });
});

describe('export and import', () => {
  const source: PromptExportSource = {
    name: 'Brainstorm names',
    content: `${TASK}\n\n${temperatureSection(0.9)}`,
    shortcut: '',
    strategy_type: null,
    thinking_mode: null,
    preferred_model: null,
    complexity_level: null,
    intent_category: null,
    output_type: null,
    blocks,
    ask_user_questions: false,
    temperature: 0.9,
  } as PromptExportSource;

  it('carries the temperature through a file', () => {
    const file = buildPromptFile([source]);
    expect(file.prompts[0]?.temperature).toBe(0.9);
    const back = promptsFromJson(JSON.parse(JSON.stringify(file)));
    expect(back.valid[0]?.temperature).toBe(0.9);
  });

  it('drops a temperature it cannot place, and builds the text with one it can', () => {
    const odd = promptsFromJson({ prompts: [{ name: 'A', blocks, temperature: 'hot' }] });
    expect(odd.valid[0]?.temperature).toBeNull();
    expect(odd.valid[0]?.content).toBe(TASK);
    const fromBlocks = promptsFromJson({ prompts: [{ name: 'B', blocks, temperature: 0.2 }] });
    expect(fromBlocks.valid[0]?.content).toBe(`${TASK}\n\n${temperatureSection(0.2)}`);
  });
});
