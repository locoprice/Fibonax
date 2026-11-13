import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';

export type KeywordSize = 'sm' | 'md' | 'lg';

export interface Keyword {
  word: string;
  size: KeywordSize;
}

/** Font sizes step on the golden ratio through Fibonacci numbers: 13, 21, 34 px. */
const SIZE_CLASS: Record<KeywordSize, string> = {
  sm: 'text-[13px] font-medium text-ink-muted',
  md: 'text-[21px] font-semibold text-ink',
  lg: 'text-[34px] font-bold text-primary',
};

/** The golden angle, so the words spread evenly over the sphere. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RADIUS_PX = 180;
/** One full turn every 34 seconds (a Fibonacci number): slow enough to read. */
const TURN_MS = 34_000;
/** A fixed forward tilt so the turn reads as a globe, not a carousel. */
const TILT_RAD = 0.35;

interface Point {
  x: number;
  y: number;
  z: number;
}

/** Places n points on a unit sphere along a Fibonacci spiral. */
function fibonacciSphere(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - ((i + 0.5) * 2) / n;
    const ring = Math.sqrt(1 - y * y);
    const theta = i * GOLDEN_ANGLE;
    return { x: Math.cos(theta) * ring, y, z: Math.sin(theta) * ring };
  });
}

/** Turns a point by `angle` around the vertical axis, then applies the tilt. */
function placeStyle(p: Point, angle: number): { transform: string; opacity: string; zIndex: string } {
  const x = p.x * Math.cos(angle) + p.z * Math.sin(angle);
  const z1 = -p.x * Math.sin(angle) + p.z * Math.cos(angle);
  const y = p.y * Math.cos(TILT_RAD) - z1 * Math.sin(TILT_RAD);
  const z = p.y * Math.sin(TILT_RAD) + z1 * Math.cos(TILT_RAD);
  const depth = (z + 1) / 2; // 0 at the back, 1 at the front
  const scale = 0.62 + 0.38 * depth;
  return {
    transform: `translate(-50%, -50%) translate3d(${(x * RADIUS_PX).toFixed(1)}px, ${(y * RADIUS_PX).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`,
    opacity: (0.28 + 0.72 * depth).toFixed(3),
    zIndex: String(Math.round(depth * 100)),
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A word cloud laid on a sphere that turns slowly on itself. Visual only:
 * nothing is clickable. Motion is transform and opacity only, written straight
 * to the elements so React does not re-render each frame. Under
 * `prefers-reduced-motion` the sphere stays still in the same box.
 */
export function KeywordSphere({ words, label }: { words: ReadonlyArray<Keyword>; label: string }): ReactElement {
  const itemsRef = useRef<Array<HTMLLIElement | null>>([]);
  const points = useMemo(() => fibonacciSphere(words.length), [words.length]);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const angle = (((now - start) % TURN_MS) / TURN_MS) * Math.PI * 2;
      itemsRef.current.forEach((el, i) => {
        const p = points[i];
        if (!el || !p) return;
        Object.assign(el.style, placeStyle(p, angle));
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [points]);

  return (
    <ul aria-label={label} className="relative mt-8 aspect-[1.618/1] w-[700px] max-w-full">
      {words.map(({ word, size }, i) => {
        const p = points[i];
        return (
          <li
            key={word}
            ref={(el) => {
              itemsRef.current[i] = el;
            }}
            style={p ? placeStyle(p, 0) : undefined}
            className={`absolute left-1/2 top-1/2 whitespace-nowrap leading-tight will-change-transform ${SIZE_CLASS[size]}`}
          >
            {word}
          </li>
        );
      })}
    </ul>
  );
}
