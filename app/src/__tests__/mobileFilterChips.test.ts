import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// The phone shows the filters that are on as chips under the search box. The
// page is one file with no modules, so these tests read the chip rules out of
// it: which chips a page shows, in what order, with which number, and what
// taking one off changes.
const html = readFileSync(resolve(process.cwd(), 'public/mobile/index.html'), 'utf8');
const source = html.slice(html.indexOf('var AFC_GLOBE='), html.indexOf('function setFilterPanelOpen('));

interface Chip {
  facet: string;
  id: string;
  name: string;
  count: number;
  icon?: string;
  dot?: string;
}
interface Counts {
  lang?: number;
  category?: number;
  kind?: number;
  results: number | null;
}
interface Filters {
  curFolder: string;
  curLang: string;
  curLabels: string[];
  curCategory: string;
  curMemKind: string;
}
interface Api {
  activeFilters: (surface: string, counts: Counts) => Chip[];
  activeFilterChipHtml: (chip: Chip, noun: string[]) => string;
  removeActiveFilter: (facet: string, id: string) => void;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(filters: Partial<Filters> = {}): { api: Api; state: Filters; calls: string[] } {
  const calls: string[] = [];
  const state: Filters = {
    curFolder: 'ALL',
    curLang: 'ALL',
    curLabels: [],
    curCategory: 'ALL',
    curMemKind: 'ALL',
    ...filters,
  };
  const sandbox = Object.assign(state, {
    NO_LABEL: '__none__',
    MEM_KIND_LABEL: { fact: 'Fact', note: 'Note' },
    allLabels: [
      { id: 'l1', name: 'Urgent', color: 'rose' },
      { id: 'l2', name: 'Weekly', color: 'azure' },
    ],
    _labelCounts: { counts: { l1: 3 }, none: 4 },
    getFolderById: (id: string) => (id === 'f1' ? { id, name: 'Invoices' } : null),
    folderIcon: () => '<svg></svg>',
    folderCountDeep: () => 10,
    labelDot: (color: string) => '#' + color,
    memPlural: (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many),
    esc: escapeHtml,
    document: { querySelector: () => ({ textContent: 'EN' }) },
    setLangFilter: (lang: string) => {
      state.curLang = lang;
    },
    renderFolderChips: () => calls.push('folders'),
    renderCurrentSurface: () => calls.push('list'),
    refreshOpenFilterPanel: () => calls.push('panel'),
    syncFilterHeader: () => calls.push('header'),
  });
  const api = runInNewContext(
    source + ';({activeFilters, activeFilterChipHtml, removeActiveFilter})',
    sandbox,
  ) as Api;
  return { api, state, calls };
}

function read(chips: Chip[]): string[] {
  return Array.from(chips).map((chip) => chip.facet + ':' + chip.name + ' ' + chip.count);
}

describe('phone filter chips', () => {
  it('lists a snippet page in the order of its panel, each with its own number', () => {
    const { api } = page({ curFolder: 'f1', curLang: 'EN', curLabels: ['l1', 'l2'] });
    expect(read(api.activeFilters('snippets', { lang: 8, results: 3 }))).toEqual([
      'folders:Invoices 10',
      'languages:EN 8',
      'labels:Urgent 3',
      'labels:Weekly 0',
    ]);
  });

  it('shows nothing when no filter is on', () => {
    const { api } = page();
    expect(read(api.activeFilters('snippets', { lang: 0, results: 19 }))).toEqual([]);
    expect(read(api.activeFilters('prompts', { category: 0, results: 9 }))).toEqual([]);
    expect(read(api.activeFilters('memory', { kind: 0, results: 2 }))).toEqual([]);
  });

  it('keeps each page to its own filters', () => {
    const on: Partial<Filters> = {
      curFolder: 'f1',
      curLang: 'EN',
      curLabels: ['l1'],
      curCategory: 'Research',
      curMemKind: 'fact',
    };
    expect(read(page(on).api.activeFilters('prompts', { category: 5, results: 2 }))).toEqual([
      'labels:Urgent 3',
      'category:Research 5',
    ]);
    expect(read(page(on).api.activeFilters('memory', { kind: 2, results: 2 }))).toEqual(['kind:Fact 2']);
  });

  it('counts the snippets with no label, and skips a label that is gone', () => {
    const none = page({ curLabels: ['__none__'] }).api;
    expect(read(none.activeFilters('snippets', { lang: 0, results: 4 }))).toEqual(['labels:Unlabelled 4']);
    const gone = page({ curLabels: ['deleted', 'l1'] }).api;
    expect(read(gone.activeFilters('snippets', { lang: 0, results: 3 }))).toEqual(['labels:Urgent 3']);
  });

  it('draws a chip with its number, a way to change it and a way to remove it', () => {
    const { api } = page();
    const chip: Chip = { facet: 'folders', id: 'f"1', name: 'A <b> & "B"', count: 1 };
    const out = api.activeFilterChipHtml(chip, ['snippet', 'snippets']);
    expect(out).toContain('data-facet="folders" data-id="f&quot;1"');
    expect(out).toContain('<span class="afc-name">A &lt;b&gt; &amp; &quot;B&quot;</span>');
    expect(out).toContain('<span class="afc-cnt">1</span>');
    expect(out).toContain('1 snippet. Change this filter"');
    expect(out).toContain('class="afc-x" aria-label="Remove the A &lt;b&gt; &amp; &quot;B&quot; filter"');
    expect(out).not.toContain('<b>');
  });

  it('takes off one filter and leaves the others on', () => {
    const { api, state, calls } = page({ curFolder: 'f1', curLang: 'EN', curLabels: ['l1', 'l2'] });
    api.removeActiveFilter('labels', 'l1');
    expect(Array.from(state.curLabels)).toEqual(['l2']);
    expect([state.curFolder, state.curLang]).toEqual(['f1', 'EN']);
    // The list is drawn before the panel and the badge, so all three agree.
    expect(calls).toEqual(['list', 'panel', 'header']);

    api.removeActiveFilter('languages', 'EN');
    expect([state.curFolder, state.curLang]).toEqual(['f1', 'ALL']);
    api.removeActiveFilter('folders', 'f1');
    expect(state.curFolder).toBe('ALL');
    expect(calls.slice(-4)).toEqual(['folders', 'list', 'panel', 'header']);
    expect(Array.from(state.curLabels)).toEqual(['l2']);
  });

  it('takes off a category and a kind', () => {
    const { api, state } = page({ curCategory: 'Research', curMemKind: 'fact' });
    api.removeActiveFilter('category', 'Research');
    api.removeActiveFilter('kind', 'fact');
    expect([state.curCategory, state.curMemKind]).toEqual(['ALL', 'ALL']);
  });
});
