import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The popup's Brains tab (extension/popup/popup.js, v3.69.0) and the flag that
// tells someone updating from SprintBrain about it (extension/background/
// background.js). Both files are plain scripts with top-level chrome.* calls,
// so they cannot be imported: the real shipping functions are sliced out of
// the source and run here, the stance snippetInsertion.test.ts takes.

function sliceFunction(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`"${signature}" not found`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced braces while slicing');
}

function read(...parts: string[]): string {
  return readFileSync(resolve(process.cwd(), '..', ...parts), 'utf8');
}

// memory-pack.js is UMD: given a CommonJS `module`, it fills module.exports.
function loadModule<T>(src: string): T {
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface Item {
  name: string;
  summary?: string;
  body?: string;
}
interface Brain {
  name: string;
  description?: string;
}
interface PopupBrains {
  brainSize: (n: number) => string;
  brainStatsLine: (nBrains: number, nItems: number | null) => string;
  brainMatchesItem: (it: Item, q: string, brainName: string) => boolean;
  brainMatchesBrain: (b: Brain, q: string) => boolean;
  brainBlock: (items: Item[]) => string;
}

const POPUP = read('extension', 'popup', 'popup.js');
const pack = loadModule<{ formatInjectedBlock: (p: { items: Array<{ name: string; text: string }> }) => string }>(
  read('extension', 'shared', 'memory-pack.js'),
);
const popup = new Function(
  'SBMemoryPack',
  [
    'function brainSize(n){',
    'function brainStatsLine(nBrains, nItems){',
    'function brainMatchesItem(it, q, brainName){',
    'function brainMatchesBrain(b, q){',
    'function brainBlock(items){',
  ]
    .map((sig) => sliceFunction(POPUP, sig))
    .join('\n') +
    '\nreturn { brainSize, brainStatsLine, brainMatchesItem, brainMatchesBrain, brainBlock };',
)(pack) as PopupBrains;

const sbVersionBelow = new Function(
  sliceFunction(read('extension', 'background', 'background.js'), 'function sbVersionBelow(a, b) {') +
    '\nreturn sbVersionBelow;',
)() as (a: string | undefined, b: string) => boolean;

describe('the Brains tab words', () => {
  it("says a Brain's size the way the dashboard does", () => {
    expect(popup.brainSize(0)).toBe('Empty');
    expect(popup.brainSize(1)).toBe('1 item');
    expect(popup.brainSize(12)).toBe('12 items');
  });

  it('counts the Brains first, and the items once they have arrived', () => {
    expect(popup.brainStatsLine(3, null)).toBe('3 Brains');
    expect(popup.brainStatsLine(1, 1)).toBe('1 Brain · 1 item');
    expect(popup.brainStatsLine(2, 40)).toBe('2 Brains · 40 items');
  });
});

describe('Brains tab search', () => {
  const item: Item = { name: 'Refund rules', summary: 'When money goes back', body: 'Within 14 days.' };

  it("reads an item's name, summary, body and the name of its Brain", () => {
    expect(popup.brainMatchesItem(item, 'refund', 'Policies')).toBe(true);
    expect(popup.brainMatchesItem(item, 'money', 'Policies')).toBe(true);
    expect(popup.brainMatchesItem(item, '14 days', 'Policies')).toBe(true);
    expect(popup.brainMatchesItem(item, 'polic', 'Policies')).toBe(true);
    expect(popup.brainMatchesItem(item, 'invoice', 'Policies')).toBe(false);
  });

  it("reads a Brain's name and description", () => {
    const brain: Brain = { name: 'Policies', description: 'What we promise customers' };
    expect(popup.brainMatchesBrain(brain, 'polic')).toBe(true);
    expect(popup.brainMatchesBrain(brain, 'promise')).toBe(true);
    expect(popup.brainMatchesBrain(brain, 'invoice')).toBe(false);
  });

  it('lets everything through an empty search, and survives missing fields', () => {
    expect(popup.brainMatchesItem({ name: 'x' }, '', '')).toBe(true);
    expect(popup.brainMatchesBrain({ name: 'x' }, '')).toBe(true);
    expect(popup.brainMatchesItem({ name: 'x' }, 'y', '')).toBe(false);
  });
});

describe('Copy whole Brain', () => {
  it('hands out the block the Context button and the phone hand out', () => {
    const items: Item[] = [
      { name: 'Tone', body: 'Short and direct.' },
      { name: 'Hours', body: 'Open 9 to 5.' },
    ];
    expect(popup.brainBlock(items)).toBe(
      pack.formatInjectedBlock({
        items: [
          { name: 'Tone', text: 'Short and direct.' },
          { name: 'Hours', text: 'Open 9 to 5.' },
        ],
      }),
    );
  });

  it('keeps an item whose body is empty as a heading, as the phone does', () => {
    expect(popup.brainBlock([{ name: 'Draft' }])).toContain('## Draft\n\n');
  });
});

describe('the one-time note after the update', () => {
  it('shows for an update from any version before 3.69.0', () => {
    expect(sbVersionBelow('3.60.1', '3.69.0')).toBe(true);
    expect(sbVersionBelow('3.68.5', '3.69.0')).toBe(true);
    expect(sbVersionBelow('2.135.0', '3.69.0')).toBe(true);
  });

  it('compares each part as a number, so 3.9.0 sits below 3.69.0 and 3.100.0 above it', () => {
    expect(sbVersionBelow('3.9.0', '3.69.0')).toBe(true);
    expect(sbVersionBelow('3.100.0', '3.69.0')).toBe(false);
  });

  it('stays away from 3.69.0 itself and every later update', () => {
    expect(sbVersionBelow('3.69.0', '3.69.0')).toBe(false);
    expect(sbVersionBelow('3.69.1', '3.69.0')).toBe(false);
    expect(sbVersionBelow('4.0', '3.69.0')).toBe(false);
  });
});
