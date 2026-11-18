import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// The Fibonax T, the same picture the extension, the phone and the landing
// page show. Drawn as a mask in the text colour, so it reads in light and dark.
const T_MASK = 'url(/landing/leib-tour-icon.png) center / contain no-repeat';
const MASK_STYLE: CSSProperties = { WebkitMask: T_MASK, mask: T_MASK };

interface BrandMarkProps {
  /** Size, e.g. `h-7 w-7`. */
  className?: string;
}

/** Decorative: the "Fibonax" wordmark always sits beside it. */
export function BrandMark({ className }: BrandMarkProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={MASK_STYLE}
      className={cn('block shrink-0 bg-current text-ink', className)}
    />
  );
}
