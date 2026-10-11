import { christmasLabel } from '@/lib/saintOfDay';
import { useDaysToChristmas } from '@/lib/useDaysToChristmas';

/**
 * "<N> days to Christmas" in the footer. Always shown, on purpose: it has no
 * Settings switch and never waits for the network. It does not shrink, so on a
 * tight footer the saint beside it is shortened first. The popup footer carries
 * the same line (extension/popup/popup.js, renderXmas).
 */
export function ChristmasCountdown() {
  const days = useDaysToChristmas();
  return <span className="shrink-0 font-mono text-[10px] text-ink-subtle">{christmasLabel(days)}</span>;
}
