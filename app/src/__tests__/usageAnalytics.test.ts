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
    { snippet_id: 'a', created_at: at(28, 10), fields_filled: 2, lang: 'EN', device: 'phone' },
    { snippet_id: 'a', created_at: at(27, 9), fields_filled: 0, lang: 'EN', device: 'computer' },
    { snippet_id: 'b', created_at: at(20, 9), fields_filled: 0, lang: 'IT' },
  ],
  snippets: [
    { id: 'a', title: 'Welcome reply', shortcut: '::hi', folder_id: 'f1', lang: 'EN', created_at: at(1, 9) },
    { id: 'b', title: 'Price estimate', shortcut: '::est', folder_id: null, lang: 'IT', created_at: at(1, 9) },
  ],
  folders: [{ id: 'f1', name: 'Sales' }],
  lastUsed: {},
  loadedFrom: UA.loadFrom(NOW).toISOString(),
  promptEvents: [{ prompt_id: 'p1', created_at: at(28, 8), device: null }],
  prompts: [{ id: 'p1', name: 'Summary', shortcut: null }],
};

describe('shared usage analytics, as the dashboard types it', () => {
  it('exposes the interface lib/usageAnalytics.ts declares', () => {
    for (const fn of ['normalizePeriod', 'periodLabel', 'range', 'loadFrom', 'change', 'formatCount', 'formatDuration', 'hourLabel', 'compute', 'pareto', 'team'] as const) {
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
    expect(Object.keys(r.top[0] ?? {}).sort()).toEqual(['change', 'detail', 'key', 'share', 'title', 'trend', 'uses'].sort());
    expect(r.top[0]?.trend).toHaveLength(7);
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

  it('returns every field the 80/20 view reads', () => {
    const p = UA.pareto({ ...input, period: 7, now: NOW });
    expect(Object.keys(p).sort()).toEqual(['label', 'period', 'prompts', 'rangeLabel', 'snippets'].sort());
    expect(Object.keys(p.snippets).sort()).toEqual(
      ['device', 'empty', 'headline', 'key', 'keyGroup', 'kind', 'library', 'rest', 'restGroup', 'summary', 'target', 'unused', 'used', 'uses'].sort(),
    );
    expect(Object.keys(p.snippets.key[0] ?? {}).sort()).toEqual(
      ['cumShare', 'detail', 'device', 'key', 'rank', 'share', 'title', 'uses'].sort(),
    );
    expect(Object.keys(p.snippets.keyGroup).sort()).toEqual(['count', 'device', 'share', 'uses']);
    expect(p.snippets.headline).toBe('1 snippet did all of your work');
    expect(p.snippets.key[0]?.device).toMatchObject({ phone: 1, computer: 1, unknown: 0, phoneShare: 50 });
    expect(p.prompts?.key[0]).toMatchObject({ title: 'Summary', uses: 1, device: { unknown: 1 } });
    expect(UA.DEVICE_LABELS.unknown).toBe('Before tracking');
    expect(UA.PARETO_TARGET).toBe(80);
  });

  it('builds the team table the TeamUsage card draws', () => {
    const t = UA.team(
      [{ user_id: 'u1', member_name: 'Ana', uses: 3, snippets: 2, prompts: 1 }],
      [{ user_id: 'u1', member_name: 'Ana', uses: 1, snippets: 1, prompts: 0 }],
      'u1',
    );
    expect(t.members[0]).toMatchObject({ rank: 1, name: 'Ana', isMe: true, mostActive: true, uses: 3, snippets: 2, prompts: 1, share: 100 });
    expect(t.total.text).toBe('+200%');
  });

  it('words the last-use line under team snippets and prompts', () => {
    const at = new Date(2026, 9, 30, 14, 5).toISOString();
    expect(UA.lastUseLine({ used_at: at, used_by_name: 'Ana' })).toBe('Last used by Ana on 30/10/2026 at 14:05');
    expect(UA.lastUseLine(null)).toBe('Never used');
  });
});
