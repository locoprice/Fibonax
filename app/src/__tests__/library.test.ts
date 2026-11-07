// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SbFillFormViewModel } from '@/lib/fillFormEngine';
import { promptFormSchema, snippetFormSchema } from '@/types/schemas';
import {
  LIBRARY_BRAINS,
  LIBRARY_PROMPTS,
  LIBRARY_SNIPPETS,
  PROMPT_TOPICS,
  SNIPPET_TOPICS,
  type LibrarySnippet,
} from '@/features/library/catalogue';
import {
  planBrains,
  planPrompts,
  planSnippets,
  promptForm,
  snippetForm,
} from '@/features/library/addFromLibrary';

// The starter library ships fixed content to every account. Each snippet is
// filled here with its own example through the shipping fill form, the file
// the overlay, the popup and the preview run, so what a person adds is what
// this checks.

interface FillApi {
  fillForm: (text: string, values: Record<string, string>, opts: Record<string, unknown>) => SbFillFormViewModel;
}
interface Engine {
  validateTemplate: (body: string) => { ok: boolean; code: string | null };
}

const NOW = new Date(2026, 10, 6, 9, 15);
let api: FillApi;
let engine: Engine;

beforeAll(() => {
  const ext = resolve(process.cwd(), '..', 'extension');
  new Function(readFileSync(resolve(ext, 'formula-engine.js'), 'utf8'))();
  new Function(readFileSync(resolve(ext, 'shared', 'fill-form.js'), 'utf8'))();
  const globals = window as unknown as { SBFillForm: FillApi; SBFormulaEngine: Engine };
  api = globals.SBFillForm;
  engine = globals.SBFormulaEngine;
});

function filled(item: LibrarySnippet): SbFillFormViewModel {
  return api.fillForm(item.body, item.example, { now: NOW, lang: 'EN' });
}

function byId(id: string): LibrarySnippet {
  const item = LIBRARY_SNIPPETS.find((s) => s.id === id);
  if (!item) throw new Error(`no library snippet ${id}`);
  return item;
}

describe('library snippets', () => {
  it('ships 24, each in a known topic, with unique ids and triggers', () => {
    expect(LIBRARY_SNIPPETS).toHaveLength(24);
    const topics = new Set(SNIPPET_TOPICS.map((t) => t.id));
    for (const s of LIBRARY_SNIPPETS) expect(topics.has(s.topic), s.id).toBe(true);
    expect(new Set(LIBRARY_SNIPPETS.map((s) => s.id)).size).toBe(24);
    expect(new Set(LIBRARY_SNIPPETS.map((s) => s.trigger)).size).toBe(24);
  });

  it.each(LIBRARY_SNIPPETS.map((s) => [s.id, s] as const))('%s saves as a valid snippet', (_id, s) => {
    expect(snippetFormSchema.safeParse(snippetForm(s, null)).success).toBe(true);
    expect(engine.validateTemplate(s.body).ok).toBe(true);
  });

  it.each(LIBRARY_SNIPPETS.map((s) => [s.id, s] as const))('%s fills completely from its example', (_id, s) => {
    const vm = filled(s);
    const keys = vm.fields.map((f) => f.key).sort();
    // Every field has an example answer, and the example names no field the body lacks.
    expect(Object.keys(s.example).sort()).toEqual(keys);
    // A text or number box is titled by its label, so the form never shows a
    // bare key. Dates and choices take no label: they are titled by the words
    // before them or by their name.
    for (const f of vm.fields) {
      if (f.type === 'text' || f.type === 'number') expect(f.label, `${s.id} ${f.key}`).not.toBe('');
    }
    expect(vm.errors).toEqual([]);
    expect(vm.preview).not.toMatch(/[{}]|…|undefined|NaN/);
  });

  it('works out the totals', () => {
    expect(filled(byId('quote')).preview).toContain('Total: 900 EUR');
    const deposit = filled(byId('deposit')).preview;
    expect(deposit).toContain('Deposit now: 360 EUR');
    expect(deposit).toContain('840 EUR');
    expect(filled(byId('newprice')).preview).toContain('a change of 10%');
    expect(filled(byId('leave')).preview).toContain('4 days in total');
  });

  it('prints a choice-driven line only when chosen', () => {
    const delay = byId('delay');
    expect(filled(delay).preview).toContain('10% off your next order');
    expect(api.fillForm(delay.body, { ...delay.example, OFFER: 'No' }, { now: NOW }).preview).not.toContain('10% off');
    // Unanswered, the offer stays out: its menu opens on No.
    expect(api.fillForm(delay.body, {}, { now: NOW }).preview).not.toContain('10% off');
    const overdue = byId('overdue');
    expect(api.fillForm(overdue.body, { ...overdue.example, TONE: 'Firm' }, { now: NOW }).preview).toContain('within 7 days');
  });

  it('asks for a repeated name once and prints it every time', () => {
    const welcome = filled(byId('welcome'));
    expect(welcome.fields.filter((f) => f.key === 'NEWCOMER')).toHaveLength(1);
    expect(welcome.preview.match(/Sara Bianchi/g)).toHaveLength(2);
  });
});

