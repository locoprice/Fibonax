import { useEffect, useState } from 'react';
import { currentVisit, recordVisit, showGettingStarted } from '@/lib/gettingStarted';

/**
 * Whether the sidebar still offers "Getting Started". The first paint already
 * knows this visit's number, so a row that is about to go never flashes in; the
 * effect then writes the visit down, once per page load.
 */
export function useGettingStartedVisible(userId: string | null): boolean {
  const [visit, setVisit] = useState(() => (userId === null ? 0 : currentVisit(userId)));
  useEffect(() => {
    if (userId !== null) setVisit(recordVisit(userId));
  }, [userId]);
  return showGettingStarted(visit);
}
