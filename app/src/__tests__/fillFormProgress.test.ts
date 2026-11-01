// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SbFillFormViewModel, SbFillProgress } from '@/lib/fillFormEngine';

// The line above a long fill form: counted once in fill-form.js and drawn by
// fill-form-ui.js on the overlay, the popup and the phone. The shipping files
// run here as the popup runs them (installed on the window, engine first), so
// what this asserts is what a person sees.

interface FillApi {
  fillForm: (text: string, values: Record<string, string>, opts: Record<string, unknown>) => SbFillFormViewModel;
  progress: (fields: SbFillFormViewModel['fields']) => SbFillProgress;
  PROGRESS_THRESHOLD: number;
}
interface FillUi {
  enhance: (host: HTMLElement, vm: SbFillFormViewModel, cfg: Record<string, string>) => void;
  refresh: (host: HTMLElement, vm: SbFillFormViewModel) => void;
}

const NOW = new Date(2026, 7, 30, 9, 15);
const CFG = { prefix: 't', row: '.row', caption: '.cap', menu: '.menu', control: '.c' };
const LONG = 'A{F1}B{F2}C{F3}D{F4}E{F5}F{F6}G{F7}H{F8}';
const SHORT = 'A{F1}B{F2}C{F3}D{F4}';

let api: FillApi;
let ui: FillUi;

beforeAll(() => {
  const ext = resolve(process.cwd(), '..', 'extension');
  new Function(readFileSync(resolve(ext, 'formula-engine.js'), 'utf8'))();
  new Function(readFileSync(resolve(ext, 'shared', 'fill-form.js'), 'utf8'))();
  new Function(readFileSync(resolve(ext, 'shared', 'fill-form-ui.js'), 'utf8'))();
  const globals = window as unknown as { SBFillForm: FillApi; SBFillFormUI: FillUi };
  api = globals.SBFillForm;
  ui = globals.SBFillFormUI;
});

/** A host with one plain row per field, the shape every renderer hands enhance(). */
function hostFor(vm: SbFillFormViewModel): HTMLElement {
  const wrap = document.createElement('div');
  const host = document.createElement('div');
  host.innerHTML = vm.fields.map(() => '<div class="row"><input class="c"></div>').join('');
  wrap.appendChild(host);
  document.body.appendChild(wrap);
  return host;
}

function bar(host: HTMLElement): HTMLElement | null {
  const prev = host.previousElementSibling;
  return prev instanceof HTMLElement && prev.classList.contains('ff-progress') ? prev : null;
}

describe('progress, as fill-form.js counts it', () => {
  it('starts at five fields', () => {
    expect(api.PROGRESS_THRESHOLD).toBe(5);
    expect(api.fillForm(SHORT, {}, { now: NOW }).progress.show).toBe(false);
    expect(api.fillForm(LONG, {}, { now: NOW }).progress).toEqual({
      show: true, done: 0, total: 8, percent: 0, label: '0 of 8 filled in',
    });
  });

  it('counts an answer the text can use, and a default from the start', () => {
    const body = '{F1}{F2}{F3}{F4}{formtext: name=N; type=number}{formdate: name=D}';
    const p = api.fillForm(body, { F1: 'Ada', F2: '  ', N: 'abc' }, { now: NOW }).progress;
    expect([p.done, p.total, p.percent, p.label]).toEqual([2, 6, 33, '2 of 6 filled in']);
  });

  it('says so when every field is filled', () => {
    const vals = { F1: 'a', F2: 'b', F3: 'c', F4: 'd', F5: 'e', F6: 'f', F7: 'g', F8: 'h' };
    expect(api.fillForm(LONG, vals, { now: NOW }).progress.label).toBe('All 8 filled in');
  });

  it('leaves a hidden field out of the count', () => {
    const fields = api.fillForm(LONG, { F1: 'a' }, { now: NOW }).fields;
    const hidden = fields.map((f, i) => (i === 0 ? { ...f, visible: false } : f));
    expect(api.progress(hidden)).toEqual({ show: true, done: 0, total: 7, percent: 0, label: '0 of 7 filled in' });
  });
});

describe('the line fill-form-ui.js draws', () => {
  it('sits right before a long form and reads the view model', () => {
    const vm = api.fillForm(LONG, {}, { now: NOW });
    const host = hostFor(vm);
    ui.enhance(host, vm, CFG);
    const line = bar(host);
    expect(line).not.toBeNull();
    const meter = line?.querySelector('[role=progressbar]');
    expect(meter?.getAttribute('aria-valuemin')).toBe('0');
    expect(meter?.getAttribute('aria-valuemax')).toBe('8');
    expect(meter?.getAttribute('aria-valuenow')).toBe('0');
    expect(meter?.getAttribute('aria-valuetext')).toBe('0 of 8 filled in');
    expect(line?.querySelector<HTMLElement>('.ff-progress-fill')?.style.width).toBe('0%');
    expect(line?.querySelector('.ff-progress-text')?.textContent).toBe('0 of 8 filled in');
    expect(line?.querySelector('.ff-progress-text')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('moves in place as answers arrive, and marks the end', () => {
    const vm = api.fillForm(LONG, {}, { now: NOW });
    const host = hostFor(vm);
    ui.enhance(host, vm, CFG);
    const first = bar(host);
    ui.refresh(host, api.fillForm(LONG, { F1: 'a', F2: 'b', F3: 'c' }, { now: NOW }));
    expect(bar(host)).toBe(first);
    expect(first?.querySelector<HTMLElement>('.ff-progress-fill')?.style.width).toBe('38%');
    expect(first?.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('3');
    expect(first?.querySelector('.ff-progress-text')?.textContent).toBe('3 of 8 filled in');
    expect(first?.classList.contains('ff-progress--done')).toBe(false);
    const vals = { F1: 'a', F2: 'b', F3: 'c', F4: 'd', F5: 'e', F6: 'f', F7: 'g', F8: 'h' };
    ui.refresh(host, api.fillForm(LONG, vals, { now: NOW }));
    expect(first?.querySelector<HTMLElement>('.ff-progress-fill')?.style.width).toBe('100%');
    expect(first?.classList.contains('ff-progress--done')).toBe(true);
    expect(first?.querySelector('.ff-progress-text')?.textContent).toBe('All 8 filled in');
  });

  it('draws nothing for a short form', () => {
    const vm = api.fillForm(SHORT, {}, { now: NOW });
    const host = hostFor(vm);
    ui.enhance(host, vm, CFG);
    expect(bar(host)).toBeNull();
    ui.refresh(host, api.fillForm(SHORT, { F1: 'a' }, { now: NOW }));
    expect(bar(host)).toBeNull();
  });
});
