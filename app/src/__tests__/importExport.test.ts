// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBrainFile, brainsFromJson } from '@/lib/brainIo';
import { exportMessage, importMessage, listIn } from '@/lib/fileIo';
import { buildPromptFile, promptsFromJson, type PromptExportSource } from '@/lib/promptIo';
import { parseImportFile } from '@/lib/snippetIo';

// Import and export lives in one Settings card for snippets, prompts and Brains.
// The three file formats round-trip, a file from another tool or version never
// sinks what it can still give, and the pages no longer carry the buttons.

const BRAIN_ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';

function prompt(over: Partial<PromptExportSource> = {}): PromptExportSource {
  return {
    name: 'Reply to a complaint',
    content: '## Role\nYou are a support lead.',
    shortcut: 'complaint',
    strategy_type: 'CoT',
    thinking_mode: 'balanced',
    preferred_model: 'claude-sonnet-4-6',
    complexity_level: 'medium',
    intent_category: 'Support',
    output_type: 'Plain',
    blocks: [{ type: 'role', content: 'You are a support lead.', enabled: true }],
    ask_user_questions: true,
    ...over,
  };
}

describe('messages', () => {
  const noun = { one: 'prompt', other: 'prompts' };

  it('counts what came in, and what was left out', () => {
    expect(importMessage(noun, 3, 0)).toBe('3 prompts imported.');
    expect(importMessage(noun, 1, 2)).toBe('1 prompt imported, 2 skipped.');
    expect(exportMessage(noun, 1)).toBe('1 prompt exported.');
  });

  it('finds a list bare or under its key', () => {
    expect(listIn([1, 2], 'prompts')).toEqual([1, 2]);
    expect(listIn({ prompts: [1] }, 'prompts')).toEqual([1]);
    expect(listIn({ groups: [] }, 'prompts')).toEqual([]);
    expect(listIn('text', 'prompts')).toEqual([]);
  });
});

describe('prompt files', () => {
  it('round-trips a prompt through its own export', () => {
    const file = buildPromptFile([prompt()]);
    const { valid, skipped } = promptsFromJson(JSON.parse(JSON.stringify(file)));
    expect(skipped).toBe(0);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({
      name: 'Reply to a complaint',
      content: '## Role\nYou are a support lead.',
      shortcut: 'complaint',
      strategy_type: 'CoT',
      thinking_mode: 'balanced',
      preferred_model: 'claude-sonnet-4-6',
      complexity_level: 'medium',
      intent_category: 'Support',
      output_type: 'Plain',
      ask_user_questions: true,
      folder_id: null,
    });
    expect(valid[0]?.blocks).toEqual([{ type: 'role', content: 'You are a support lead.', enabled: true }]);
  });

  it('keeps nothing the account owns', () => {
    const entry = buildPromptFile([prompt()]).prompts[0];
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'ask_user_questions',
      'blocks',
      'complexity_level',
      'content',
      'intent_category',
      'name',
      'output_type',
      'preferred_model',
      'shortcut',
      'strategy_type',
      'thinking_mode',
    ]);
  });

  it('reads a plain list with other names for the same things', () => {
    const { valid } = promptsFromJson([{ title: 'Greeting', prompt: 'Say hello.' }]);
    expect(valid[0]).toMatchObject({ name: 'Greeting', content: 'Say hello.', shortcut: '' });
  });

  it('turns a setting it does not know into none, and cleans a shortcut', () => {
    const { valid } = promptsFromJson({
      prompts: [{ name: 'A', content: 'x', strategy_type: 'Telepathy', shortcut: '"""Hi there' }],
    });
    expect(valid[0]?.strategy_type).toBeNull();
    expect(valid[0]?.shortcut).toBe('Hi_there');
  });

  it('writes the text from the blocks when the file has none', () => {
    const { valid } = promptsFromJson([
      { name: 'From blocks', blocks: [{ type: 'objective', content: 'Summarise it.', enabled: true }] },
    ]);
    expect(valid[0]?.content).toBe('## Objective\nSummarise it.');
  });

  it('drops a Brain link with no real id and keeps the block', () => {
    const { valid } = promptsFromJson([
      {
        name: 'With Brain',
        content: 'x',
        blocks: [
          { type: 'context', content: '', enabled: true, brain: { id: BRAIN_ID, name: 'Facts' } },
          { type: 'role', content: 'r', enabled: true, brain: { id: 'nope', name: 'Bad' } },
          { type: 'reasoning', content: 'retired', enabled: true },
        ],
      },
    ]);
    const blocks = valid[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.brain).toEqual({ id: BRAIN_ID, name: 'Facts' });
    expect(blocks[1]?.brain).toBeUndefined();
  });

  it('skips a prompt with no name or no text, and says how many', () => {
    const { valid, skipped } = promptsFromJson([
      { name: 'Fine', content: 'x' },
      { content: 'no name' },
      { name: 'No text' },
      'not an object',
    ]);
    expect(valid).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it('refuses a file with no prompts in it', () => {
    expect(() => promptsFromJson({ snippets: [] })).toThrow(/No prompts found/);
    expect(() => promptsFromJson({ prompts: [] })).toThrow(/No prompts found/);
  });
});

