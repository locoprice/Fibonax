import { describe, expect, it } from 'vitest';
import { DAYS_PER_LINE, FIRST_DAY, SIDEBAR_LINES, sidebarLineAt } from '@/lib/sidebarLine';

const DAY_MS = 86400000;

// Counted from FIRST_DAY, so a fresh list each month needs no change here.
const noonOn = (day: number): number => Date.parse(`${FIRST_DAY}T12:00:00Z`) + day * DAY_MS;

describe('sidebarLineAt', () => {
  it('changes every four days, for two years, across clock changes', () => {
    expect(DAYS_PER_LINE).toBe(4);
    for (let day = 0; day < 730; day++) {
      const expected = SIDEBAR_LINES[Math.floor(day / 4) % SIDEBAR_LINES.length];
      expect(sidebarLineAt(noonOn(day))).toBe(expected);
    }
  });

  it('changes at midnight in Rome, whatever the clock of the device', () => {
    // Rome is one or two hours ahead of UTC, so 21:00 UTC is still the same
    // day there and 23:30 UTC is already the next one, in summer and in winter.
    const fourthDay = new Date(noonOn(3)).toISOString().slice(0, 10);
    expect(sidebarLineAt(Date.parse(`${fourthDay}T21:00:00Z`))).toBe(SIDEBAR_LINES[0]);
    expect(sidebarLineAt(Date.parse(`${fourthDay}T23:30:00Z`))).toBe(SIDEBAR_LINES[1]);
  });

  it('still gives a sentence when the clock is set before the first day', () => {
    expect(SIDEBAR_LINES).toContain(sidebarLineAt(noonOn(-1000)));
  });
});

describe('SIDEBAR_LINES', () => {
  it('holds written sentences with no long dashes', () => {
    for (const line of SIDEBAR_LINES) {
      expect(line.text.trim()).not.toBe('');
      expect(line.text).not.toMatch(/[–—]/);
    }
  });
});
