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

/**
 * The heading of a group inside a Team page card: a department, the
 * invitations sent, one side of the shared folders. The same line everywhere,
 * so the cards read as one page. `ownWords` marks a name a person typed (a
 * department), which the page translator must leave alone.
 */
export function GroupHeading({
  id,
  title,
  count,
  ownWords = false,
}: {
  id?: string;
  title: string;
  count: number;
  ownWords?: boolean;
}) {
  return (
    <h3 id={id} className="px-5 pt-4 text-[13px] font-semibold text-ink">
      {ownWords ? <span translate="no">{`${title} `}</span> : `${title} `}
      <span className="font-normal text-ink-subtle">· {count}</span>
    </h3>
  );
}

/**
 * The tile grid of the Team page: as many columns as fit the card, so the
 * same grid serves a wide page, a narrow one and a card sitting in a column.
 */
export const TEAM_TILE_GRID = 'grid gap-3 px-5';

/** One tile in that grid: a person or a shared folder. */
export const TEAM_TILE = 'min-w-0 rounded-[12px] border border-line p-3';
