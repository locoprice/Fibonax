import { useEffect, useRef, useState } from 'react';
import { createHumanCheck, type HumanCheck } from '@/lib/humanCheck';

/**
 * One bot check per page, shared by every form on it, so switching between
 * Email link, Password and Forgot password keeps the same widget.
 */
export function useHumanCheck(): HumanCheck {
  const [check] = useState(() => createHumanCheck());
  return check;
}

/**
 * Where Cloudflare draws its box on the rare visit it needs a click. Empty the
 * rest of the time. Render it once per page, outside the views that come and go.
 */
export function HumanCheckSlot({ check }: { check: HumanCheck }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    check.attach(container);
    return () => check.detach();
  }, [check]);

  return <div ref={ref} className="mt-4 flex w-full max-w-[400px] justify-center" />;
}
