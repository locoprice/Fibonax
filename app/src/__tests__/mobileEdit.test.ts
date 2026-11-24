import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { brainToken } from '@/lib/promptBrain';
import { assembleBlocks, type AssemblableBlock } from '@/lib/promptUtils';

// The phone's edit window keeps its own copy of two rules, because the page
// cannot load the dashboard's code: how a prompt's text is built from its
// parts, and which pieces of a snippet's text are fields. These tests read
// that copy out of the page and hold it to the dashboard's.
const html = readFileSync(resolve(process.cwd(), 'public/mobile/index.html'), 'utf8');
const source = html.slice(html.indexOf('var EDIT_TOKEN='), html.indexOf('function renderEditFolderRow('));
const api = runInNewContext(
  source + ';({editAssembleBlocks, editRemovedChips, editWithout, editChipLabel, editPromptBlocks})',
  { SBMemoryPack: { brainToken }, document: {} },
) as {
  editAssembleBlocks: (blocks: AssemblableBlock[], ask: boolean, temperature?: number | string | null) => string;
  editRemovedChips: (before: string, after: string) => string[];
  editWithout: (list: string[], taken: string[]) => string[];
  editChipLabel: (raw: string) => string;
  editPromptBlocks: (prompt: { blocks: unknown }) => unknown;
};

const blocks: AssemblableBlock[] = [
  { type: 'role', content: 'You are an editor.', enabled: true },
  { type: 'objective', content: '  Fix typos.  ', enabled: true },
  { type: 'context', content: '', enabled: true, brain: { id: 'b-1', name: 'House style' } },
  { type: 'examples', content: 'Not sent.', enabled: false },
  { type: 'constraints', content: '', enabled: true },
];

describe('phone edit window', () => {
  it('builds a prompt from its parts as the dashboard does', () => {
    expect(api.editAssembleBlocks(blocks, false)).toBe(assembleBlocks(blocks));
    expect(api.editAssembleBlocks(blocks, true)).toBe(assembleBlocks(blocks, { askUserQuestions: true }));
    const typed = blocks.map((b) => (b.type === 'context' ? { ...b, content: 'Reply in English.' } : b));
    expect(api.editAssembleBlocks(typed, true)).toBe(assembleBlocks(typed, { askUserQuestions: true }));
    expect(api.editAssembleBlocks([{ type: 'role', content: ' ', enabled: true }], true)).toBe('');
  });

  it('adds the answer style of a temperature as the dashboard does', () => {
    for (const t of [0, 0.2, 0.3, 0.31, 0.5, 0.7, 0.9, 1.2, 2, null, -1, 2.5]) {
      expect(api.editAssembleBlocks(blocks, true, t)).toBe(assembleBlocks(blocks, { askUserQuestions: true, temperature: t }));
      expect(api.editAssembleBlocks(blocks, false, t)).toBe(assembleBlocks(blocks, { temperature: t }));
    }
    // A numeric column can arrive as text.
    expect(api.editAssembleBlocks(blocks, false, '0.9')).toBe(assembleBlocks(blocks, { temperature: 0.9 }));
    expect(api.editAssembleBlocks([{ type: 'role', content: ' ', enabled: true }], true, 0.5)).toBe('');
  });

  it('leaves a prompt with a part it does not know to the dashboard', () => {
    expect(api.editPromptBlocks({ blocks: null })).toBeNull();
    expect(api.editPromptBlocks({ blocks: [{ type: 'reasoning', content: 'x', enabled: true }] })).toBe(false);
    expect(api.editPromptBlocks({ blocks })).toBe(blocks);
  });

  it('names the fields a change to the text would take out', () => {
    const before = 'Hello {formtext: name=CUSTOMER}, total {=PRICE*QTY}. {if: QTY>1}Thanks.{endif}';
    expect(Array.from(api.editRemovedChips(before, before + ' Bye.'))).toEqual([]);
    const gone = Array.from(api.editRemovedChips(before, 'Hello, total {=PRICE*QTY}. {if: QTY>1}Thanks.{endif}'));
    expect(gone).toEqual(['{formtext: name=CUSTOMER}']);
    expect(gone.map(api.editChipLabel)).toEqual(['Customer']);
    expect(Array.from(api.editRemovedChips('{=A} and {=A}', '{=A}'))).toEqual(['{=A}']);
    // One left out on purpose is not asked about again; a second one still is.
    expect(Array.from(api.editWithout(['{=A}', '{=B}', '{=A}'], ['{=A}']))).toEqual(['{=B}', '{=A}']);
  });

  it('labels a chip with the field name, else with what it is', () => {
    expect(api.editChipLabel('{formdate: name=START_DATE; default=today}')).toBe('Start date');
    expect(api.editChipLabel('{formmenu: one; two}')).toBe('Choice');
    expect(api.editChipLabel('{= PRICE * 2 }')).toBe('Formula');
    expect(api.editChipLabel('{endif}')).toBe('End of rule');
  });
});
