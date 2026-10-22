import { describe, expect, it } from 'vitest';
import { BODY_MAX, bodyUsage, kindOptions } from '@/features/memory/itemForm';

// The Brain item window: which kinds the menu lists, and when the size bar warns.

describe('kindOptions', () => {
  it('lists the kinds a person can write', () => {
    expect(kindOptions('fact')).toEqual(['fact', 'note', 'conversation']);
    expect(kindOptions('conversation')).toEqual(['fact', 'note', 'conversation']);
  });

  it('keeps a kind the window does not offer, so the menu shows what is saved', () => {
    expect(kindOptions('document')).toEqual(['fact', 'note', 'conversation', 'document']);
  });
});

describe('bodyUsage', () => {
  it('is empty for no text', () => {
    expect(bodyUsage(0)).toEqual({ percent: 0, tone: 'ok', over: 0 });
  });

  it('shows a sliver for a little text', () => {
    expect(bodyUsage(5).percent).toBe(1);
  });

  it('warns from 80 percent of the limit', () => {
    expect(bodyUsage(BODY_MAX * 0.79).tone).toBe('ok');
    expect(bodyUsage(BODY_MAX * 0.8).tone).toBe('warn');
    expect(bodyUsage(BODY_MAX).tone).toBe('warn');
    expect(bodyUsage(BODY_MAX).percent).toBe(100);
  });

  it('says how far past the limit the text is', () => {
    expect(bodyUsage(BODY_MAX + 40)).toEqual({ percent: 100, tone: 'over', over: 40 });
  });
});
