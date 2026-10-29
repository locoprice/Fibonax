import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A Brain inside a prompt (v3.103.0). The rule lives in
// extension/shared/memory-pack.js and is read by the extension, its popup
// and the phone; the dashboard writes the token and labels it with the three
// small twins in lib/promptBrain.ts, and loads the module for the rest. This
// suite holds the twins to the module, exercises the module's own resolution,
// and checks the assembler, the quality score and the Notion push read the
// token the same way.

vi.mock('@/lib/api/memoryApi', () => ({
  memoryApi: {
    listSpaces: vi.fn(),
    listItems: vi.fn(),
  },
}));

import { memoryApi } from '@/lib/api/memoryApi';
import {
  brainToken,
  brainTokenName,
  labelBrainTokens,
  promptBrainRefs,
  resolvePromptBrains,
  type SbMemoryPackApi,
} from '@/lib/promptBrain';
import { assembleBlocks } from '@/lib/promptUtils';
import { evaluatePrompt } from '@/lib/usePromptEvaluator';
import type { MemoryItem, MemorySpace, PromptBlock } from '@/types/database';

function read(...parts: string[]): string {
  return readFileSync(resolve(process.cwd(), '..', ...parts), 'utf8');
}

// memory-pack.js is UMD: given a CommonJS `module`, it fills module.exports.
function loadModule<T>(src: string): T {
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

const PACK_SRC = read('extension', 'shared', 'memory-pack.js');
const pack = loadModule<SbMemoryPackApi & { formatInjectedBlock: (p: { items: Array<{ name: string; text: string }> }) => string }>(PACK_SRC);

const ID = '0f3e9c3a-1234-4bcd-9ef0-123456789abc';
const OTHER = '7b2c1d0e-aaaa-4bbb-8ccc-ddddeeeeffff';
const TOKEN = `{brain: id=${ID}; name=Marketing}`;

const NAMES = [
  'Marketing',
  '  Marketing {rules}; v2\nline two  ',
  'x'.repeat(80),
  '',
];
const TEXTS = [
  `## Context\n${TOKEN}\n\nTyped text`,
  `${TOKEN} and again ${TOKEN}`,
  `{brain: id=${ID.toUpperCase()}}`,
  `{brain:id=${ID};name=Short}`,
  'no token here',
  `{brain: id=not-a-uuid; name=Nope}`,
];

describe('the dashboard twins match the module', () => {
  it('writes the same token', () => {
    for (const name of NAMES) {
      expect(brainToken({ id: ID, name })).toBe(pack.brainToken({ id: ID, name }));
    }
  });

  it('reads the same Brains out of a prompt', () => {
    for (const text of TEXTS) {
      expect(promptBrainRefs(text)).toEqual(pack.promptBrainRefs(text));
    }
  });

  it('labels a token the same way for a preview', () => {
    for (const text of TEXTS) {
      expect(labelBrainTokens(text)).toBe(pack.labelBrainTokens(text));
    }
  });

  it('keeps the Notion push on the same pattern', () => {
    const push = read('services', 'supabase', 'functions', 'notion-prompt-push', 'index.ts');
    const pattern = String.raw`/\{brain:\s*id=([0-9a-fA-F-]{36})\s*(?:;\s*name=([^}]*))?\}/g`;
    expect(push).toContain(pattern);
    expect(PACK_SRC).toContain(pattern);
  });
});

describe('the token', () => {
  it('carries the id and a one-line name without braces, at most 64 characters', () => {
    expect(brainTokenName('  Marketing {rules}; v2\nline two  ')).toBe('Marketing rules ; v2 line two');
    expect(brainTokenName('x'.repeat(80))).toHaveLength(64);
    expect(brainToken({ id: ID, name: 'Marketing' })).toBe(TOKEN);
    expect(brainToken({ id: ID, name: '' })).toBe(`{brain: id=${ID}}`);
  });

  it('is read once per Brain, in order, with the id in lower case', () => {
    expect(promptBrainRefs(`${TOKEN} ${TOKEN} {brain: id=${OTHER.toUpperCase()}; name=Legal}`)).toEqual([
      { id: ID, name: 'Marketing' },
      { id: OTHER, name: 'Legal' },
    ]);
    expect(promptBrainRefs('{brain: id=not-a-uuid; name=Nope}')).toEqual([]);
  });

  it('reads as the Brain\'s name in a preview', () => {
    expect(labelBrainTokens(`## Context\n${TOKEN}\n\nTyped`)).toBe('## Context\nBrain: Marketing\n\nTyped');
    expect(labelBrainTokens(`{brain: id=${ID}}`)).toBe('Brain');
  });
});

describe('the module finishes a prompt', () => {
  const items = [
    { name: 'Tone', body: 'Friendly.' },
    { name: 'Hours', body: '9 to 5' },
  ];

  const LEAD = 'Source material from "Marketing". Base your answer on it, and say so if something you need is not covered.';

  it('puts the Brain where the token sits, as Copy whole Brain hands it out, under a line naming it', () => {
    const block = pack.formatInjectedBlock({ items: items.map((it) => ({ name: it.name, text: it.body })) });
    expect(pack.formatBrainBlock(items)).toBe(block);
    expect(pack.brainLeadLine('Marketing')).toBe(LEAD);
    expect(pack.resolvePromptBrains(`## Context\n${TOKEN}\n\nTyped`, { [ID]: { name: 'Marketing', items } })).toBe(
      `## Context\n${LEAD}\n\n${block.replace(/\n$/, '')}\n\nTyped`,
    );
  });

  it('names the Brain by its live name in that line', () => {
    expect(pack.resolvePromptBrains(TOKEN, { [ID]: { name: 'Marketing 2026', items } })).toMatch(
      /^Source material from "Marketing 2026"\. /,
    );
    expect(pack.brainLeadLine('')).toBe('Source material. Base your answer on it, and say so if something you need is not covered.');
  });

  it('prefers the live name over the token\'s', () => {
    expect(pack.resolvePromptBrains(TOKEN, { [ID]: { name: 'Marketing 2026', items: [] } })).toBe(
      '[The Brain "Marketing 2026" is empty]',
    );
  });

  it('says so, in one visible line, when the Brain cannot be handed out', () => {
    expect(pack.resolvePromptBrains(TOKEN, {})).toBe('[The Brain "Marketing" is not available here]');
    expect(pack.resolvePromptBrains(TOKEN, {}, 'failed')).toBe('[The Brain "Marketing" could not be loaded]');
    expect(pack.resolvePromptBrains(TOKEN, { [ID]: { name: 'Marketing', reason: 'failed' } })).toBe(
      '[The Brain "Marketing" could not be loaded]',
    );
    expect(pack.resolvePromptBrains(`{brain: id=${ID}}`, {})).toBe('[A Brain is not available here]');
  });

  it('finds the Brain whatever the case of the id in the token', () => {
    expect(pack.resolvePromptBrains(`{brain: id=${ID.toUpperCase()}; name=M}`, { [ID]: { name: 'M', items } })).toContain('## Tone');
  });

  it('leaves the markers off when the text will sit inside a block of its own', () => {
    expect(pack.resolvePromptBrains(`## Context\n${TOKEN}`, { [ID]: { name: 'Marketing', items } }, 'missing', true)).toBe(
      `## Context\n${LEAD}\n\n## Tone\nFriendly.\n\n## Hours\n9 to 5`,
    );
  });

  it('leaves text without a token untouched', () => {
    expect(pack.resolvePromptBrains('plain', {})).toBe('plain');
  });
});

describe('assembleBlocks', () => {
  const blocks: PromptBlock[] = [
    { type: 'role', content: 'You are an editor.', enabled: true },
    { type: 'objective', content: 'Tighten this.', enabled: true },
    { type: 'context', content: '', enabled: true, brain: { id: ID, name: 'Marketing' } },
  ];

  it('writes the token for a Context block that carries a Brain and nothing else', () => {
    expect(assembleBlocks(blocks)).toBe(`## Role\nYou are an editor.\n\n## Objective\nTighten this.\n\n## Context\n${TOKEN}`);
  });

  it('puts the typed text after the token, with a blank line between', () => {
    const typed = blocks.map((b) => (b.type === 'context' ? { ...b, content: '  Our readers are new customers.  ' } : b));
    expect(assembleBlocks(typed)).toContain(`## Context\n${TOKEN}\n\nOur readers are new customers.`);
  });

  it('leaves a switched-off Context block out, Brain or not', () => {
    const off = blocks.map((b) => (b.type === 'context' ? { ...b, enabled: false } : b));
    expect(assembleBlocks(off)).not.toContain('Context');
  });

  it('ignores a Brain on any block but Context', () => {
    const stray: PromptBlock[] = [{ type: 'objective', content: 'Tighten this.', enabled: true, brain: { id: ID, name: 'Marketing' } }];
    expect(assembleBlocks(stray)).toBe('## Objective\nTighten this.');
    expect(assembleBlocks([{ type: 'examples', content: '', enabled: true, brain: { id: ID, name: 'M' } }])).toBe('');
  });

  it('is unchanged for a prompt without a Brain', () => {
    const plain = blocks.map((b) => (b.type === 'context' ? { ...b, brain: null, content: 'Some background.' } : b));
    expect(assembleBlocks(plain)).toBe('## Role\nYou are an editor.\n\n## Objective\nTighten this.\n\n## Context\nSome background.');
  });
});

describe('the quality score', () => {
  it('counts a Brain as context provided, with nothing typed', () => {
    const result = evaluatePrompt({
      blocks: [
        { type: 'objective', content: 'Write a short note.', enabled: true },
        { type: 'context', content: '', enabled: true, brain: { id: ID, name: 'Marketing' } },
      ],
      strategyType: null,
      preferredModel: null,
      outputType: null,
    });
    const context = result.criteria.find((c) => c.id === 'context');
    expect(context?.status).toBe('pass');
    expect(context?.rationale).toBe('A Brain provides the context.');
  });

  it('still fails an empty Context block without a Brain', () => {
    const result = evaluatePrompt({
      blocks: [{ type: 'context', content: '', enabled: true }],
      strategyType: null,
      preferredModel: null,
      outputType: null,
    });
    expect(result.criteria.find((c) => c.id === 'context')?.status).toBe('fail');
  });
});

describe('the dashboard reads the Brain', () => {
  const space = (id: string, name: string): MemorySpace => ({
    id, user_id: 'u1', name, description: '', ico: 'brain', is_default: false,
    created_at: '2026-10-29T00:00:00Z', updated_at: '2026-10-29T00:00:00Z', deleted_at: null,
  });
  const item = (name: string, body: string, extra: Partial<MemoryItem> = {}): MemoryItem => ({
    id: `item-${name}`, user_id: 'u1', space_id: ID, name, summary: '', body, kind: 'note', metadata: {},
    token_estimate: 1, pinned: false, priority: 0, content_hash: '', source_id: null,
    created_at: '2026-10-29T00:00:00Z', updated_at: '2026-10-29T00:00:00Z', deleted_at: null,
    review_status: 'approved', reviewed_by: null, reviewed_at: null, ...extra,
  });

  beforeEach(() => {
    (globalThis as { SBMemoryPack?: SbMemoryPackApi }).SBMemoryPack = pack;
    vi.mocked(memoryApi.listSpaces).mockReset();
    vi.mocked(memoryApi.listItems).mockReset();
  });

  it('hands out live items only, archived and trashed ones left out', async () => {
    vi.mocked(memoryApi.listSpaces).mockResolvedValue([space(ID, 'Marketing')]);
    vi.mocked(memoryApi.listItems).mockResolvedValue([
      item('Tone', 'Friendly.'),
      item('Old', 'Gone.', { review_status: 'archived' }),
      item('Binned', 'Gone too.', { deleted_at: '2026-10-29T00:00:00Z' }),
    ]);
    const resolved = await resolvePromptBrains(`## Context\n${TOKEN}`);
    expect(resolved.text).toContain('## Tone\nFriendly.');
    expect(resolved.text).not.toContain('Old');
    expect(resolved.text).not.toContain('Binned');
    expect(resolved.text).toContain('⟦ Fibonax context · 1 item ⟧');
    expect(resolved.text).toMatch(/^## Context\nSource material from "Marketing"\./);
    expect(resolved.unavailable).toEqual([]);
    expect(memoryApi.listItems).toHaveBeenCalledWith(ID);
  });

  it("names a Brain it cannot see as not available, without asking for its items", async () => {
    vi.mocked(memoryApi.listSpaces).mockResolvedValue([space(OTHER, 'Mine')]);
    const resolved = await resolvePromptBrains(TOKEN);
    expect(resolved.text).toBe('[The Brain "Marketing" is not available here]');
    expect(resolved.unavailable).toEqual([{ id: ID, name: 'Marketing', reason: 'missing' }]);
    expect(memoryApi.listItems).not.toHaveBeenCalled();
  });

  it('says a Brain is empty when it is', async () => {
    vi.mocked(memoryApi.listSpaces).mockResolvedValue([space(ID, 'Marketing')]);
    vi.mocked(memoryApi.listItems).mockResolvedValue([]);
    const resolved = await resolvePromptBrains(TOKEN);
    expect(resolved.text).toBe('[The Brain "Marketing" is empty]');
    expect(resolved.unavailable[0]?.reason).toBe('empty');
  });

  it('says the read failed rather than calling the Brain missing', async () => {
    vi.mocked(memoryApi.listSpaces).mockRejectedValue(new Error('offline'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolved = await resolvePromptBrains(TOKEN);
    spy.mockRestore();
    expect(resolved.text).toBe('[The Brain "Marketing" could not be loaded]');
    expect(resolved.unavailable[0]?.reason).toBe('failed');
  });

  it('leaves a prompt without a Brain alone, and asks for nothing', async () => {
    const resolved = await resolvePromptBrains('## Objective\nPlain.');
    expect(resolved).toEqual({ text: '## Objective\nPlain.', unavailable: [] });
    expect(memoryApi.listSpaces).not.toHaveBeenCalled();
  });
});
