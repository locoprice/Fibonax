import { afterEach, describe, expect, it, vi } from 'vitest';

// "Getting Started" in the sidebar: how many visits it stays for.
//
// The module remembers which visit this page load already counted, so each
// test reloads it to open the dashboard again, the way a new page load would.

function memoryStorage() {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (key: string): string | null =>
      Object.prototype.hasOwnProperty.call(data, key) ? (data[key] ?? null) : null,
    setItem: (key: string, value: string): void => {
      data[key] = String(value);
    },
  };
}

async function openDashboard() {
  vi.resetModules();
  return import('@/lib/gettingStarted');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Getting Started visits', () => {
  it('stays for the first six visits and goes on the seventh', async () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() });
    for (let expected = 1; expected <= 6; expected += 1) {
      const gettingStarted = await openDashboard();
      const visit = gettingStarted.recordVisit('ann');
      expect(visit).toBe(expected);
      expect(gettingStarted.showGettingStarted(visit)).toBe(true);
    }
    const gettingStarted = await openDashboard();
    const seventh = gettingStarted.recordVisit('ann');
    expect(seventh).toBe(7);
    expect(gettingStarted.showGettingStarted(seventh)).toBe(false);
  });

  it('counts a page load once, however often it is asked', async () => {
    const page = memoryStorage();
    vi.stubGlobal('window', { localStorage: page });
    const gettingStarted = await openDashboard();
    expect(gettingStarted.recordVisit('ann')).toBe(1);
    expect(gettingStarted.recordVisit('ann')).toBe(1);
    expect(page.data['sb_visits_ann']).toBe('1');
  });

  it('knows this visit before it is written down, and writes nothing to find out', async () => {
    const page = memoryStorage();
    page.setItem('sb_visits_ann', '6');
    vi.stubGlobal('window', { localStorage: page });
    const gettingStarted = await openDashboard();
    expect(gettingStarted.currentVisit('ann')).toBe(7);
    expect(page.data['sb_visits_ann']).toBe('6');
    expect(gettingStarted.recordVisit('ann')).toBe(7);
    expect(gettingStarted.currentVisit('ann')).toBe(7);
    expect(page.data['sb_visits_ann']).toBe('7');
  });

  it('keeps each account on its own count', async () => {
    const page = memoryStorage();
    page.setItem('sb_visits_ann', '9');
    vi.stubGlobal('window', { localStorage: page });
    const gettingStarted = await openDashboard();
    expect(gettingStarted.recordVisit('ben')).toBe(1);
    expect(gettingStarted.recordVisit('ann')).toBe(10);
  });

  it('starts again from a count that is damaged', async () => {
    for (const damaged of ['lots', '-3', '0', '']) {
      const page = memoryStorage();
      page.setItem('sb_visits_ann', damaged);
      vi.stubGlobal('window', { localStorage: page });
      const gettingStarted = await openDashboard();
      expect(gettingStarted.recordVisit('ann'), damaged).toBe(1);
    }
  });

  it('keeps the row when the browser blocks storage', async () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('window', { localStorage: blocked });
    for (let load = 0; load < 8; load += 1) {
      const gettingStarted = await openDashboard();
      const visit = gettingStarted.recordVisit('ann');
      expect(visit).toBe(1);
      expect(gettingStarted.showGettingStarted(visit)).toBe(true);
    }
  });

  it('counts the first visit where there is no browser at all', async () => {
    const gettingStarted = await openDashboard();
    expect(gettingStarted.currentVisit('ann')).toBe(1);
    expect(gettingStarted.recordVisit('ann')).toBe(1);
  });
});
