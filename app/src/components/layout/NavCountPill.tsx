import { useEffect, useState } from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The number beside a sidebar row: one component for Snippets, Prompts, Brains,
 * Team and Review, so every count looks and moves the same way. Its values are
 * registered in docs/DESIGN_SYSTEM.md (Count pill).
 *
 * Each digit is a strip of 0 to 9 behind a window one line tall, and a number
 * changes by sliding the strip. Like every motion in the dashboard it is
 * transform and opacity only, so frames stay on the compositor, and each part
 * is dropped under `prefers-reduced-motion`: the number then simply shows, in
 * the same box.
 */

// One line of the pill's text, in pixels. The window and every cell share it,
// so the strip moves in whole cells and the digits stay crisp.
const DIGIT_HEIGHT = 14;
// Each digit starts this much after the one on its left: a cascade, not a jump.
const DIGIT_STAGGER_MS = 45;
// The longest a number waits at zero before it shows its real digits.
const SETTLE_MS = 300;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** `value` as sliding digits. They roll up from zero when the pill first appears. */
function RollingNumber({ value }: { value: number }) {
  // With reduced motion the number is there from the first frame, nothing rolls.
  const [rolled, setRolled] = useState(prefersReducedMotion);

  useEffect(() => {
    // Two frames: the first paints the zeros, the second starts the slide. One
    // frame can fire before that paint, and the slide would never be seen.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setRolled(true));
    });
    // A page that is not on screen draws no frames, and the number must be
    // right whenever it is looked at, so a timer settles it too.
    const settle = window.setTimeout(() => setRolled(true), SETTLE_MS);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearTimeout(settle);
    };
  }, []);

  const digits = String(value).split('').map(Number);
  return (
    <span aria-hidden="true" className="flex">
      {digits.map((digit, place) => (
        // Keyed from the right, so the units digit is the same strip whether
        // the number has one digit or four.
        <span
          key={digits.length - place}
          className="block w-[1ch] overflow-x-visible overflow-y-clip"
          style={{ height: DIGIT_HEIGHT }}
        >
          <span
            className="flex flex-col transition-transform duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{
              transform: `translateY(${rolled ? -digit * DIGIT_HEIGHT : 0}px)`,
              transitionDelay: `${place * DIGIT_STAGGER_MS}ms`,
            }}
          >
            {/* The digit is drawn by CSS, not written as text, so the strip adds
                nothing to a copy, a search or a read of the page. */}
            {DIGITS.map((d) => (
              <span
                key={d}
                data-digit={d}
                className="block text-center before:content-[attr(data-digit)]"
                style={{ height: DIGIT_HEIGHT, lineHeight: `${DIGIT_HEIGHT}px` }}
              />
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

interface NavCountPillProps {
  count: number;
  /** True on the row of the page in view. */
  active: boolean;
  /**
   * What the count stands for: the hover label, and what screen readers say in
   * place of the bare digits. Left out where the row name already says it.
   */
  label?: string;
}

/** An azure pill with a glow on the page in view, a quiet white one elsewhere. */
export function NavCountPill({ count, active, label }: NavCountPillProps) {
  const className = cn(
    'relative ml-auto inline-flex h-5 min-w-[20px] items-center justify-center overflow-hidden rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
    'animate-fade-in transition-[color,box-shadow] duration-200 motion-reduce:animate-none',
    active
      ? 'bg-gradient-to-b from-primary to-primary-dark text-white shadow-pill'
      : 'bg-card text-ink-subtle ring-1 ring-inset ring-line group-hover:text-primary group-hover:ring-primary/40',
  );
  const content = (
    <>
      <RollingNumber value={count} />
      <span className="sr-only">{label ?? count}</span>
      {/* Mounts when the row becomes current, so the band of light crosses the
          pill each time the person arrives on its page. */}
      {active && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-1/2 animate-count-sheen bg-gradient-to-r from-transparent via-white/45 to-transparent motion-reduce:hidden"
        />
      )}
    </>
  );
  if (label === undefined) return <span className={className}>{content}</span>;
  return (
    <Tooltip label={label} placement="right" className={className}>
      {content}
    </Tooltip>
  );
}
