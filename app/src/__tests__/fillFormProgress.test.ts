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
      filled: [false, false, false, false, false, false, false, false],
    });
  });

  it('counts an answer the text can use', () => {
    const body = '{F1}{F2}{F3}{F4}{formtext: name=N; type=number}{formdate: name=D}';
    const p = api.fillForm(body, { F1: 'Ada', F2: '  ', N: 'abc' }, { now: NOW }).progress;
    expect([p.done, p.total, p.percent, p.label]).toEqual([1, 5, 20, '1 of 5 filled in']);
    expect(p.filled).toEqual([true, false, false, false, false]);
  });

  describe('a form that opens with answers already in it', () => {
    const PREFILLED =
      '{formtext: name=P1; default=a}{formtext: name=P2; default=b}' +
      '{formtext: name=P3; type=number; default=3}{formdate: name=P4}{E1}{E2}{E3}';

    it('opens at zero, counting only the boxes that open empty', () => {
      expect(api.fillForm(PREFILLED, {}, { now: NOW }).progress).toEqual({
        show: true, done: 0, total: 3, percent: 0, label: '0 of 3 filled in', filled: [false, false, false],
      });
    });

    it('does not move when a pre-filled answer is changed or cleared', () => {
      const p = api.fillForm(PREFILLED, { P1: 'changed', P2: '', P4: '2026-09-01', E1: 'x' }, { now: NOW }).progress;
      expect([p.done, p.total, p.label]).toEqual([1, 3, '1 of 3 filled in']);
    });

    it('can finish', () => {
      const p = api.fillForm(PREFILLED, { E1: 'x', E2: 'y', E3: 'z' }, { now: NOW }).progress;
      expect([p.percent, p.label]).toEqual([100, 'All 3 filled in']);
    });

    it('shows no line when nothing opens empty', () => {
      const body =
        '{formtext: name=P1; default=a}{formtext: name=P2; default=b}{formtext: name=P3; default=c}' +
        '{formtext: name=P4; default=d}{formdate: name=P5}';
      const p = api.fillForm(body, {}, { now: NOW }).progress;
      expect([p.show, p.total]).toEqual([false, 0]);
    });
  });

  it('says so when every field is filled', () => {
    const vals = { F1: 'a', F2: 'b', F3: 'c', F4: 'd', F5: 'e', F6: 'f', F7: 'g', F8: 'h' };
    expect(api.fillForm(LONG, vals, { now: NOW }).progress.label).toBe('All 8 filled in');
  });

  it('leaves a hidden field out of the count', () => {
    const fields = api.fillForm(LONG, { F1: 'a' }, { now: NOW }).fields;
    const hidden = fields.map((f, i) => (i === 0 ? { ...f, visible: false } : f));
    expect(api.progress(hidden)).toEqual({
      show: true, done: 0, total: 7, percent: 0, label: '0 of 7 filled in', filled: Array(7).fill(false),
    });
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
    const dots = [...(first?.querySelectorAll('.ff-progress-dot') ?? [])];
    expect(dots).toHaveLength(8);
    expect(dots.map((d) => d.classList.contains('ff-progress-dot--on'))).toEqual(
      [true, true, true, false, false, false, false, false],
    );
    expect((dots[0] as HTMLElement).style.left).toBe('6.25%');
    expect(dots.every((d) => d.getAttribute('aria-hidden') === 'true')).toBe(true);
    const vals = { F1: 'a', F2: 'b', F3: 'c', F4: 'd', F5: 'e', F6: 'f', F7: 'g', F8: 'h' };
    ui.refresh(host, api.fillForm(LONG, vals, { now: NOW }));
    expect(first?.querySelector<HTMLElement>('.ff-progress-fill')?.style.width).toBe('100%');
    expect(first?.classList.contains('ff-progress--done')).toBe(true);
    expect(first?.querySelector('.ff-progress-text')?.textContent).toBe('All 8 filled in');
  });

  it('goes where the surface asks, as the overlay puts it above its footer', () => {
    const vm = api.fillForm(LONG, {}, { now: NOW });
    const host = hostFor(vm);
    const foot = document.createElement('div');
    host.after(foot);
    (ui.enhance as (h: HTMLElement, v: SbFillFormViewModel, c: Record<string, unknown>) => void)(
      host, vm, { ...CFG, progressBefore: foot },
    );
    expect(bar(host)).toBeNull();
    const line = foot.previousElementSibling;
    expect(line?.classList.contains('ff-progress')).toBe(true);
    ui.refresh(host, api.fillForm(LONG, { F1: 'a' }, { now: NOW }));
    expect(foot.previousElementSibling).toBe(line);
    expect(line?.querySelector('.ff-progress-text')?.textContent).toBe('1 of 8 filled in');
  });

  it('keeps one line when the form is drawn again in its place, as the phone does for another language', () => {
    const vm = api.fillForm(LONG, {}, { now: NOW });
    const host = hostFor(vm);
    ui.enhance(host, vm, CFG);
    const first = bar(host);
    const redraw = (next: SbFillFormViewModel): void => {
      Reflect.deleteProperty(host, '_fillUI');
      host.innerHTML = next.fields.map(() => '<div class="row"><input class="c"></div>').join('');
      ui.enhance(host, next, CFG);
    };
    redraw(api.fillForm(LONG, { F1: 'a' }, { now: NOW }));
    redraw(api.fillForm(LONG, { F1: 'a', F2: 'b' }, { now: NOW }));
    expect(host.parentElement?.querySelectorAll('.ff-progress')).toHaveLength(1);
    expect(bar(host)).toBe(first);
    expect(first?.querySelector('.ff-progress-text')?.textContent).toBe('2 of 8 filled in');
    // Another snippet, too short for the line: the line goes.
    redraw(api.fillForm(SHORT, {}, { now: NOW }));
    expect(host.parentElement?.querySelectorAll('.ff-progress')).toHaveLength(1);
    expect(first?.hidden).toBe(true);
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
