import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UsageAnalyticsApi, UsageInput } from '@/lib/usageAnalytics';

// The dashboard's Analytics page reads every figure from
// extension/shared/usage-analytics.js, the file the phone carries a copy of.
// scripts/check-usage-analytics.js pins its arithmetic; this suite loads the
// REAL file and pins the shape lib/usageAnalytics.ts promises the page, so a
// renamed or missing field fails here instead of printing "undefined".
function loadShared<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

const UA = loadShared<UsageAnalyticsApi>(resolve(process.cwd(), '..', 'extension', 'shared', 'usage-analytics.js'));

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();

const input: UsageInput = {
  events: [
    { snippet_id: 'a', created_at: at(28, 10), fields_filled: 2, lang: 'EN' },
    { snippet_id: 'a', created_at: at(27, 9), fields_filled: 0, lang: 'EN' },
    { snippet_id: 'b', created_at: at(20, 9), fields_filled: 0, lang: 'IT' },
  ],
  snippets: [
    { id: 'a', title: 'Welcome reply', shortcut: '::hi', folder_id: 'f1', lang: 'EN', created_at: at(1, 9) },
    { id: 'b', title: 'Price estimate', shortcut: '::est', folder_id: null, lang: 'IT', created_at: at(1, 9) },
  ],
  folders: [{ id: 'f1', name: 'Sales' }],
  lastUsed: {},
  loadedFrom: UA.loadFrom(NOW).toISOString(),
};

describe('shared usage analytics, as the dashboard types it', () => {
  it('exposes the interface lib/usageAnalytics.ts declares', () => {
    for (const fn of ['normalizePeriod', 'periodLabel', 'range', 'loadFrom', 'change', 'formatCount', 'formatDuration', 'hourLabel', 'compute', 'team'] as const) {
      expect(typeof UA[fn]).toBe('function');
    }
    expect(UA.PERIODS).toEqual([7, 30, 90, 365]);
    expect(UA.DEFAULT_PERIOD).toBe(30);
    expect(UA.SECONDS_PER_USE).toBe(30);
  });

  it('returns every field the page reads', () => {
    const r = UA.compute({ ...input, period: 7, now: NOW });
    expect(Object.keys(r).sort()).toEqual(
      ['byFolder', 'byLanguage', 'empty', 'falling', 'health', 'label', 'patterns', 'period', 'prevRangeLabel', 'prevStart', 'rangeLabel', 'rising', 'series', 'start', 'top', 'totals'].sort(),
    );
    expect(Object.keys(r.totals).sort()).toEqual(
      ['activeDays', 'avgFieldsPerUse', 'avgPerActiveDay', 'avgPerDay', 'bestDay', 'days', 'fieldsFilled', 'secondsSaved', 'snippetsUsed', 'uses', 'usesWithFieldsShare'].sort(),
    );
    expect(Object.keys(r.totals.uses).sort()).toEqual(['cur', 'diff', 'dir', 'pct', 'prev', 'text'].sort());
    expect(Object.keys(r.series[0] ?? {}).sort()).toEqual(['avg7', 'count', 'date', 'label', 'prev', 'weekday'].sort());
    expect(r.patterns.grid).toHaveLength(7);
    expect(r.patterns.grid[0]).toHaveLength(24);
    expect(Object.keys(r.patterns.streak).sort()).toEqual(['current', 'currentAtLeast', 'longestInPeriod']);
    expect(Object.keys(r.health).sort()).toEqual(
      ['dormant', 'dormantDays', 'dormantList', 'inFolder', 'library', 'neverUsed', 'neverUsedList', 'usedInPeriod', 'usedShare', 'withShortcut'].sort(),
    );
  });

  it('computes the period against the one before it', () => {
    const r = UA.compute({ ...input, period: 7, now: NOW });
    expect(r.totals.uses.cur).toBe(2);
    expect(r.totals.uses.prev).toBe(1);
    expect(r.totals.uses.text).toBe('+100%');
    expect(r.top[0]?.title).toBe('Welcome reply');
    expect(r.top[0]?.share).toBe(100);
    expect(r.falling.map((m) => m.title)).toEqual(['Price estimate']);
  });

  it('builds the team table the TeamUsage card draws', () => {
    const t = UA.team(
      [{ user_id: 'u1', member_name: 'Ana', uses: 3, snippets: 2 }],
      [{ user_id: 'u1', member_name: 'Ana', uses: 1, snippets: 1 }],
      'u1',
    );
    expect(t.members[0]).toMatchObject({ rank: 1, name: 'Ana', isMe: true, uses: 3, snippets: 2, share: 100 });
    expect(t.total.text).toBe('+200%');
  });
});
