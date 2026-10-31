import { cn } from '@/lib/utils';

interface SparklineProps {
  values: number[];
  className?: string;
}

/** Past this many points the line is folded into that many buckets, each the sum of its days. */
const MAX_POINTS = 30;

/** Sum long series into at most MAX_POINTS buckets, so a year reads as a line, not noise. */
export function bucketValues(values: number[]): number[] {
  if (values.length <= MAX_POINTS) return values;
  const size = Math.ceil(values.length / MAX_POINTS);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size).reduce((a, b) => a + b, 0));
  }
  return out;
}

/**
 * A small trend line, drawn in `currentColor` so the parent's text colour
 * picks the hue (`text-primary` for the brand line). Decorative: the number
 * beside it carries the value.
 */
export function Sparkline({ values: raw, className }: SparklineProps) {
  const values = bucketValues(raw);
  if (values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = 80 / Math.max(values.length - 1, 1);
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(2)},${(24 - ((v - min) / range) * 20 - 2).toFixed(2)}`)
    .join(' ');

  return (
    <svg
      viewBox="0 0 80 24"
      preserveAspectRatio="none"
      className={cn('h-6 w-20', className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