describe('Brain files', () => {
  const spaces = [
    { id: 's1', name: 'Company facts', description: 'What we are.' },
    { id: 's2', name: 'Empty one', description: '' },
  ];
  const items = [
    { space_id: 's1', name: 'Opening hours', summary: 'When we open.', body: 'Nine to five.', kind: 'fact' as const, pinned: true },
    { space_id: 's1', name: 'Tone', summary: '', body: 'Warm and plain.', kind: 'note' as const, pinned: false },
  ];

  it('round-trips Brains with their items', () => {
    const file = JSON.parse(JSON.stringify(buildBrainFile(spaces, items))) as unknown;
    const { valid, skipped } = brainsFromJson(file);
    expect(skipped).toBe(0);
    expect(valid.map((b) => [b.name, b.items.length])).toEqual([
      ['Company facts', 2],
      ['Empty one', 0],
    ]);
    expect(valid[0]?.items[0]).toEqual({
      name: 'Opening hours',
      summary: 'When we open.',
      body: 'Nine to five.',
      kind: 'fact',
      pinned: true,
    });
  });

  it('holds text only', () => {
    const entry = buildBrainFile(spaces, items).brains[0];
    expect(Object.keys(entry ?? {}).sort()).toEqual(['description', 'items', 'name']);
    expect(Object.keys(entry?.items[0] ?? {}).sort()).toEqual(['body', 'kind', 'name', 'pinned', 'summary']);
  });

  it('keeps within the limits a Brain holds', () => {
    const long = 'x'.repeat(300);
    const { valid, skipped } = brainsFromJson([
      {
        name: 'n'.repeat(80),
        description: long,
        items: [
          { name: 'Fits', summary: long, body: 'ok', kind: 'document' },
          { name: 'Too long', body: 'y'.repeat(20001) },
          { name: 'No text', body: '   ' },
          { body: 'No name' },
        ],
      },
      { description: 'No name here' },
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0]?.name).toHaveLength(64);
    expect(valid[0]?.description).toHaveLength(280);
    expect(valid[0]?.items).toHaveLength(1);
    expect(valid[0]?.items[0]).toMatchObject({ summary: 'x'.repeat(280), kind: 'fact' });
    expect(skipped).toBe(4);
  });

  it('refuses a file with no Brains in it', () => {
    expect(() => brainsFromJson({ prompts: [] })).toThrow(/No Brains found/);
  });
});

describe('snippet files (unchanged by the move)', () => {
  it('still reads a Text Blaze export', async () => {
    const file = new File(
      [JSON.stringify({ groups: [{ snippets: [{ name: 'Thanks', shortcut: '/thanks', snippet: 'Thank you.' }] }] })],
      'tb.json',
      { type: 'application/json' },
    );
    const { valid, skipped } = await parseImportFile(file);
    expect(skipped).toBe(0);
    expect(valid[0]).toMatchObject({ name: 'Thanks', trigger: 'thanks', content: 'Thank you.' });
  });

  it('still says a broken file is broken', async () => {
    await expect(parseImportFile(new File(['{nope'], 'bad.json'))).rejects.toThrow('Invalid JSON file');
  });
});

describe('where Import and export lives', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');

  it('keeps the three list pages free of Import and Export', () => {
    for (const page of ['SnippetsPage', 'PromptsPage', 'MemoryPage']) {
      const source = read(`routes/${page}.tsx`);
      expect(source).not.toMatch(/ImportExport|Import<|Export<|snippetIo|promptIo|brainIo/);
    }
  });

  it('puts the one card in Settings', () => {
    expect(read('routes/SettingsPage.tsx')).toContain('<ImportExportPanel />');
  });
});
