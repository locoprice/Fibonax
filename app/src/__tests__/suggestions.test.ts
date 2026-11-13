import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIBRARY_BRAINS, LIBRARY_PROMPTS, LIBRARY_SNIPPETS } from '@/features/library/catalogue';
import { joinedName, joinPrompts, joinSnippets } from '@/lib/joinItems';
import type { UsageAnalyticsApi } from '@/lib/usageAnalytics';
import type { Prompt, PromptBlock, Snippet } from '@/types/database';

// The Suggestions on Analytics. scripts/check-usage-analytics.js pins what the
// engine notices; this suite pins what the dashboard does with it: every
// missing piece names a real starter library item, the engine's answer has the
// shape lib/usageAnalytics.ts types, and "Join into one" builds the item the
// editor opens with.
function loadShared<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

const UA = loadShared<UsageAnalyticsApi>(resolve(process.cwd(), '..', 'extension', 'shared', 'usage-analytics.js'));

function snippet(id: string, name: string, over: Partial<Snippet> = {}): Snippet {
  return {
    id,
    name,
    content: '',
    bodies: {},
    triggers: [id],
    folder_id: null,
    organization_id: null,
    language: 'EN',
    ...over,
  } as Snippet;
}

function prompt(id: string, name: string, blocks: PromptBlock[] | null, over: Partial<Prompt> = {}): Prompt {
  return {
    id,
    name,
    content: blocks ? '' : 'Plain prompt text.',
    blocks,
    folder_id: null,
    organization_id: null,
    ask_user_questions: false,
    ...over,
  } as Prompt;
}

describe('missing pieces', () => {
  it('each names a starter library item of its kind, under the same title', () => {
    const lists = { snippet: LIBRARY_SNIPPETS, prompt: LIBRARY_PROMPTS, brain: LIBRARY_BRAINS };
    for (const rule of UA.MISSING_RULES) {
      const item = lists[rule.kind].find((x) => x.id === rule.libraryId);
      expect(item, rule.key).toBeDefined();
      expect(item?.name, rule.key).toBe(rule.title);
    }
  });
});

describe('suggest()', () => {
  it('answers in the shape the page reads', () => {
    const now = new Date(2026, 10, 12, 12).getTime();
    const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
    const events = [9, 10, 11].flatMap((d) => [
      { snippet_id: 'a', created_at: at(d, 9, 0) },
      { snippet_id: 'b', created_at: at(d, 9, 2) },
    ]);
    const r = UA.suggest({
      now,
      events,
      promptEvents: [],
      snippets: [
        { id: 'a', title: 'Price reply', text: 'The price is 40 EUR.', langs: ['EN'] },
        { id: 'b', title: 'Payment details', text: 'Pay by bank transfer.', langs: ['EN'] },
      ],
      prompts: [],
      brains: [],
      dismissed: {},
    });
    expect(r.days).toBe(UA.SUGGEST_DAYS);
    expect(r.together).toEqual([
      {
        key: 'snippet:a>b',
        kind: 'snippet',
        ids: ['a', 'b'],
        titles: ['Price reply', 'Payment details'],
        count: 3,
        text: 'You used these one after the other 3 times in the last 90 days.',
      },
    ]);
    expect(r.missing[0]).toEqual({
      key: 'missing:terms',
      kind: 'snippet',
      libraryId: 'terms',
      title: 'Terms and conditions link',
      text: '2 of your snippets talk about prices or payments, but none links to your terms and conditions.',
    });
    expect(r.empty).toBe(false);
  });
});

describe('joinedName', () => {
  it('reads as a list and stays within the name limit', () => {
    expect(joinedName(['A'])).toBe('A');
    expect(joinedName(['A', 'B'])).toBe('A and B');
    expect(joinedName(['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinedName(['x'.repeat(60), 'y'.repeat(60)]).length).toBe(100);
  });
});

describe('joinSnippets', () => {
  it('puts the texts in order, in the first one’s language, with a free trigger', () => {
    const a = snippet('a', 'Price reply', { language: 'IT', bodies: { IT: 'Il prezzo.', EN: 'The price.' }, folder_id: 'f1' });
    const b = snippet('b', 'Payment details', { language: 'EN', content: 'Pay by card.', bodies: { EN: 'Pay by card.' } });
    const form = joinSnippets([a, b], ['price_reply_and_payment_details']);
    expect(form.name).toBe('Price reply and Payment details');
    expect(form.language).toBe('IT');
    expect(form.content).toBe('Il prezzo.\n\nPay by card.');
    expect(form.bodies).toEqual({ IT: 'Il prezzo.\n\nPay by card.' });
    expect(form.trigger).not.toBe('price_reply_and_payment_details');
    expect(form.trigger.startsWith('price_reply')).toBe(true);
    expect(form.folder_id).toBe('f1');
  });

  it('leaves a team folder for the person to choose', () => {
    const a = snippet('a', 'A', { content: 'One.', organization_id: 'org', folder_id: 'team' });
    expect(joinSnippets([a, snippet('b', 'B', { content: 'Two.' })], []).folder_id).toBeNull();
  });
});

describe('joinPrompts', () => {
  const summarise = prompt('p1', 'Summarise', [
    { type: 'role', content: 'You are an assistant.', enabled: true },
    { type: 'objective', content: 'Summarise the thread.', enabled: true },
    { type: 'context', content: '', enabled: true, brain: { id: 'b1', name: 'Company facts' } },
    { type: 'examples', content: '', enabled: false },
    { type: 'constraints', content: 'Keep it short.', enabled: true },
  ]);
  const actions = prompt('p2', 'Action list', [
    { type: 'role', content: 'You are a planner.', enabled: true },
    { type: 'objective', content: 'List the actions.', enabled: true },
    { type: 'context', content: 'Our team has five people.', enabled: true },
    { type: 'examples', content: '', enabled: false },
    { type: 'constraints', content: 'Keep it short.', enabled: true },
  ], { ask_user_questions: true });

  it('numbers each objective under its name and keeps the rest once', () => {
    const seed = joinPrompts([summarise, actions]);
    expect(seed.name).toBe('Summarise and Action list');
    expect(seed.blocks).toEqual([
      { type: 'role', content: 'You are an assistant.', enabled: true },
      {
        type: 'objective',
        content: 'Do these in order:\n\n1. Summarise: Summarise the thread.\n\n2. Action list: List the actions.',
        enabled: true,
      },
      { type: 'context', content: 'Our team has five people.', enabled: true, brain: { id: 'b1', name: 'Company facts' } },
      { type: 'examples', content: '', enabled: false },
      { type: 'constraints', content: 'Keep it short.', enabled: true },
    ]);
    expect(seed.ask_user_questions).toBe(true);
  });

  it('reads an older prompt without blocks as its objective', () => {
    const seed = joinPrompts([prompt('p3', 'Old one', null), actions]);
    expect(seed.blocks.find((b) => b.type === 'objective')?.content).toBe(
      'Do these in order:\n\n1. Old one: Plain prompt text.\n\n2. Action list: List the actions.',
    );
  });
});
