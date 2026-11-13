/**
 * The short sentence above the user's name in the open sidebar.
 *
 * One sentence holds for DAYS_PER_LINE days, then the next one takes over, and
 * the list starts again after the last. Counted from the date in Rome, the
 * product's home time, so everyone sees the same sentence on the same day and
 * nothing is stored.
 *
 * Valentina refreshes the list every month. A fresh list replaces SIDEBAR_LINES
 * and sets FIRST_DAY to the day it starts, so it opens on its first sentence.
 */
import { romeDay } from '@/lib/saintOfDay';

export interface SidebarLine {
  text: string;
  /** Who said it or where it comes from, when there is someone to credit. */
  source?: string;
}

export const DAYS_PER_LINE = 4;

/** The day the first sentence in the list started, in Rome. */
export const FIRST_DAY = '2026-11-08';
const DAY_MS = 24 * 60 * 60 * 1000;

export const SIDEBAR_LINES: readonly [SidebarLine, ...SidebarLine[]] = [
  { text: 'Talent wins games, but teamwork and intelligence win championships.', source: 'Michael Jordan' },
  { text: 'Give an account of thy stewardship, for thou mayest be no longer steward.', source: 'Luke 16:2' },
  { text: 'The best way to predict the future is to create it.', source: 'Peter Drucker' },
  {
    text: 'The biggest risk is not taking any risk… in a world that is changing really quickly, the only strategy that is guaranteed to fail is not taking any risks.',
    source: 'Mark Zuckerberg',
  },
  { text: 'Play by the rules, but be ferocious.', source: 'Phil Knight, Founder of Nike' },
  { text: 'Whatsoever ye do, do it heartily.', source: 'Colossians 3:23' },
  { text: 'Whatsoever thy hand findeth to do, do it with thy might.', source: 'Ecclesiastes 9:10' },
  { text: 'He that is faithful in that which is least is faithful also in much.', source: 'Luke 16:10' },
  { text: 'Seest thou a man diligent in his business? He shall stand before kings.', source: 'Proverbs 22:29' },
  { text: 'Let us not be weary in well doing: for in due season we shall reap, if we faint not.', source: 'Galatians 6:9' },
  { text: 'Commit thy works unto the Lord, and thy thoughts shall be established.', source: 'Proverbs 16:3' },
  { text: 'Be strong and of a good courage.', source: 'Joshua 1:9' },
  { text: 'Be ye strong therefore, and let not your hands be weak: for your work shall be rewarded.', source: '2 Chronicles 15:7' },
  { text: 'Well done, thou good and faithful servant.', source: 'Matthew 25:21' },
  { text: 'I press toward the mark.', source: 'Philippians 3:14' },
  { text: 'The hand of the diligent maketh rich.', source: 'Proverbs 10:4' },
];

/** The sentence for this moment. A clock set before FIRST_DAY still gets one. */
export function sidebarLineAt(nowMs: number): SidebarLine {
  const days = Math.round((Date.parse(romeDay(nowMs)) - Date.parse(FIRST_DAY)) / DAY_MS);
  const count = SIDEBAR_LINES.length;
  const index = ((Math.floor(days / DAYS_PER_LINE) % count) + count) % count;
  return SIDEBAR_LINES[index] ?? SIDEBAR_LINES[0];
}
