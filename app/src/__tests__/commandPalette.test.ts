// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The search window ("Search or ask") is one vanilla component for the popup,
// the dashboard and the phone: extension/shared/command-palette.js, with
// extension/shared/recents.js for what was opened lately and
// extension/shared/asset-search.js for what matches. This suite runs the three
// real files, the way each surface loads them.

interface Item {
  key: string;
  kind: 'snippet' | 'prompt' | 'brain' | 'item';
  title: string;
  shortcut: string;
  place: string;
  placeKey: string;
  byName: string;
  edited: number;
  labels: string[];
  keywords: string[];
  text: string[];
}

interface Filters {
  titleOnly: boolean;
  by: string[];
  places: string[];
  more: string[];
  types: string[];
  labels: string[];
  edited: string | null;
}

interface RecentRow {
  k: string;
  t: number;
}

interface RecentStore {
  ready: (cb: () => void) => void;
  list: () => RecentRow[];
  record: (key: string, now?: number) => void;
  forget: (keys: string[]) => void;
  clear: () => void;
}

interface Recents {
  LIMIT: number;
  GROUPS: string[];
  clean: (list: unknown) => RecentRow[];
  record: (list: RecentRow[], key: string, now: number) => RecentRow[];
  forget: (list: RecentRow[], keys: string[]) => RecentRow[];
  groupOf: (at: number, now: number) => string;
  group: <T>(rows: T[], now: number, atOf?: (row: T) => number) => Array<{ label: string; rows: T[] }>;
  localStore: (name: string) => { get: (cb: (stored: unknown) => void) => void; set: (list: RecentRow[]) => void };
  open: (store: { get: (cb: (stored: unknown) => void) => void; set: (list: RecentRow[]) => void }) => RecentStore;
}

interface Handle {
  open: (text?: string) => void;
  close: () => void;
  toggle: (text?: string) => void;
  isOpen: () => boolean;
  refresh: () => void;
  leaveAsk: () => void;
  destroy: () => void;
}

interface Config {
  name?: string;
  items: () => Item[];
  loading?: () => boolean;
  recents?: RecentStore;
  secondaryLabel?: string;
  onOpen?: (item: Item, secondary: boolean) => void;
  onToggle?: (open: boolean) => void;
  trigger?: HTMLElement;
  full?: boolean | (() => boolean);
  ask?: {
    locked: string;
    minLength: number;
    show: (el: HTMLElement, question: string) => void;
    hide: (el: HTMLElement) => void;
  };
}

interface Palette {
  DEBOUNCE_MS: number;
  create: (cfg: Config) => Handle;
  crumb: (item: Item) => string;
  emptyFilters: () => Filters;
  editedIn: (at: number, key: string, now: number) => boolean;
  passes: (item: Item, f: Filters, now: number) => boolean;
  facets: (items: Item[]) => {
    people: string[];
    places: Array<{ section: string; key: string; name: string }>;
    labels: string[];
    edited: boolean;
  };
  find: (
    items: Item[],
    query: string,
    f: Filters,
    now: number,
    opened?: Record<string, number>,
  ) => Array<{ item: Item; rank: number; why: unknown }>;
  recentRows: (items: Item[], recent: RecentRow[], f: Filters, now: number) => Array<{ item: Item; at: number }>;
  markTitle: (title: string, words: string[]) => string;
}

function read(...parts: string[]): string {
  return readFileSync(resolve(process.cwd(), '..', ...parts), 'utf8');
}

