import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The editor's live preview, before the text goes out.
//
// While a snippet is written, the preview lists what in it looks unfinished
// ("[xxx]", "XXX"), decided by the same shared rules the extension and the
// phone run right before inserting. Under it sits the snippet's "Warn me if it
// looks unfinished" switch. Rendered on the server as the preview first
// appears, with the shared engine already on the page.

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

function render(body: string, checkUnfinished = true): string {
  return renderToStaticMarkup(
    <SnippetPreview
      body={body}
      lang="EN"
      checkUnfinished={checkUnfinished}
      onCheckUnfinishedChange={() => {}}
      onEditBody={() => {}}
    />,
  );
}

describe('SnippetPreview — before it goes out', () => {
  it('lists a gap written in the snippet, in the shared words', () => {
    const html = render('Hello [xxx], your order ref is XXX.');
    expect(html).toContain('May not be finished');
    expect(html).toContain('>[xxx]<');
    expect(html).toContain('>XXX<');
    expect(html).toContain('Looks like a placeholder');
    expect(html).toContain('Looks like a gap to fill in');
  });

  it('says nothing about a finished text', () => {
    const html = render('Hello, your order is ready.');
    expect(html).not.toContain('May not be finished');
  });

  it('does not list boxes nobody has filled in yet', () => {
    // Every box is empty while the snippet is written; Copy names them.
    const html = render('Dear {formtext: name=CLIENT}, thanks.');
    expect(html).not.toContain('May not be finished');
    expect(html).not.toContain('Left empty');
  });

  it('shows the switch, on, with what it does', () => {
    const html = render('Hello.');
    expect(html).toMatch(/<input type="checkbox"[^>]*checked=""/);
    expect(html).toContain('Warn me if it looks unfinished');
    expect(html).toContain('gaps like [name], XXX, ??? or empty boxes');
  });

  it('lists nothing once the switch is off, and shows it off', () => {
    const html = render('Hello [xxx].', false);
    expect(html).not.toContain('May not be finished');
    expect(html).not.toMatch(/<input type="checkbox"[^>]*checked=""/);
    expect(html).toContain('Warn me if it looks unfinished');
  });
});
