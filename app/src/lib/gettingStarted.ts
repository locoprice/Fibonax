/**
 * How long the sidebar offers "Getting Started".
 *
 * A visit is one opening of the dashboard in this browser. It is counted per
 * account and at most once per page load, so a second pass of an effect or a
 * remount never adds one. The row is on offer for the first six visits and then
 * goes: by then the person knows the app, and the row is only noise. The count
 * lives on this device, so another browser starts its own.
 *
 * Storage that is blocked counts nothing, and with nothing counted the row
 * stays, which is how the sidebar behaved before visits were counted.
 */

export const GETTING_STARTED_VISITS = 6;

const VISITS_KEY_PREFIX = 'sb_visits_';

/** This page load's visit number per account, once it has been counted. */
const counted = new Map<string, number>();

// Without a browser (the test runner, a build) there is no storage to read or
// write, which is the normal case there.
const hasBrowser = (): boolean => typeof window !== 'undefined';

/** Visits stored for this account on this device: 0 when none or unreadable. */
function storedVisits(userId: string): number {
  if (!hasBrowser()) return 0;
  try {
    const stored = Number.parseInt(
      window.localStorage.getItem(VISITS_KEY_PREFIX + userId) ?? '',
      10,
    );
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch {
    // Storage blocked: nothing is counted and the row stays.
    return 0;
  }
}

/** The number this page load's visit has, or will have once it is counted. */
export function currentVisit(userId: string): number {
  return counted.get(userId) ?? storedVisits(userId) + 1;
}

/** Counts this page load's visit, once, and returns its number. */
export function recordVisit(userId: string): number {
  const known = counted.get(userId);
  if (known !== undefined) return known;
  const visit = storedVisits(userId) + 1;
  counted.set(userId, visit);
  if (hasBrowser()) {
    try {
      window.localStorage.setItem(VISITS_KEY_PREFIX + userId, String(visit));
    } catch {
      // Storage blocked: see storedVisits.
    }
  }
  return visit;
}

/** True while this visit number still gets the row. */
export function showGettingStarted(visit: number): boolean {
  return visit <= GETTING_STARTED_VISITS;
}
