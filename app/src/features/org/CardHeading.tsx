import type { ReactNode } from 'react';

/**
 * The heading row of every card on the Team page: the title, a muted detail
 * after a dot (a count, a period), and an optional action on the right.
 */
export function CardHeading({
  id,
  title,
  detail,
  action,
}: {
  id: string;
  title: string;
  detail: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      <h2 id={id} className="text-sm font-semibold text-ink">
        {title} <span className="font-normal text-ink-subtle">· {detail}</span>
      </h2>
      {action}
    </header>
  );
}
