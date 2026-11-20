import { useEffect, useRef, useState } from 'react';
import { createHumanCheck, type HumanCheck } from '@/lib/humanCheck';
import { cn } from '@/lib/utils';

/**
 * One bot check per page, shared by every form on it. Each form draws it under
 * its own button, so switching between Email link, Password and Forgot password
 * draws it again there.
 */
export function useHumanCheck(): HumanCheck {
  const [check] = useState(() => createHumanCheck());
  return check;
}

/**
 * Where Cloudflare draws its box on the rare visit it needs a click: right under
 * the button the person just pressed. Place it straight after that button.
 */
export function HumanCheckSlot({ check }: { check: HumanCheck }) {
  const ref = useRef<HTMLDivElement>(null);
  const [needsClick, setNeedsClick] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    check.attach(container, () => setNeedsClick(true));
    return () => check.detach();
  }, [check]);

  // The forms space their rows apart; the slot takes no room until the box shows.
  return <div ref={ref} className={cn('flex w-full justify-center', !needsClick && '!mt-0')} />;
}
