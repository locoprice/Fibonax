import { useEffect, useState } from 'react';
import { sidebarLineAt } from '@/lib/sidebarLine';

const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * The rotating sentence above the user's name. Looks again every hour, so a
 * dashboard left open moves on to the next sentence by itself. Sidebar decides
 * whether it fits, so the user block always stays on screen.
 */
export function SidebarLine() {
  const [line, setLine] = useState(() => sidebarLineAt(Date.now()));

  useEffect(() => {
    const timer = window.setInterval(() => setLine(sidebarLineAt(Date.now())), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <figure className="w-full shrink-0 px-6 pb-3 text-[11px] leading-snug text-ink-subtle">
      <blockquote className="italic">{line.text}</blockquote>
      {line.source && <figcaption className="mt-1">{line.source}</figcaption>}
    </figure>
  );
}
