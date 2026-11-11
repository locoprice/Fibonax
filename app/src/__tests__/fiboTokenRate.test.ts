import { describe, expect, it } from 'vitest';
import rate from '@/config/fiboTokenRate.json';
import { FIBOTOKEN_RATE_TEXT, fiboTokenRateView } from '@/lib/fiboTokenRate';

const dayBefore = Date.parse(`${rate.packsFrom}T00:00:00+01:00`) - 1;
const dayOf = Date.parse(`${rate.packsFrom}T00:00:00+01:00`);

describe('fiboTokenRateView', () => {
  it('writes the rate, the example and the date from the rate file', () => {
    const view = fiboTokenRateView(dayBefore);
    expect(view.rate).toMatch(/^€\d+\.\d{2,4}$/);
    expect(view.worth).toBe(`1 FiboToken is worth ${view.rate}`);
    expect(view.setOnDate).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    const [, euros, tokens] = /^€([\d,]+) = ([\d,]+) FiboTokens$/.exec(view.example) ?? [];
    expect(Number(euros?.replace(/,/g, ''))).toBe(rate.exampleEuros);
    expect(Number(tokens?.replace(/,/g, '')) * rate.euroPerFiboToken).toBeCloseTo(rate.exampleEuros, 9);
  });

  it('gives a whole number of FiboTokens for the example', () => {
    expect(Number.isInteger(Math.round((rate.exampleEuros / rate.euroPerFiboToken) * 1e6) / 1e6)).toBe(true);
  });

  it('says when packs go on sale, until that day in Italy', () => {
    expect(fiboTokenRateView(dayBefore).packsNote).toMatch(/^FiboToken packs go on sale on .+\.$/);
    expect(fiboTokenRateView(dayOf).packsNote).toBeNull();
  });
});

describe('FIBOTOKEN_RATE_TEXT', () => {
  it('holds written wording with no long dashes', () => {
    for (const text of Object.values(FIBOTOKEN_RATE_TEXT)) {
      expect(text.trim()).not.toBe('');
      expect(text).not.toMatch(/[–—]/);
    }
  });
});
