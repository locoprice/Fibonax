import rate from '@/config/fiboTokenRate.json';

/**
 * The FiboToken exchange rate, as the dashboard shows it.
 *
 * The numbers live in `src/config/fiboTokenRate.json`, the one file changed
 * when the rate moves (about every three months). After editing it, run
 * `node scripts/sync-fibotoken-rate.js` from the repository root: it copies
 * the rate into the phone page, the landing page and the pricing page, and
 * its `--check` fails CI when any of them disagree.
 *
 * The wording below is repeated on those pages; the same check pins the
 * disclaimer, so it cannot drift.
 */
export const FIBOTOKEN_RATE_TEXT = {
  title: 'FiboToken exchange rate',
  label: 'Current exchange rate',
  chip: 'Variable rate',
  disclaimer:
    'Like a currency, the FiboToken rate is variable: it can change over time and move with the market. A new rate applies to new packs only. FiboTokens you already own keep their value: one FiboToken, one use.',
  example: 'For example',
  setOn: 'Rate set on',
  pricing: 'See the packs',
} as const;

export const PRICING_URL = 'https://fibonax.com/pricing/';

export interface FiboTokenRateView {
  /** "€0.01" */
  rate: string;
  /** "1 FiboToken is worth €0.01", the full sentence for screen readers. */
  worth: string;
  /** "€25 = 2,500 FiboTokens" */
  example: string;
  /** "October 28, 2026", the day the rate was set. */
  setOnDate: string;
  /** Shown until the day packs go on sale, then null. */
  packsNote: string | null;
}

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function euroRate(value: number): string {
  return `€${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export function fiboTokenRateView(nowMs: number): FiboTokenRateView {
  const price = euroRate(rate.euroPerFiboToken);
  const tokens = Math.round(rate.exampleEuros / rate.euroPerFiboToken);
  const onSale = nowMs >= Date.parse(`${rate.packsFrom}T00:00:00+01:00`);
  return {
    rate: price,
    worth: `1 FiboToken is worth ${price}`,
    example: `€${rate.exampleEuros.toLocaleString('en-US')} = ${tokens.toLocaleString('en-US')} FiboTokens`,
    setOnDate: longDate(rate.rateSetOn),
    packsNote: onSale ? null : `FiboToken packs go on sale on ${longDate(rate.packsFrom)}.`,
  };
}
