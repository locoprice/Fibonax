import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  metadataMatch,
  readableText,
  scoreMemoryItem,
  scorePrompt,
  scoreSnippet,
  searchWords,
  textExcerpt,
} from '@/lib/searchIndex';
import type { MemoryItem, Prompt, SnippetRow } from '@/types/database';

// One rule for "does this match, and why" (extension/shared/asset-search.js).
// The popup, the menu a trigger opens on a page and the phone read the file
// itself; the dashboard keeps a copy in lib/searchIndex.ts. This suite runs
// the real module, then holds every reader to it.

type Why =
  | { kind: 'Keyword' | 'Label'; value: string }
  | { kind: 'Text'; before: string; hit: string; after: string }
  | null;

interface Asset {
  shown?: Array<string | null | undefined>;
  keywords?: string[];
  labels?: string[];
  also?: Array<string | null | undefined>;
  text?: Array<string | null | undefined>;
}

interface AssetSearch {
  words: (query: string) => string[];
  readable: (text: string) => string;
  excerpt: (text: string, wanted: string[]) => Why;
  look: (query: string, asset: Asset) => { rank: number; why: Why } | null;
  whyHtml: (why: Why) => string;
}

function read(...parts: string[]): string {
  return readFileSync(resolve(process.cwd(), '..', ...parts), 'utf8');
}