describe('library prompts', () => {
  it('ships 12 in known topics with unique shortcuts', () => {
    expect(LIBRARY_PROMPTS).toHaveLength(12);
    const topics = new Set(PROMPT_TOPICS.map((t) => t.id));
    for (const p of LIBRARY_PROMPTS) expect(topics.has(p.topic), p.id).toBe(true);
    expect(new Set(LIBRARY_PROMPTS.map((p) => p.shortcut)).size).toBe(12);
  });

  it.each(LIBRARY_PROMPTS.map((p) => [p.id, p] as const))('%s saves as a valid prompt', (_id, p) => {
    const form = promptForm(p, null);
    expect(promptFormSchema.safeParse(form).success).toBe(true);
    expect(form.content).toContain(`## Role\n${p.role}`);
    expect(form.content).toContain('## Questions');
    expect(form.content.includes('## Context')).toBe(p.context !== '');
  });
});

describe('library Brains', () => {
  it('ships 3 outlines with named items', () => {
    expect(LIBRARY_BRAINS.map((b) => b.name)).toEqual(['Company facts', 'Tone of voice', 'Common questions']);
    for (const b of LIBRARY_BRAINS) {
      expect(b.items.length).toBeGreaterThan(0);
      expect(new Set(b.items.map((i) => i.name)).size).toBe(b.items.length);
    }
  });
});

describe('adding from the library', () => {
  const thanks = byId('thanks');
  const quote = byId('quote');

  it('skips a snippet already there and numbers a taken trigger', () => {
    const plan = planSnippets([thanks, quote], [
      { name: thanks.name, content: thanks.body, triggers: ['thanks'] },
      { name: 'My own quote', content: 'Hello', triggers: ['quote'] },
    ]);
    expect(plan.skipped).toBe(1);
    expect(plan.toAdd.map((s) => s.trigger)).toEqual(['quote_2']);
  });

  it('never gives two picks the same trigger', () => {
    const plan = planSnippets([quote, { ...quote, id: 'copy', name: 'Another' }], []);
    expect(plan.toAdd.map((s) => s.trigger)).toEqual(['quote', 'quote_2']);
  });

  it('skips a prompt already there and numbers a taken shortcut', () => {
    const reply = LIBRARY_PROMPTS.find((p) => p.id === 'reply');
    const complaint = LIBRARY_PROMPTS.find((p) => p.id === 'complaint');
    if (!reply || !complaint) throw new Error('library prompts missing');
    const plan = planPrompts([reply, complaint], [
      { name: reply.name, content: promptForm(reply, null).content, shortcut: 'reply' },
      { name: 'Mine', content: 'x', shortcut: 'complaint' },
    ]);
    expect(plan.skipped).toBe(1);
    expect(plan.toAdd.map((p) => p.shortcut)).toEqual(['complaint_2']);
  });

  it('skips a Brain whose name is taken, whatever the capitals', () => {
    const plan = planBrains(LIBRARY_BRAINS, ['tone of VOICE']);
    expect(plan.skipped).toBe(1);
    expect(plan.toAdd.map((b) => b.name)).toEqual(['Company facts', 'Common questions']);
  });
});
