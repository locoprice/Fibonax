import { useEffect, useState } from 'react';
import { daysToChristmas } from '@/lib/saintOfDay';

/** Milliseconds from `now` to the next midnight on this device's clock. */
function untilNextMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

/**
 * Whole days to the next 25 December, kept right while the dashboard stays
 * open: it moves on at midnight, on this device's clock. No network, nothing
 * stored, nothing to switch off.
 */
export function useDaysToChristmas(): number {
  const [days, setDays] = useState<number>(() => daysToChristmas(Date.now()));

  useEffect(() => {
    let timer = 0;
    function schedule(): void {
      // A second past midnight, so the timer can never fire a hair early and
      // count the same day again.
      timer = window.setTimeout(() => {
        setDays(daysToChristmas(Date.now()));
        schedule();
      }, untilNextMidnight(new Date()) + 1000);
    }
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  return days;
}