// The modules are UMD: given a CommonJS `module`, they fill module.exports.
function loadModule<T>(src: string): T {
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

const shared = globalThis as unknown as { SBAssetSearch: unknown; SBRecents: Recents };
shared.SBAssetSearch = loadModule(read('extension', 'shared', 'asset-search.js'));
const R = loadModule<Recents>(read('extension', 'shared', 'recents.js'));
shared.SBRecents = R;
const P = loadModule<Palette>(read('extension', 'shared', 'command-palette.js'));

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A Wednesday at noon, so "yesterday" and "today" never straddle midnight.
const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime();

// "é", written by its code so the file holds no accented letter by accident.
const E = String.fromCharCode(0xe9);

function item(over: Partial<Item> & Pick<Item, 'key' | 'kind' | 'title'>): Item {
  return {
    shortcut: '',
    place: '',
    placeKey: '',
    byName: 'You',
    edited: NOW - 2 * DAY,
    labels: [],
    keywords: [],
    text: [],
    ...over,
  };
}

const LIBRARY: Item[] = [
  item({
    key: 'snippet:pay', kind: 'snippet', title: 'Payment reminder', shortcut: '::payrem',
    place: 'Billing', placeKey: 'folder:billing', labels: ['Finance'],
    text: ['A quick reminder that your invoice is due at the end of the week.'],
  }),
  item({
    key: 'snippet:cv', kind: 'snippet', title: `R${E}sum${E} feedback`, shortcut: '::cv',
    place: 'Hiring', placeKey: 'folder:hiring', labels: ['Hiring'], edited: NOW - 9 * DAY,
    text: ['Thank you for sending your application.'],
  }),
  item({
    key: 'snippet:refund', kind: 'snippet', title: 'Refund confirmation', shortcut: '::refund',
    place: 'Billing', placeKey: 'folder:billing', byName: 'Giulia Bianchi', labels: ['Finance'],
    edited: NOW - 40 * DAY, text: ['We have sent your money back.'],
  }),
  item({
    key: 'prompt:calm', kind: 'prompt', title: 'Polite reply to a complaint', shortcut: '/calm',
    place: 'Support', placeKey: 'folder:support', byName: 'Giulia Bianchi', edited: NOW - 3 * HOUR,
    text: ['Apologise once, explain what happens next and offer a refund or a replacement.'],
  }),
  item({
    key: 'brain:policies', kind: 'brain', title: 'Company policies', placeKey: 'brain:policies',
    byName: 'Marco Rossi', text: ['Opening hours, holidays and the code of conduct.'],
  }),
  item({
    key: 'item:hours', kind: 'item', title: 'Office opening hours', place: 'Company policies',
    placeKey: 'brain:policies', byName: 'Marco Rossi',
    text: [`Monday to Friday, 9:00 to 18:00. The caf${E} on the ground floor opens at 8:00.`],
  }),
];

function memoryStore(initial: RecentRow[] = []) {
  let stored: RecentRow[] = initial;
  return {
    get: (cb: (value: unknown) => void) => cb(stored),
    set: (list: RecentRow[]) => { stored = list; },
    peek: () => stored,
  };
}

describe('recently opened', () => {
  it('keeps each item once, newest first', () => {
    let list: RecentRow[] = [];
    list = R.record(list, 'snippet:pay', NOW - 3 * HOUR);
    list = R.record(list, 'prompt:calm', NOW - 2 * HOUR);
    list = R.record(list, 'snippet:pay', NOW - 1 * HOUR);
    expect(list).toEqual([
      { k: 'snippet:pay', t: NOW - 1 * HOUR },
      { k: 'prompt:calm', t: NOW - 2 * HOUR },
    ]);
  });

  it('keeps the last 50', () => {
    let list: RecentRow[] = [];
    for (let i = 0; i < 60; i++) list = R.record(list, `snippet:${i}`, NOW - (60 - i) * MIN);
    expect(R.LIMIT).toBe(50);
    expect(list).toHaveLength(50);
    expect(list[0]?.k).toBe('snippet:59');
    expect(list[49]?.k).toBe('snippet:10');
  });

  it('drops what it cannot read', () => {
    expect(R.clean([{ k: 'a', t: 5 }, { k: '', t: 5 }, { k: 'b' }, null, { k: 'c', t: 'x' }, 'd'])).toEqual([
      { k: 'a', t: 5 },
    ]);
    expect(R.clean('nothing')).toEqual([]);
  });

  it('forgets items that no longer exist', () => {
    const list = R.record(R.record([], 'a', NOW - HOUR), 'b', NOW);
    expect(R.forget(list, ['a'])).toEqual([{ k: 'b', t: NOW }]);
  });

  it('puts a moment under the heading of its calendar day', () => {
    expect(R.groupOf(NOW - 1 * HOUR, NOW)).toBe('Today');
    // 13 hours ago is before midnight: yesterday on the calendar.
    expect(R.groupOf(NOW - 13 * HOUR, NOW)).toBe('Yesterday');
    expect(R.groupOf(NOW - 36 * HOUR, NOW)).toBe('Yesterday');
    expect(R.groupOf(NOW - 3 * DAY, NOW)).toBe('Past week');
    expect(R.groupOf(NOW - 7 * DAY, NOW)).toBe('Past week');
    expect(R.groupOf(NOW - 8 * DAY, NOW)).toBe('Past 30 days');
    expect(R.groupOf(NOW - 30 * DAY, NOW)).toBe('Past 30 days');
    expect(R.groupOf(NOW - 31 * DAY, NOW)).toBe('Older');
  });

  it('lists the headings in order and leaves an empty one out', () => {
    const rows = [
      { k: 'a', t: NOW - 1 * HOUR },
      { k: 'b', t: NOW - 3 * DAY },
      { k: 'c', t: NOW - 90 * DAY },
    ];
    const groups = R.group(rows, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Past week', 'Older']);
    expect(groups[1]?.rows).toEqual([{ k: 'b', t: NOW - 3 * DAY }]);
  });

  it('reads the stored list once, then answers and saves at once', () => {
    const store = memoryStore([{ k: 'snippet:pay', t: NOW - DAY }]);
    const recents = R.open(store);
    let ready = false;
    recents.ready(() => { ready = true; });
    expect(ready).toBe(true);
    recents.record('prompt:calm', NOW);
    expect(recents.list().map((row) => row.k)).toEqual(['prompt:calm', 'snippet:pay']);
    expect(store.peek()).toEqual(recents.list());
    recents.clear();
    expect(store.peek()).toEqual([]);
  });

  it('keeps the list in the page storage of a browser', () => {
    const store = R.localStore('sb_recents_test');
    store.set([{ k: 'snippet:pay', t: NOW }]);
    let got: unknown = null;
    store.get((value) => { got = value; });
    expect(got).toEqual([{ k: 'snippet:pay', t: NOW }]);
    localStorage.removeItem('sb_recents_test');
  });
});

describe('what matches', () => {
  const none = P.emptyFilters();

  it('ignores capitals and accents', () => {
    expect(P.find(LIBRARY, 'resume', none, NOW).map((r) => r.item.key)).toEqual(['snippet:cv']);
    expect(P.find(LIBRARY, `R${E}SUM${E}`.toUpperCase(), none, NOW).map((r) => r.item.key)).toEqual(['snippet:cv']);
    // "cafe" is written "café" inside a Brain item's text.
    expect(P.find(LIBRARY, 'cafe', none, NOW).map((r) => r.item.key)).toEqual(['item:hours']);
  });

  it('lists names first, then what was found in the text', () => {
    const rows = P.find(LIBRARY, 'refund', none, NOW);
    expect(rows.map((r) => [r.item.key, r.rank])).toEqual([
      ['snippet:refund', 2],
      ['prompt:calm', 1],
    ]);
    expect(rows[1]?.why).toMatchObject({ kind: 'Text', hit: 'refund' });
  });

  it('wants every word, in any order', () => {
    expect(P.find(LIBRARY, 'hours office', none, NOW).map((r) => r.item.key)).toEqual(['item:hours']);
    expect(P.find(LIBRARY, 'office banana', none, NOW)).toEqual([]);
  });

  it('puts a name that starts with the word first, then the most recent', () => {
    const rows = P.find(LIBRARY, 're', none, NOW, { 'snippet:pay': NOW - MIN });
    // "Refund" and "Résumé" start with it; "Payment reminder" only holds it.
    expect(rows.slice(0, 3).map((r) => r.item.key)).toEqual(['snippet:cv', 'snippet:refund', 'snippet:pay']);
  });

  it('finds an item through the place it sits in', () => {
    expect(P.find(LIBRARY, 'billing', none, NOW).map((r) => r.item.key).sort()).toEqual([
      'snippet:pay',
      'snippet:refund',
    ]);
  });

  it('marks the typed words in a name, accents kept as written', () => {
    expect(P.markTitle(`R${E}sum${E} feedback`, ['resume'])).toBe(`<mark>R${E}sum${E}</mark> feedback`);
    expect(P.markTitle('Payment <plan>', ['pay', 'plan'])).toBe('<mark>Pay</mark>ment &lt;<mark>plan</mark>&gt;');
    expect(P.markTitle('Out of office', ['zzz'])).toBe('Out of office');
  });

  it('writes where an item sits', () => {
    expect(P.crumb(LIBRARY[0] as Item)).toBe('Snippets / Billing');
    expect(P.crumb(LIBRARY[4] as Item)).toBe('Brains');
    expect(P.crumb(LIBRARY[5] as Item)).toBe('Brains / Company policies');
  });
});

describe('the filter chips', () => {
  function keys(f: Filters, query = ''): string[] {
    const rows = query
      ? P.find(LIBRARY, query, f, NOW).map((r) => r.item)
      : LIBRARY.filter((it) => P.passes(it, f, NOW));
    return rows.map((it) => it.key).sort();
  }

  it('Title only reads names and shortcuts, never the text', () => {
    const f = { ...P.emptyFilters(), titleOnly: true };
    expect(keys(f, 'refund')).toEqual(['snippet:refund']);
    expect(keys(f, 'cafe')).toEqual([]);
    expect(keys(f, 'payrem')).toEqual(['snippet:pay']);
  });

  it('Created by keeps the people picked', () => {
    const f = { ...P.emptyFilters(), by: ['Giulia Bianchi'] };
    expect(keys(f)).toEqual(['prompt:calm', 'snippet:refund']);
    f.by = ['Giulia Bianchi', 'Marco Rossi'];
    expect(keys(f)).toEqual(['brain:policies', 'item:hours', 'prompt:calm', 'snippet:refund']);
  });

  it('In keeps a folder, or a Brain with the items inside it', () => {
    expect(keys({ ...P.emptyFilters(), places: ['folder:billing'] })).toEqual(['snippet:pay', 'snippet:refund']);
    expect(keys({ ...P.emptyFilters(), places: ['brain:policies'] })).toEqual(['brain:policies', 'item:hours']);
  });

  it('Type counts a Brain item as Brains', () => {
    const f = { ...P.emptyFilters(), more: ['type'], types: ['brain'] };
    expect(keys(f)).toEqual(['brain:policies', 'item:hours']);
    f.types = ['prompt'];
    expect(keys(f)).toEqual(['prompt:calm']);
    // Added but nothing picked yet: everything still shows.
    f.types = [];
    expect(keys(f)).toHaveLength(LIBRARY.length);
  });

  it('Labels keeps what carries any of the labels picked', () => {
    const f = { ...P.emptyFilters(), more: ['labels'], labels: ['Hiring'] };
    expect(keys(f)).toEqual(['snippet:cv']);
    f.labels = ['Hiring', 'Finance'];
    expect(keys(f)).toEqual(['snippet:cv', 'snippet:pay', 'snippet:refund']);
  });

  it('Date edited sorts by when something last changed', () => {
    const f = { ...P.emptyFilters(), more: ['edited'], edited: 'today' as string | null };
    expect(keys(f)).toEqual(['prompt:calm']);
    f.edited = 'older';
    expect(keys(f)).toEqual(['snippet:refund']);
    f.edited = 'week';
    expect(keys(f)).not.toContain('snippet:cv');
    f.edited = 'month';
    expect(keys(f)).toContain('snippet:cv');
    expect(P.editedIn(0, 'older', NOW)).toBe(false);
  });

  it('filters stack', () => {
    const f = { ...P.emptyFilters(), by: ['Giulia Bianchi'], more: ['type'], types: ['snippet'] };
    expect(keys(f)).toEqual(['snippet:refund']);
  });

  it('offers what the library holds', () => {
    const fac = P.facets(LIBRARY);
    expect(fac.people).toEqual(['You', 'Giulia Bianchi', 'Marco Rossi']);
    expect(fac.places.map((p) => `${p.section}/${p.name}`)).toEqual([
      'Snippets/Billing',
      'Brains/Company policies',
      'Snippets/Hiring',
      'Prompts/Support',
    ]);
    expect(fac.labels).toEqual(['Finance', 'Hiring']);
    expect(fac.edited).toBe(true);
  });

  it('applies to what was opened lately too', () => {
    const recent = [
      { k: 'snippet:pay', t: NOW - HOUR },
      { k: 'snippet:gone', t: NOW - 2 * HOUR },
      { k: 'prompt:calm', t: NOW - DAY },
    ];
    expect(P.recentRows(LIBRARY, recent, P.emptyFilters(), NOW).map((r) => r.item.key)).toEqual([
      'snippet:pay',
      'prompt:calm',
    ]);
    const f = { ...P.emptyFilters(), by: ['You'] };
    expect(P.recentRows(LIBRARY, recent, f, NOW).map((r) => r.item.key)).toEqual(['snippet:pay']);
  });
});

describe('the window', () => {
  let handle: Handle | null = null;
  let opened: Array<[string, boolean]> = [];
  let toggles: boolean[] = [];
  let recents: RecentStore;
  let library: Item[];
  let loading = false;
  let trigger: HTMLButtonElement;

  function mount(over: Partial<Config> = {}): Handle {
    handle = P.create({
      name: 'test',
      items: () => library,
      loading: () => loading,
      recents,
      secondaryLabel: 'Open in new tab',
      onOpen: (it, secondary) => { opened.push([it.key, secondary]); },
      onToggle: (open) => { toggles.push(open); },
      trigger,
      ...over,
    });
    return handle;
  }

  const root = (): HTMLElement => document.querySelector('.sbcp') as HTMLElement;
  const input = (): HTMLInputElement => document.querySelector('.sbcp-input') as HTMLInputElement;
  const options = (): HTMLElement[] => Array.from(document.querySelectorAll('.sbcp [role="option"]'));
  const selected = (): string | null =>
    document.querySelector('.sbcp [aria-selected="true"]')?.getAttribute('data-key') ?? null;
  const headings = (): string[] =>
    Array.from(document.querySelectorAll('.sbcp .sbcp-g')).map((node) => node.textContent ?? '');

  function type(text: string): void {
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(P.DEBOUNCE_MS);
  }

  function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const target = document.activeElement && root().contains(document.activeElement) ? document.activeElement : input();
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  function click(selector: string): void {
    const node = document.querySelector(`.sbcp ${selector}`);
    if (!node) throw new Error(`"${selector}" is not in the window`);
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    opened = [];
    toggles = [];
    loading = false;
    library = LIBRARY.slice();
    recents = R.open(memoryStore([
      { k: 'snippet:pay', t: NOW - 25 * MIN },
      { k: 'prompt:calm', t: NOW - 2 * HOUR },
      { k: 'item:hours', t: NOW - 20 * HOUR },
      { k: 'snippet:cv', t: NOW - 3 * DAY },
      { k: 'snippet:refund', t: NOW - 70 * DAY },
    ]));
    trigger = document.createElement('button');
    trigger.textContent = 'Search';
    document.body.appendChild(trigger);
    trigger.focus();
  });

  afterEach(() => {
    handle?.destroy();
    handle = null;
    trigger.remove();
    vi.useRealTimers();
  });

  it('opens as a dialog with the typing box in focus', () => {
    mount().open();
    expect(root().hidden).toBe(false);
    const dialog = root().querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-controls')).toBe('test-list');
    expect(document.getElementById('test-list')?.getAttribute('role')).toBe('listbox');
    expect(document.activeElement).toBe(input());
    expect(input().placeholder).toBe('Search or ask a question…');
    expect(toggles).toEqual([true]);
  });

  it('lists what was opened lately by day, with no empty heading', () => {
    mount().open();
    expect(headings()).toEqual(['Today', 'Yesterday', 'Past week', 'Older']);
    expect(options().map((row) => row.getAttribute('data-key'))).toEqual([
      'snippet:pay',
      'prompt:calm',
      'item:hours',
      'snippet:cv',
      'snippet:refund',
    ]);
    const first = options()[0] as HTMLElement;
    expect(first.querySelector('.sbcp-t')?.textContent).toBe('Payment reminder');
    expect(first.querySelector('.sbcp-c')?.textContent).toBe('· Snippets / Billing');
    expect(first.querySelector('.sbcp-k')?.textContent).toBe('::payrem');
  });

  it('highlights the first row and names it to screen readers', () => {
    mount().open();
    expect(selected()).toBe('snippet:pay');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    expect(input().getAttribute('aria-expanded')).toBe('true');
  });

  it('shows results a moment after typing stops, without date headings', () => {
    mount().open();
    input().value = 'refund';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    // The box moved at once; the list has not yet.
    expect(headings()).toHaveLength(4);
    vi.advanceTimersByTime(P.DEBOUNCE_MS);
    expect(headings()).toEqual([]);
    expect(options().map((row) => row.getAttribute('data-key'))).toEqual(['snippet:refund', 'prompt:calm']);
    expect(options()[0]?.querySelector('mark')?.textContent).toBe('Refund');
    expect(options()[1]?.querySelector('.sbcp-w mark')?.textContent).toBe('refund');
    expect(selected()).toBe('snippet:refund');
  });

  it('moves the highlight with the arrow keys and stops at the ends', () => {
    mount().open();
    key('ArrowDown');
    expect(selected()).toBe('prompt:calm');
    key('ArrowDown');
    expect(selected()).toBe('item:hours');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[2]?.id);
    key('ArrowUp');
    key('ArrowUp');
    key('ArrowUp');
    expect(selected()).toBe('snippet:pay');
    for (let i = 0; i < 9; i++) key('ArrowDown');
    expect(selected()).toBe('snippet:refund');
  });

  it('shares one highlight between the keys and the mouse', () => {
    mount().open();
    const third = options()[2] as HTMLElement;
    third.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(selected()).toBe('item:hours');
    expect(document.querySelectorAll('.sbcp [aria-selected="true"]')).toHaveLength(1);
    key('ArrowDown');
    expect(selected()).toBe('snippet:cv');
  });

  it('Enter opens the highlighted row, records it and closes', () => {
    mount().open();
    key('ArrowDown');
    const event = key('Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(opened).toEqual([['prompt:calm', false]]);
    expect(handle?.isOpen()).toBe(false);
    expect(recents.list()[0]).toEqual({ k: 'prompt:calm', t: NOW });
    expect(toggles).toEqual([true, false]);
  });

  it('Enter right after typing opens the result for what was typed', () => {
    mount().open();
    input().value = 'cafe';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    key('Enter');
    expect(opened).toEqual([['item:hours', false]]);
  });

  it('Ctrl+Enter and Cmd+Enter open the second way', () => {
    mount().open();
    key('Enter', { ctrlKey: true });
    expect(opened).toEqual([['snippet:pay', true]]);
    handle?.open();
    key('Enter', { metaKey: true });
    expect(opened[1]).toEqual(['snippet:pay', true]);
  });

  it('a click opens a row, and a Ctrl+click opens it the second way', () => {
    mount().open();
    (options()[3] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opened).toEqual([['snippet:cv', false]]);
    handle?.open();
    (options()[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(opened[1]?.[1]).toBe(true);
  });

  it('Esc clears the text first and closes second', () => {
    mount().open();
    type('refund');
    expect(options()).toHaveLength(2);
    key('Escape');
    expect(handle?.isOpen()).toBe(true);
    expect(input().value).toBe('');
    expect(headings()).toHaveLength(4);
    key('Escape');
    expect(handle?.isOpen()).toBe(false);
    vi.advanceTimersByTime(200);
    expect(root().hidden).toBe(true);
  });

  it('a click on the backdrop closes, and focus goes back to what opened it', () => {
    mount().open();
    expect(document.activeElement).toBe(input());
    click('.sbcp-back');
    expect(handle?.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('goes back to the search bar when nothing in particular opened it', () => {
    trigger.blur();
    mount().open();
    key('Escape');
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps its keys to itself', () => {
    const heard: string[] = [];
    const listen = (e: KeyboardEvent): void => { heard.push(e.key); };
    document.addEventListener('keydown', listen);
    mount().open();
    key('ArrowDown');
    key('Enter');
    document.removeEventListener('keydown', listen);
    expect(heard).toEqual([]);
  });

  it('Ctrl+K closes it from inside', () => {
    mount().open();
    key('k', { ctrlKey: true });
    expect(handle?.isOpen()).toBe(false);
  });

  it('Tab stays inside the window', () => {
    mount().open();
    const stops: Element[] = [];
    for (let i = 0; i < 12; i++) {
      key('Tab');
      stops.push(document.activeElement as Element);
    }
    expect(stops.every((node) => root().contains(node))).toBe(true);
    expect(stops).toContain(input());
    key('Tab', { shiftKey: true });
    expect(root().contains(document.activeElement)).toBe(true);
  });

  it('says so when nothing matches, and offers to clear filters that are on', () => {
    mount().open();
    type('zzzz');
    expect(root().querySelector('.sbcp-empty')?.textContent).toContain('No results for “zzzz”.');
    expect(root().querySelector('[data-clear-filters]')).toBeNull();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);

    type('refund');
    click('[data-chip="title"]');
    type('money');
    expect(root().querySelector('.sbcp-empty')?.textContent).toContain('Some filters are on');
    click('[data-clear-filters]');
    expect(options().map((row) => row.getAttribute('data-key'))).toEqual(['snippet:refund']);
  });

  it('Title only is a switch with a cross to clear it', () => {
    mount().open();
    type('refund');
    click('[data-chip="title"]');
    expect(root().querySelector('[data-chip="title"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(options().map((row) => row.getAttribute('data-key'))).toEqual(['snippet:refund']);
    click('[data-x="title"]');
    expect(root().querySelector('[data-chip="title"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(options()).toHaveLength(2);
  });

  it('Created by opens a menu, narrows the list and shows who was picked', () => {
    mount().open();
    click('[data-chip="by"]');
    const menu = root().querySelector('[role="menu"]') as HTMLElement;
    expect(Array.from(menu.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'You',
      'Giulia Bianchi',
      'Marco Rossi',
    ]);
    click('[data-opt="by"][data-val="Marco Rossi"]');
    expect(options().map((row) => row.getAttribute('data-key'))).toEqual(['item:hours']);
    expect(root().querySelector('[data-chip="by"]')?.textContent).toBe('Created by: Marco Rossi');
    // The menu stays open so a second person can be ticked.
    expect(root().querySelector('[role="menu"] [data-val="Marco Rossi"]')?.getAttribute('aria-checked')).toBe('true');
    // Esc puts the menu away before it touches the window.
    key('Escape');
    expect(root().querySelector('[role="menu"]')).toBeNull();
    expect(handle?.isOpen()).toBe(true);
    click('[data-x="by"]');
    expect(options()).toHaveLength(5);
  });

  it('In lists folders and Brains under their section', () => {
    mount().open();
    click('[data-chip="in"]');
    const menu = root().querySelector('[role="menu"]') as HTMLElement;
    expect(Array.from(menu.querySelectorAll('.sbcp-mh')).map((n) => n.textContent)).toEqual([
      'Snippets',
      'Prompts',
      'Brains',
    ]);
    click('[data-opt="in"][data-val="brain:policies"]');
    expect(options().map((row) => row.getAttribute('data-key'))).toEqual(['item:hours']);
    expect(root().querySelector('[data-chip="in"]')?.textContent).toBe('In: Company policies');
  });

  it('+ Filter adds Type, Labels and Date edited as chips of their own', () => {
    mount().open();
    click('[data-chip="add"]');
    expect(Array.from(root().querySelectorAll('[data-opt="add"]')).map((b) => b.textContent)).toEqual([
      'Type',
      'Labels',
      'Date edited',
    ]);
    click('[data-opt="add"][data-val="type"]');
    // The new chip arrives with its menu open.
    click('[data-opt="type"][data-val="prompt"]');
    expect(options().map((row) => row.getAttribute('data-key'))).toEqual(['prompt:calm']);
    expect(root().querySelector('[data-chip="type"]')?.textContent).toBe('Type: Prompts');
    click('[data-x="type"]');
    expect(root().querySelector('[data-chip="type"]')).toBeNull();
    expect(options()).toHaveLength(5);
  });

  it('leaves out a chip the library gives no reason for', () => {
    library = LIBRARY.filter((it) => it.byName === 'You').map((it) => ({ ...it, labels: [], edited: 0 }));
    mount().open();
    expect(root().querySelector('[data-chip="by"]')).toBeNull();
    click('[data-chip="add"]');
    expect(Array.from(root().querySelectorAll('[data-opt="add"]')).map((b) => b.textContent)).toEqual(['Type']);
  });

  it('starts with clean filters every time it opens', () => {
    mount().open();
    click('[data-chip="title"]');
    key('Escape');
    handle?.open();
    expect(root().querySelector('[data-chip="title"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows thin rows while the first copy of the library arrives', () => {
    library = [];
    loading = true;
    mount().open();
    expect(root().querySelectorAll('.sbcp-skel')).toHaveLength(5);
    expect(document.getElementById('test-list')?.getAttribute('aria-busy')).toBe('true');
    loading = false;
    library = LIBRARY.slice();
    handle?.refresh();
    expect(root().querySelectorAll('.sbcp-skel')).toHaveLength(0);
    expect(options()).toHaveLength(5);
  });

  it('keeps the highlight on its item when fresh data arrives', () => {
    mount().open();
    type('re');
    key('ArrowDown');
    const before = selected();
    expect(before).not.toBeNull();
    library = [
      item({ key: 'snippet:new', kind: 'snippet', title: 'Refund rules', shortcut: '::rules', edited: NOW }),
      ...LIBRARY,
    ];
    handle?.refresh();
    expect(options().map((row) => row.getAttribute('data-key'))).toContain('snippet:new');
    expect(selected()).toBe(before);
  });

  it('says so when nothing was opened yet, and clears the list on request', () => {
    mount().open();
    click('[data-gear]');
    click('[data-clear-recents]');
    expect(recents.list()).toEqual([]);
    expect(root().querySelector('.sbcp-empty')?.textContent).toContain('Nothing opened yet.');
  });

  it('opens with text already in the box', () => {
    mount().open('pay');
    expect(input().value).toBe('pay');
    expect(options().map((row) => row.getAttribute('data-key'))).toEqual(['snippet:pay']);
  });

  it('takes the whole screen only where the surface says so', () => {
    mount().open();
    expect(root().classList.contains('sbcp-full')).toBe(false);
    handle?.destroy();
    mount({ full: true }).open();
    expect(root().classList.contains('sbcp-full')).toBe(true);
    handle?.destroy();
    let narrow = false;
    mount({ full: () => narrow }).open();
    expect(root().classList.contains('sbcp-full')).toBe(false);
    key('Escape');
    narrow = true;
    handle?.open();
    expect(root().classList.contains('sbcp-full')).toBe(true);
  });

  it('has no ask button where the surface has no FiboChat', () => {
    mount().open();
    expect(root().querySelector('.sbcp-ai')).toBeNull();
  });

  describe('asking', () => {
    let shown: string[] = [];
    let hidden = 0;

    function mountAsk(locked = ''): void {
      shown = [];
      hidden = 0;
      mount({
        ask: {
          locked,
          minLength: 3,
          show: (el, question) => { shown.push(question); el.textContent = `answer to ${question}`; },
          hide: (el) => { hidden += 1; el.textContent = ''; },
        },
      }).open();
    }

    it('the sparkle button switches to asking and back', () => {
      mountAsk();
      click('.sbcp-ai');
      expect(root().querySelector('.sbcp-ai')?.getAttribute('aria-pressed')).toBe('true');
      expect(input().placeholder).toBe('Ask a question about your snippets and Brains…');
      expect((root().querySelector('.sbcp-chips') as HTMLElement).hidden).toBe(true);
      expect((root().querySelector('.sbcp-list') as HTMLElement).hidden).toBe(true);
      expect(document.activeElement).toBe(input());
      click('.sbcp-ai');
      expect(options()).toHaveLength(5);
    });

    it('Enter hands the question over once it is long enough', () => {
      mountAsk();
      click('.sbcp-ai');
      input().value = 'hi';
      input().dispatchEvent(new Event('input', { bubbles: true }));
      key('Enter');
      expect(shown).toEqual([]);
      input().value = 'How long does a refund take?';
      input().dispatchEvent(new Event('input', { bubbles: true }));
      key('Enter');
      expect(shown).toEqual(['How long does a refund take?']);
      expect(root().querySelector('.sbcp-ask-host')?.textContent).toBe('answer to How long does a refund take?');
      expect(handle?.isOpen()).toBe(true);
    });

    it('takes the answer away when the question changes or the window closes', () => {
      mountAsk();
      click('.sbcp-ai');
      input().value = 'How long does a refund take?';
      input().dispatchEvent(new Event('input', { bubbles: true }));
      key('Enter');
      input().value = 'How long does a refund take now?';
      input().dispatchEvent(new Event('input', { bubbles: true }));
      expect(hidden).toBe(1);
      key('Enter');
      key('Escape');
      expect(hidden).toBe(2);
      expect(handle?.isOpen()).toBe(true);
      key('Escape');
      expect(handle?.isOpen()).toBe(false);
    });

    it('says why it cannot ask on an account without it', () => {
      mountAsk('Available to Pro users soon');
      click('.sbcp-ai');
      expect(root().querySelector('.sbcp-ask-lock')?.textContent).toBe('Available to Pro users soon');
      input().value = 'How long does a refund take?';
      input().dispatchEvent(new Event('input', { bubbles: true }));
      key('Enter');
      expect(shown).toEqual([]);
    });
  });
});
