import { describe, expect, it } from 'vitest';
import { sortPrompts } from '@/lib/promptSort';
import { sortSpaces } from '@/lib/spaceSort';
import { nextSort } from '@/lib/sortToggle';
import type { MemorySpace, MemorySpaceTotals, Prompt } from '@/types/database';

// One sort rule across Snippets, Prompts and Brains: the same click does the
// same thing, and the pinned or default row never loses its place.

function prompt(over: Partial<Prompt>): Prompt {
  return {
    id: 'p',
    name: 'Prompt',
    pinned: false,
    updated_at: '2026-01-01T00:00:00Z',
    usage_count: 0,
    ...over,
  } as Prompt;
}

function space(over: Partial<MemorySpace>): MemorySpace {
  return {
    id: 's',
    name: 'Brain',
    is_default: false,
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as MemorySpace;
}

describe('nextSort', () => {
  it('flips the direction of the active column', () => {
    expect(nextSort({ sortBy: 'name', sortDir: 'asc' }, 'name')).toEqual({
      sortBy: 'name',
      sortDir: 'desc',
    });
    expect(nextSort({ sortBy: 'name', sortDir: 'desc' }, 'name').sortDir).toBe('asc');
  });

  it('starts a new column A to Z for names and biggest first for the rest', () => {
    expect(nextSort({ sortBy: 'updated_at', sortDir: 'desc' }, 'name')).toEqual({
      sortBy: 'name',
      sortDir: 'asc',
    });
    expect(nextSort({ sortBy: 'name', sortDir: 'asc' }, 'usage_count')).toEqual({
      sortBy: 'usage_count',
      sortDir: 'desc',
    });
  });
});

describe('sortPrompts', () => {
  const list = [
    prompt({ id: 'a', name: 'Beta', updated_at: '2026-03-01T00:00:00Z', usage_count: 2 }),
    prompt({ id: 'b', name: 'Alpha', updated_at: '2026-01-01T00:00:00Z', usage_count: 9 }),
    prompt({ id: 'c', name: 'Gamma', updated_at: '2026-02-01T00:00:00Z', usage_count: 5, pinned: true }),
  ];

  it('opens as it always did: pinned first, then most recently updated', () => {
    expect(sortPrompts(list, 'updated_at', 'desc').map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps pinned prompts on top for every column and direction', () => {
    expect(sortPrompts(list, 'name', 'asc').map((p) => p.id)).toEqual(['c', 'b', 'a']);
    expect(sortPrompts(list, 'name', 'desc').map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(sortPrompts(list, 'usage_count', 'desc').map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not change the list it is given', () => {
    const before = list.map((p) => p.id);
    sortPrompts(list, 'name', 'asc');
    expect(list.map((p) => p.id)).toEqual(before);
  });
});

describe('sortSpaces', () => {
  const totals = new Map<string, MemorySpaceTotals>([
    ['personal', { items: 0, tokens: 0 }],
    ['airbnb', { items: 2, tokens: 355 }],
    ['laws', { items: 2, tokens: 866 }],
    ['big', { items: 9, tokens: 10 }],
  ]);
  const list = [
    space({ id: 'laws', name: 'IBIZA LAWS', updated_at: '2026-02-01T00:00:00Z' }),
    space({ id: 'big', name: 'Big', updated_at: '2026-03-01T00:00:00Z' }),
    space({ id: 'personal', name: 'Personal', is_default: true, updated_at: '2026-01-01T00:00:00Z' }),
    space({ id: 'airbnb', name: 'AIRBNB', updated_at: '2026-02-01T00:00:00Z' }),
  ];

  it('opens as it always did: default Brain first, then A to Z', () => {
    expect(sortSpaces(list, totals, 'name', 'asc').map((s) => s.id)).toEqual([
      'personal',
      'airbnb',
      'big',
      'laws',
    ]);
  });

  it('reverses names without moving the default Brain', () => {
    expect(sortSpaces(list, totals, 'name', 'desc').map((s) => s.id)).toEqual([
      'personal',
      'laws',
      'big',
      'airbnb',
    ]);
  });

  it('orders by item count, ties by name', () => {
    expect(sortSpaces(list, totals, 'items', 'desc').map((s) => s.id)).toEqual([
      'personal',
      'big',
      'airbnb',
      'laws',
    ]);
  });

  it('orders by last update, ties by name', () => {
    expect(sortSpaces(list, totals, 'updated_at', 'desc').map((s) => s.id)).toEqual([
      'personal',
      'big',
      'airbnb',
      'laws',
    ]);
  });
});
