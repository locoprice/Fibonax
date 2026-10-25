import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The editor's live preview, with and without Fill from a web page.
//
// Server rendering draws the preview exactly as it first appears: the shared
// engine is already on the page (put there below, as an earlier preview would
// have), so the first render is the form. The Link box must be there only for
// a snippet whose fields say where their values are on a page; every other
// snippet's preview stays exactly what it was. The read itself is not reached
// from a static render, so the server call is stubbed out of the import graph.

vi.mock('@/lib/api/linkReadApi', () => ({
  linkReadApi: { readLink: vi.fn() },
  LinkReadError: class LinkReadError extends Error {},
}));

import { SnippetPreview } from '@/features/snippets/SnippetPreview';

type Requirer = (id: string) => unknown;

function loadShared(path: string, req?: Requirer): unknown {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', 'require', src) as (
    m: typeof mod,
    e: unknown,
    r: Requirer,
  ) => void;
  run(mod, mod.exports, req ?? (() => ({})));
  return mod.exports;
}

const engine = loadShared(resolve(process.cwd(), '..', 'extension', 'formula-engine.js'));
const fillForm = loadShared(
  resolve(process.cwd(), '..', 'extension', 'shared', 'fill-form.js'),
  (id) => {
    if (id === '../formula-engine.js') return engine;
    throw new Error(`fill-form.js asked for an unexpected module: ${id}`);
  },
);

const scope = globalThis as unknown as { window?: unknown };

beforeAll(() => {
  scope.window = { SBFillForm: fillForm, SBFormulaEngine: engine };
});

afterAll(() => {
  delete scope.window;
});

const LINKABLE =
  'Order {formtext: name=ORDER_REF; link=after:Order number}, ' +
  '{formtext: name=BOXES; type=number; default=0; link=before:Boxes|Box} boxes, ' +
  'note {formtext: name=NOTE}';

const PLAIN = 'Order {formtext: name=ORDER_REF}, note {formtext: name=NOTE}';

// Names the fields the box fills, and only those: NOTE reads no page.
const LABEL = 'Paste a web page link to fill Order ref and Boxes';

function render(body: string): string {
  return renderToStaticMarkup(<SnippetPreview body={body} lang="EN" />);
}

describe('SnippetPreview — the Link box', () => {
  it('is drawn above the fields for a snippet that reads a page', () => {
    const html = render(LINKABLE);
    expect(html).toContain(`>${LABEL}</label>`);
    // The visible label follows the snippet's wording; anchor the ordering
    // check to the actual field rather than its previous generated title.
    expect(html).toContain('data-fill-key="ORDER_REF"');
    expect(html.indexOf(LABEL)).toBeLessThan(html.indexOf('data-fill-key="ORDER_REF"'));
  });

  it('carries the parts every surface draws, in the shared words', () => {
    const html = render(LINKABLE);
    expect(html).toMatch(new RegExp(`<label for="sb-preview-link"[^>]*>${LABEL}</label>`));
    const input = /<input id="sb-preview-link"[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).toContain('type="url"');
    expect(input).toContain('inputMode="url"');
    expect(input).toContain('autoComplete="off"');
    // React writes this one in lower case; HTML attribute names ignore case.
    expect(input).toContain('spellcheck="false"');
    expect(input).toContain('placeholder="https://"');
    expect(html).toMatch(/<button type="button"[^>]*>Fill<\/button>/);
    expect(html).toMatch(/<p role="status" aria-live="polite"[^>]*><\/p>/);
    expect(html).toContain('aria-busy="false"');
  });

  it('is not a field: not counted, and not styled like one', () => {
    const html = render(LINKABLE);
    expect(html).toContain('3 fields');
    const input = /<input id="sb-preview-link"[^>]*>/.exec(html)?.[0] ?? '';
    // What the operator types into a field is bold; the link is not an answer.
    expect(input).not.toContain('font-bold');
  });

  it('is absent from every snippet that never mentions link=', () => {
    const html = render(PLAIN);
    expect(html).not.toContain('Paste a web page link');
    expect(html).not.toContain('sb-preview-link');
    expect(html).not.toContain('role="status"');
    expect(html).toContain('2 fields');
  });

  it('marks no field as filled from a page before anything was read', () => {
    expect(render(LINKABLE)).not.toContain('From link');
  });
});
