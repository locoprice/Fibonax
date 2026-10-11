import { afterEach, describe, expect, it, vi } from 'vitest';
import cases from '../../../scripts/saint-cases.json';
import {
  SAINT_CACHE_KEY,
  SAINT_ENABLED_KEY,
  christmasLabel,
  cleanSaintName,
  daysToChristmas,
  isSaintFresh,
  isSaintOn,
  loadSaintCache,
  loadSaintEnabled,
  makeSaintEntry,
  readSaintEntry,
  readSaintResponse,
  romeDay,
  saintLabel,
  saveSaintCache,
  saveSaintEnabled,
} from '@/lib/saintOfDay';

// Santo del Giorno and the Christmas countdown: the dashboard copy.
//
// The popup runs extension/shared/saint-of-day.js. Both are run over the same
// case table (scripts/saint-cases.json) here and in scripts/check-saint-of-day.js,
// so a rule changed in one place fails until it is changed in the other.

type FreshRow = {
  name: string;
  entry?: Record<string, unknown>;
  entryRaw?: unknown;
  nowIso: string;
  fresh: boolean;
};

function entryOf(row: FreshRow): unknown {
  if ('entryRaw' in row) return row.entryRaw;
  const e: Record<string, unknown> = { ...row.entry };
  if (typeof e.fetchedAtIso === 'string') {
    e.fetchedAt = Date.parse(e.fetchedAtIso);
    delete e.fetchedAtIso;
  }
  return e;
}

function memoryStorage(): { data: Record<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? (data[k] ?? null) : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the shared rules, over the shared cases', () => {
  it('is on until switched off', () => {
    for (const [input, expected] of cases.isOn) expect(isSaintOn(input)).toBe(expected);
  });

  it('cleans names the same way', () => {
    for (const [input, expected] of cases.cleanName) expect(cleanSaintName(input)).toBe(expected);
  });

  it('reads the server answer the same way', () => {
    for (const [input, expected] of cases.readResponse) expect(readSaintResponse(input)).toEqual(expected);
  });

  it('names the day in Rome', () => {
    for (const [iso, expected] of cases.romeDay) expect(romeDay(Date.parse(iso as string))).toBe(expected);
  });

  it('keeps a saint only for the same day in Rome and under 24 hours', () => {
    for (const row of cases.fresh as FreshRow[]) {
      expect(isSaintFresh(entryOf(row), Date.parse(row.nowIso)), row.name).toBe(row.fresh);
    }
  });

  it('writes the label', () => {
    for (const [name, expected] of cases.label) expect(saintLabel(name as string)).toBe(expected);
  });

  it('counts the days to Christmas by the calendar on this device', () => {
    for (const row of cases.christmas) {
      const [y, m, d, h] = row.local as [number, number, number, number];
      const days = daysToChristmas(new Date(y, m - 1, d, h).getTime());
      expect(days, row.local.join('-')).toBe(row.days);
      expect(christmasLabel(days)).toBe(row.label);
    }
  });

  it('writes no Christmas label for input that is not a count', () => {
    for (const [input, expected] of cases.christmasLabelOnly) expect(christmasLabel(input as number)).toBe(expected);
  });

  it('stamps a new entry with the time it was read', () => {
    expect(makeSaintEntry({ name: 'San Luca', date: '2026-10-11' }, 1234)).toEqual({
      name: 'San Luca',
      date: '2026-10-11',
      fetchedAt: 1234,
    });
    expect(readSaintEntry({ name: 'San Luca' })).toBeNull();
  });
});

describe('what this browser keeps', () => {
  it('shows the saint unless this browser stored an explicit off', () => {
    const page = memoryStorage();
    vi.stubGlobal('window', { localStorage: page });
    expect(loadSaintEnabled()).toBe(true);
    expect(saveSaintEnabled(false)).toBe(true);
    expect(page.data[SAINT_ENABLED_KEY]).toBe('false');
    expect(loadSaintEnabled()).toBe(false);
    expect(saveSaintEnabled(true)).toBe(true);
    expect(loadSaintEnabled()).toBe(true);
  });

  it('round-trips the saint and ignores a damaged one', () => {
    const page = memoryStorage();
    vi.stubGlobal('window', { localStorage: page });
    expect(loadSaintCache()).toBeNull();
    const entry = { name: 'San Luca', date: '2026-10-11', fetchedAt: 1760000000000 };
    expect(saveSaintCache(entry)).toBe(true);
    expect(loadSaintCache()).toEqual(entry);
    page.data[SAINT_CACHE_KEY] = '{not json';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadSaintCache()).toBeNull();
    page.data[SAINT_CACHE_KEY] = JSON.stringify({ name: '<b>', date: 'x' });
    expect(loadSaintCache()).toBeNull();
  });

  it('keeps working when the browser blocks storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('window', { localStorage: blocked });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadSaintEnabled()).toBe(true);
    expect(loadSaintCache()).toBeNull();
    expect(saveSaintEnabled(false)).toBe(false);
    expect(saveSaintCache({ name: 'San Luca', date: '2026-10-11', fetchedAt: 1 })).toBe(false);
  });
});
