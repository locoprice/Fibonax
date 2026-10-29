// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// How a preview shows an email layout on the extension and the phone: the
// decision that it is one (the same the editor takes in emailLayout.ts), the
// document the frame shows, and the drawer that puts the card in a frame and
// the bar's lines in the box. extension/shared/fill-form.js and
// fill-form-ui.js are the shipping files, run here as the popup runs them.

interface LayoutApi {
  isEmailLayout: (html: string | null) => boolean;
  layoutDocument: (html: string) => string;
  layoutFragment: (html: string) => DocumentFragment | null;
  LAYOUT_BAR_TAGS: string[];
}
interface PreviewUi {
  showPreview: (box: HTMLElement, vm: { formatted: string | null; parts: unknown[] | null; preview: string }) => void;
}
interface FrameEl extends HTMLIFrameElement {
  _ffHtml?: string;
}

const CARD =
  '<table style="width:600px"><tbody>' +
  '<tr><td style="color:#555">Customer</td><td><b>Mario Rossi</b></td></tr>' +
  '<tr><td>Total</td><td>€326.00</td></tr>' +
  '</tbody></table>';
const LINES = '<div>Hello <b>you</b></div><ul><li>one</li></ul>';

let api: LayoutApi;
let ui: PreviewUi;

beforeAll(() => {
  const shared = resolve(process.cwd(), '..', 'extension', 'shared');
  // Both files install themselves on the window, as they do in the popup.
  new Function(readFileSync(resolve(shared, 'fill-form.js'), 'utf8'))();
  new Function(readFileSync(resolve(shared, 'fill-form-ui.js'), 'utf8'))();
  const globals = window as unknown as { SBFillForm: LayoutApi; SBFillFormUI: PreviewUi };
  api = globals.SBFillForm;
  ui = globals.SBFillFormUI;
});

describe('isEmailLayout, as the previews decide it', () => {
  it('is false for what the bar writes, pictures included', () => {
    expect(api.isEmailLayout(LINES)).toBe(false);
    expect(api.isEmailLayout('<div><img src="https://x/y.png" width="320" alt=""></div>')).toBe(false);
    expect(api.isEmailLayout(null)).toBe(false);
    expect(api.isEmailLayout('')).toBe(false);
  });

  it('is true for a table, or a styled line', () => {
    expect(api.isEmailLayout(CARD)).toBe(true);
    expect(api.isEmailLayout('<div style="color:red">Hi</div>')).toBe(true);
    expect(api.isEmailLayout('<p><span style="font-weight:bold">Hi</span></p>')).toBe(true);
  });

  it('lists the bar tags in the editor order', () => {
    expect(api.LAYOUT_BAR_TAGS).toEqual(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'IMG']);
  });
});

describe('layoutDocument', () => {
  it('wraps the layout in a document of its own, pictures and tables no wider than the frame', () => {
    const doc = api.layoutDocument(CARD);
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain(CARD);
    expect(doc).toContain('img{max-width:100%;height:auto}');
    expect(doc).toContain('table{max-width:100%}');
  });
});

describe('showPreview', () => {
  function box(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }

  it('puts an email layout in a frame that runs nothing', () => {
    const el = box();
    ui.showPreview(el, { formatted: CARD, parts: null, preview: 'Customer Mario Rossi\nTotal €326.00' });
    const frame = el.querySelector('iframe.ff-frame') as FrameEl | null;
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?._ffHtml).toBe(CARD);
    expect(el.classList.contains('ff-framed')).toBe(true);
    expect(el.classList.contains('ff-layout')).toBe(false);
  });

  it('keeps the same frame when the form is typed in', () => {
    const el = box();
    ui.showPreview(el, { formatted: CARD, parts: null, preview: '' });
    const first = el.querySelector('iframe.ff-frame');
    ui.showPreview(el, { formatted: CARD.replace('Mario', 'Maria'), parts: null, preview: '' });
    expect(el.querySelector('iframe.ff-frame')).toBe(first);
    expect(el.querySelectorAll('iframe').length).toBe(1);
  });

  it("draws the bar's lines in the box itself", () => {
    const el = box();
    ui.showPreview(el, { formatted: LINES, parts: null, preview: 'Hello you\n• one' });
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.classList.contains('ff-layout')).toBe(true);
    expect(el.querySelector('ul li')?.textContent).toBe('one');
  });

  it('draws the card as lines and cells once the page has refused the frame', () => {
    const el = box() as HTMLElement & { _ffNoFrame?: boolean };
    el._ffNoFrame = true;
    ui.showPreview(el, { formatted: CARD, parts: null, preview: '' });
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.classList.contains('ff-layout')).toBe(true);
    expect(el.textContent).toBe('Customer Mario Rossi Total €326.00 ');
  });

  it('shows plain text as before', () => {
    const el = box();
    ui.showPreview(el, { formatted: null, parts: null, preview: 'Hello' });
    expect(el.textContent).toBe('Hello');
    expect(el.classList.contains('ff-framed')).toBe(false);
  });
});