// The module is UMD: given a CommonJS `module`, it fills module.exports.
function loadModule<T>(src: string): T {
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

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

const MODULE_SRC = read('extension', 'shared', 'asset-search.js');
const S = loadModule<AssetSearch>(MODULE_SRC);

const BODY =
  'Dear {formtext: name=client; default=friend}, we will wait for you at the parking area at 10. ' +
  'The total is {=price*2}. {if: late}Call us{else}See you soon{endif}. Opening hours are 9 to 18.';

describe('the shared search rule', () => {
  it('splits what is typed into words, lower case, each one once', () => {
    expect(S.words('  Parking   HOURS parking ')).toEqual(['parking', 'hours']);
    expect(S.words('   ')).toEqual([]);
  });

  it('reads a text the way a person does: a field is the name it carries', () => {
    expect(S.readable(BODY)).toBe(
      'Dear client, we will wait for you at the parking area at 10. The total is. Call us See you soon. Opening hours are 9 to 18.',
    );
    // A bare {word} and a JSON example are the person's own text.
    expect(S.readable('Write about {topic} as {"tone": "calm"}')).toBe('Write about {topic} as {"tone": "calm"}');
    expect(S.readable('{brain: id=123e4567-e89b-12d3-a456-426614174000; name=Clients}')).toBe('Clients');
  });

  it('finds a word inside the text and says where', () => {
    const found = S.look('parking', { shown: ['Arrival', '::arr'], text: [BODY] });
    expect(found?.rank).toBe(1);
    expect(found?.why).toEqual({
      kind: 'Text',
      before: '…client, we will wait for you at the ',
      hit: 'parking',
      after: ' area at 10. The total is. Call us See…',
    });
  });

  it('wants every word, in any order, anywhere in the asset', () => {
    const asset = { shown: ['Arrival', '::arr'], text: [BODY] };
    expect(S.look('hours parking', asset)).not.toBeNull();
    expect(S.look('arrival parking', asset)).not.toBeNull();
    expect(S.look('parking refund', asset)).toBeNull();
  });

  it('puts first what the row already shows, and explains nothing for it', () => {
    expect(S.look('arr', { shown: ['Arrival', '::arr'], text: [BODY] })).toEqual({ rank: 2, why: null });
    expect(S.look('', { shown: ['Arrival'] })).toEqual({ rank: 2, why: null });
  });

  it('names the keyword or the label before the text', () => {
    const asset = { shown: ['Arrival'], keywords: ['welcome note'], labels: ['Clients'], text: ['welcome, clients'] };
    expect(S.look('welcome', asset)?.why).toEqual({ kind: 'Keyword', value: 'welcome note' });
    expect(S.look('clients', asset)?.why).toEqual({ kind: 'Label', value: 'Clients' });
  });

  it('never matches the code that writes a field', () => {
    expect(S.look('formtext', { shown: ['Arrival'], text: [BODY] })).toBeNull();
    expect(S.look('client', { shown: ['Arrival'], text: [BODY] })).not.toBeNull();
  });

  it('keeps the found word in its own casing, and survives letters that change length', () => {
    expect(S.excerpt('İstanbul PARKING is near', ['parking'])).toEqual({
      kind: 'Text',
      before: 'İstanbul ',
      hit: 'PARKING',
      after: ' is near',
    });
  });

  it('ignores capitals and accents, and prints the word as it is written', () => {
    expect(S.words('CAFÉ Résumé')).toEqual(['cafe', 'resume']);
    expect(S.look('cafe', { shown: ['Café hours'] })).toEqual({ rank: 2, why: null });
    expect(S.look('CAFÉ', { shown: ['cafe hours'] })).toEqual({ rank: 2, why: null });
    expect(S.excerpt('Send your résumé today', ['resume'])).toEqual({
      kind: 'Text',
      before: 'Send your ',
      hit: 'résumé',
      after: ' today',
    });
  });

  it('prints the reason escaped, the found word marked', () => {
    expect(S.whyHtml({ kind: 'Text', before: '<b>at the ', hit: 'parking', after: ' & more' })).toBe(
      '&lt;b&gt;at the <mark>parking</mark> &amp; more',
    );
    expect(S.whyHtml({ kind: 'Keyword', value: 'a<b' })).toBe('Keyword: a&lt;b');
    expect(S.whyHtml(null)).toBe('');
  });
});

describe("the dashboard's copy of the rule", () => {
  const texts = [
    BODY,
    'İstanbul PARKING is near',
    'Write about {topic} as {"tone": "calm"}',
    '{case: upper}{formtext: name=city}{/case} and {button: label=Go}x{/button}',
    'Line one\n\nline   two\ttabbed',
    'The café opens at 8, and the RÉSUMÉ goes to Zoë',
    '',
  ];
  const queries = ['parking', 'hours parking', 'ARRIVAL parking', 'welcome', 'clients', 'formtext', 'city', 'two line', 'cafe', 'resume zoe', 'nope', ''];

  it('reads words and texts as the module does', () => {
    for (const query of queries) expect(searchWords(query)).toEqual(S.words(query));
    for (const text of texts) expect(readableText(text)).toBe(S.readable(text));
  });

  it('cuts the same piece of text around the word', () => {
    for (const text of texts) {
      for (const query of queries) {
        const wanted = S.words(query);
        expect(textExcerpt(text, wanted)).toEqual(S.excerpt(text, wanted));
      }
    }
  });

  it('gives the reason the module gives', () => {
    const shown = ['Arrival', '::arr'];
    const keywords = ['welcome note'];
    const labels = ['Clients'];
    for (const text of texts) {
      for (const query of queries) {
        const found = S.look(query, { shown, keywords, labels, text: [text] });
        if (found) expect(metadataMatch(query, shown, labels, keywords, [text])).toEqual(found.why);
      }
    }
  });

  it('lists exactly what the module finds', () => {
    for (const text of texts) {
      for (const query of queries.filter((value) => value !== '')) {
        const snippet = { name: 'Arrival', triggers: ['::arr'], alternative_queries: ['welcome note'], content: text, bodies: { IT: 'due parole' } } as unknown as SnippetRow;
        expect(scoreSnippet(snippet, query, ['Clients']) > 0).toBe(
          S.look(query, { shown: ['Arrival', '::arr'], keywords: ['welcome note'], labels: ['Clients'], text: [text, 'due parole'] }) !== null,
        );
        const prompt = { name: 'Arrival', shortcut: 'arr', intent_category: 'Writing', content: text } as unknown as Prompt;
        expect(scorePrompt(prompt, query, ['Clients']) > 0).toBe(
          S.look(query, { shown: ['Arrival', 'arr'], also: ['Writing'], labels: ['Clients'], text: [text] }) !== null,
        );
        const item = { name: 'Arrival', summary: 'welcome note', body: text } as unknown as MemoryItem;
        expect(scoreMemoryItem(item, query, 'Clients') > 0).toBe(
          S.look(query, { shown: ['Arrival'], also: ['Clients'], text: ['welcome note', text] }) !== null,
        );
      }
    }
  });
});

describe('the extension reads the module', () => {
  const POPUP = read('extension', 'popup', 'popup.js');
  const CONTENT = read('extension', 'content', 'content.js');

  interface Row {
    id?: string;
    title?: string;
    name?: string;
    shortcut?: string;
    body?: string;
    content?: string;
    bodies?: Record<string, string>;
    alternative_queries?: string[];
    intent_category?: string;
  }
  type Look = { rank: number; why: Why } | null;

  const popup = new Function(
    'SBAssetSearch',
    ['function snipLook(s,q){', 'function promptLook(p,q){', 'function whyLineHtml(look){']
      .map((signature) => sliceFunction(POPUP, signature))
      .join('\n') + '\nreturn { snipLook, promptLook, whyLineHtml };',
  )(S) as {
    snipLook: (s: Row, q: string) => Look;
    promptLook: (p: Row, q: string) => Look;
    whyLineHtml: (look: Look) => string;
  };

  const textMin = Number(/var PICKER_TEXT_MIN = (\d+);/.exec(CONTENT)?.[1]);
  const menu = new Function(
    'SBAssetSearch',
    'PICKER_TEXT_MIN',
    ['function _pickerLook(item, q) {', 'function _pickerNamed(look) {']
      .map((signature) => sliceFunction(CONTENT, signature))
      .join('\n') + '\nreturn { _pickerLook, _pickerNamed };',
  )(S, textMin) as {
    _pickerLook: (item: Row, q: string) => Look;
    _pickerNamed: (look: NonNullable<Look>) => boolean;
  };

  const snippet: Row = { id: 's1', title: 'Arrival', shortcut: '::arr', body: BODY, bodies: { IT: 'Vi aspettiamo al parcheggio' }, alternative_queries: ['welcome note'] };

  it('the popup finds a snippet by a word of its text, in any language it carries', () => {
    expect(popup.snipLook(snippet, 'parking')?.why?.kind).toBe('Text');
    expect(popup.snipLook(snippet, 'parcheggio')?.why?.kind).toBe('Text');
    expect(popup.snipLook(snippet, 'welcome')?.why).toEqual({ kind: 'Keyword', value: 'welcome note' });
    expect(popup.snipLook(snippet, 'arr')).toEqual({ rank: 2, why: null });
    expect(popup.snipLook(snippet, 'refund')).toBeNull();
  });

  it('the popup finds a prompt by a word of its text', () => {
    const prompt: Row = { id: 'p1', name: 'Summarise', shortcut: 'sum', intent_category: 'Writing', content: 'Keep the tone calm and short.' };
    expect(popup.promptLook(prompt, 'calm')?.why?.kind).toBe('Text');
    expect(popup.promptLook(prompt, 'writing')).toEqual({ rank: 1, why: null });
    expect(popup.promptLook(prompt, 'invoice')).toBeNull();
  });

  it('the popup prints the reason under the row, and nothing when the row says it', () => {
    expect(popup.whyLineHtml(popup.snipLook(snippet, 'parking'))).toContain('<div class="why">');
    expect(popup.whyLineHtml(popup.snipLook(snippet, 'parking'))).toContain('<mark>parking</mark>');
    expect(popup.whyLineHtml(popup.snipLook(snippet, 'arr'))).toBe('');
  });

  it('the menu on a page finds the same rows, and knows which were found by name', () => {
    const byText = menu._pickerLook(snippet, 'parking');
    const byName = menu._pickerLook(snippet, 'arr');
    const byKeyword = menu._pickerLook(snippet, 'welcome');
    expect(byText && menu._pickerNamed(byText)).toBe(false);
    expect(byName && menu._pickerNamed(byName)).toBe(true);
    expect(byKeyword && menu._pickerNamed(byKeyword)).toBe(true);
    expect(menu._pickerLook(snippet, 'refund')).toBeNull();
  });

  it('the menu reads the text from the fourth letter, so the start of a trigger lists names only', () => {
    expect(textMin).toBe(4);
    expect(menu._pickerLook(snippet, 'par')).toBeNull();
    expect(menu._pickerLook(snippet, 'park')?.why?.kind).toBe('Text');
  });

  it('is loaded before the code that calls it', () => {
    const manifest = read('extension', 'manifest.json');
    expect(manifest.indexOf('shared/asset-search.js')).toBeGreaterThan(-1);
    expect(manifest.indexOf('shared/asset-search.js')).toBeLessThan(manifest.indexOf('content/content.js'));
    const page = read('extension', 'popup', 'popup.html');
    expect(page.indexOf('../shared/asset-search.js')).toBeGreaterThan(-1);
    expect(page.indexOf('../shared/asset-search.js')).toBeLessThan(page.indexOf('src="popup.js"'));
  });
});
