import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bodyItems, itemDetail, itemTitle } from '@/lib/bodyItems';
import type { SbFillFormViewModel } from '@/lib/fillFormEngine';
import { chipLabel } from '@/lib/formattedBody';
import { MY_DETAIL_WORDS, myToken, type SbMyDetailsApi } from '@/lib/myDetails';
import { SEASONAL_TOKEN, SEASON_LANGS, YEAR_TOKEN, type Occasion, type SbSeasonApi } from '@/lib/season';

// The seasonal line ({seasonal}): a snippet prints the sentence of the occasion
// in season and nothing for the rest of the year. The rules live once, in
// extension/shared/season.js; the engine prints what it answers and the fill
// form shows the row that leaves it out. The REAL files are loaded here, the
// ones the extension ships, so what the dashboard's types promise is what they
// do. scripts/check-snippets.js holds the phone's own resolver to the engine.
type Requirer = (id: string) => unknown;

function loadShared<T>(path: string, req?: Requirer): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', 'require', src) as (
    m: typeof mod,
    e: unknown,
    r: Requirer,
  ) => void;
  run(mod, mod.exports, req ?? (() => ({})));
  return mod.exports as T;
}

interface SeasonModule extends SbSeasonApi {
  META_KEY: string;
  STORAGE_KEY: string;
  get(): unknown[];
  easterSunday(year: number): { month: number; day: number };
  currentLine(lang: string, now?: Date): string;
  describe(body: string, lang: string, now?: Date, off?: boolean): SbFillFormViewModel['season'];
}

interface Engine {
  resolveBody(body: string, vals: Record<string, string>, opts?: Record<string, unknown>): string;
  extractFields(body: string): string[];
}

interface FillForm {
  fillForm(text: string, values: Record<string, string>, opts: Record<string, unknown>): SbFillFormViewModel;
}

const EXT = resolve(process.cwd(), '..', 'extension');
const season = loadShared<SeasonModule>(resolve(EXT, 'shared', 'season.js'));
const engine = loadShared<Engine>(resolve(EXT, 'formula-engine.js'));
const ff = loadShared<FillForm>(resolve(EXT, 'shared', 'fill-form.js'), (id) => {
  if (id === '../formula-engine.js') return engine;
  throw new Error(`fill-form.js asked for an unexpected module: ${id}`);
});

// Midday, so no clock change can move the day.
const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 12);
const idOn = (date: Date, raw?: unknown) => season.active(date, raw)?.id ?? null;
const nameOn = (date: Date, raw: unknown) => season.active(date, raw)?.name ?? null;

const details = loadShared<SbMyDetailsApi>(resolve(EXT, 'shared', 'my-details.js'));
const scope = globalThis as unknown as { SBSeason?: SeasonModule; SBMyDetails?: SbMyDetailsApi };

beforeAll(() => {
  // The engine, the fill form and the wishes read the page's own modules, as on every surface.
  scope.SBSeason = season;
  scope.SBMyDetails = details;
});

afterAll(() => {
  season.set([]);
  details.set(null);
  delete scope.SBSeason;
  delete scope.SBMyDetails;
});

describe('the calendar as it ships', () => {
  it('has three ready occasions, all on, with no sentence of the person’s own', () => {
    const none = { EN: '', IT: '', ES: '', FR: '' };
    expect(season.list([]).map((o) => [o.id, o.ready, o.on, o.texts])).toEqual([
      ['christmas', true, true, none],
      ['newyear', true, true, none],
      ['easter', true, true, none],
    ]);
  });

  it('puts Christmas in season from 8 to 26 December', () => {
    expect(idOn(day(2026, 12, 7), [])).toBeNull();
    expect(idOn(day(2026, 12, 8), [])).toBe('christmas');
    expect(idOn(day(2026, 12, 26), [])).toBe('christmas');
  });

  it('carries New Year over the end of the year, to 6 January', () => {
    expect(idOn(day(2026, 12, 27), [])).toBe('newyear');
    expect(idOn(day(2027, 1, 6), [])).toBe('newyear');
    expect(idOn(day(2027, 1, 7), [])).toBeNull();
  });

  it('finds Easter every year: a week before to the day after', () => {
    expect(season.easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(season.easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(idOn(day(2026, 3, 28), [])).toBeNull();
    expect(idOn(day(2026, 3, 29), [])).toBe('easter');
    expect(idOn(day(2026, 4, 6), [])).toBe('easter');
    expect(idOn(day(2026, 4, 7), [])).toBeNull();
    expect(idOn(day(2027, 3, 28), [])).toBe('easter');
  });

  it('is out of season most of the year, and says what comes next', () => {
    expect(idOn(day(2026, 11, 21), [])).toBeNull();
    const next = season.next(day(2026, 11, 21), []);
    expect([next?.occasion.id, next?.day, next?.month]).toEqual(['christmas', 8, 12]);
  });
});

describe('one occasion at a time', () => {
  const OWN = [
    { name: 'Summer closing', from: '08-10', to: '08-25', texts: { EN: 'We are closed until 25 August.' } },
    { name: 'Mid August', from: '08-14', to: '08-16', texts: { EN: 'Back on the 17th.' } },
  ];

  it('lets the person’s own occasion win over a ready one', () => {
    const raw = [{ name: 'Winter break', from: '12-20', to: '12-31', texts: { EN: 'Back on 2 January.' } }];
    expect(nameOn(day(2026, 12, 19), raw)).toBe('Christmas');
    expect(nameOn(day(2026, 12, 24), raw)).toBe('Winter break');
    expect(nameOn(day(2026, 12, 28), raw)).toBe('Winter break');
  });

  it('then picks the one whose day is closest', () => {
    expect(nameOn(day(2026, 8, 12), OWN)).toBe('Summer closing');
    expect(nameOn(day(2026, 8, 15), OWN)).toBe('Mid August');
    expect(nameOn(day(2026, 8, 20), OWN)).toBe('Summer closing');
  });

  it('then the one with the shorter period', () => {
    const raw = [
      { name: 'Long', from: '05-01', to: '05-31', texts: { EN: 'Long.' } },
      { name: 'Short', from: '05-01', to: '05-07', texts: { EN: 'Short.' } },
    ];
    expect(nameOn(day(2026, 5, 3), raw)).toBe('Short');
    expect(nameOn(day(2026, 5, 20), raw)).toBe('Long');
  });

  it('never picks one that is switched off, or one with nothing to print', () => {
    expect(idOn(day(2026, 12, 15), [{ id: 'christmas', on: false }])).toBeNull();
    expect(idOn(day(2026, 8, 12), [{ name: 'Empty', from: '08-10', to: '08-25', texts: {} }])).toBeNull();
  });
});

describe('what is stored', () => {
  it('stores nothing for a calendar left as it ships', () => {
    expect(season.pack(season.list([]))).toEqual([]);
  });

  it('keeps a ready occasion only where it was changed, and an own one in full', () => {
    const raw = [
      { id: 'christmas', on: false },
      { id: 'easter', before: 10, texts: { EN: 'Happy Easter to you.' } },
      { name: 'Summer closing', from: '08-10', to: '08-25', texts: { EN: 'We are closed until 25 August.' } },
    ];
    expect(season.pack(season.list(raw))).toEqual(raw);
  });

  it('leaves out anything damaged, and no more than the calendar holds', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ name: `Own ${i}`, from: '03-01', to: '03-02', texts: { EN: 'x' } }));
    const raw = [null, 'x', { name: '', from: '03-01', to: '03-02' }, { name: 'Bad day', from: '02-30', to: '03-02' },
      { id: 'christmas', from: '13-01', to: 'soon', on: 'no' }, ...many];
    const list = season.list(raw);
    expect(list.filter((o) => !o.ready)).toHaveLength(season.MAX_OWN);
    expect(list.find((o) => o.id === 'christmas')).toMatchObject({ from: '12-08', to: '12-26', on: true });
    expect(season.list('not a list')).toHaveLength(3);
  });

  it('keeps a name and a sentence on one line and within their length', () => {
    const [own] = season.list([{ name: `  A\nname ${'x'.repeat(60)}`, from: '03-01', to: '03-02', texts: { EN: `two\nlines ${'y'.repeat(300)}` } }])
      .filter((o) => !o.ready) as Occasion[];
    expect(own?.name.length).toBe(season.MAX_NAME);
    expect(own?.name.startsWith('A name')).toBe(true);
    expect(own?.texts.EN.length).toBe(season.MAX_TEXT);
    expect(own?.texts.EN.includes('\n')).toBe(false);
  });
});

describe('the words', () => {
  it('speaks the snippet’s language for a ready occasion, English for any other', () => {
    expect(season.currentLine('IT', day(2026, 12, 15))).toBe('Buon Natale.');
    expect(season.currentLine('es-ES', day(2026, 12, 15))).toBe('Feliz Navidad.');
    expect(season.currentLine('FR', day(2027, 1, 2))).toBe('Bonne année.');
    expect(season.currentLine('DE', day(2026, 4, 5))).toBe('Happy Easter.');
    expect(season.currentLine('', day(2026, 12, 15))).toBe('Merry Christmas.');
  });

  it('prints the person’s own sentence in its language, the ready words in the others', () => {
    season.set([{ id: 'christmas', texts: { EN: 'Warm wishes from all of us.' } }]);
    expect(season.currentLine('EN', day(2026, 12, 15))).toBe('Warm wishes from all of us.');
    expect(season.currentLine('IT', day(2026, 12, 15))).toBe('Buon Natale.');
    season.set([]);
  });

  it('says a period the way a person would', () => {
    const [christmas, , easter] = season.list([]);
    expect(season.periodLabel(christmas ?? null)).toBe('8 December to 26 December');
    expect(season.periodLabel(easter ?? null)).toBe('7 days before Easter to 1 day after');
  });
});

describe('the engine', () => {
  it('prints what a fill form decided, and leaves no trace when that is nothing', () => {
    const body = 'Hello,\n\n{seasonal}\n\nBest regards';
    expect(engine.resolveBody(body, {}, { seasonal: 'Merry Christmas.' })).toBe('Hello,\n\nMerry Christmas.\n\nBest regards');
    expect(engine.resolveBody(body, {}, { seasonal: '' })).toBe('Hello,\n\nBest regards');
    expect(engine.resolveBody('Thanks. {seasonal} See you.', {}, { seasonal: '' })).toBe('Thanks. See you.');
  });

  it('asks the calendar when nobody decided for it', () => {
    season.set([{ name: 'All year', from: '01-01', to: '12-31', texts: { EN: 'Open all year.' } }]);
    expect(engine.resolveBody('Hi\n{seasonal}\nBye', {}, { lang: 'EN' })).toBe('Hi\nOpen all year.\nBye');
    season.set([{ id: 'christmas', on: false }, { id: 'newyear', on: false }, { id: 'easter', on: false }]);
    expect(engine.resolveBody('Hi\n{seasonal}\nBye', {}, { lang: 'EN' })).toBe('Hi\nBye');
    season.set([]);
  });

  it('is not a field, and a field that only starts like it still is', () => {
    expect(engine.extractFields('{seasonal} {Seasonal} {seasonally}')).toEqual(['seasonally']);
  });
});

describe('the fill form', () => {
  const BODY = 'Hello {formtext: name=NAME},\n\n{seasonal}\n\nBest regards';
  const LAYOUT = '<div>Hello {formtext: name=NAME},</div><div><br></div><div>{seasonal}</div><div><br></div><div>Best regards</div>';
  const view = (now: Date, opts: Record<string, unknown> = {}) =>
    ff.fillForm(BODY, { NAME: 'Ada' }, { lang: 'EN', now, ...opts });

  it('in season: says what goes in, and puts it in the text and the layout', () => {
    const vm = view(day(2026, 12, 15), { formatted: LAYOUT });
    expect(vm.season).toMatchObject({ active: true, id: 'christmas', off: false, label: 'Christmas wishes included', action: 'Leave out' });
    expect(vm.preview).toBe('Hello Ada,\n\nMerry Christmas.\n\nBest regards');
    expect(vm.formatted).toBe('<div>Hello Ada,</div><div><br></div><div>Merry Christmas.</div><div><br></div><div>Best regards</div>');
  });

  it('Leave out takes it out of both, this once, and offers to put it back', () => {
    const vm = view(day(2026, 12, 15), { formatted: LAYOUT, seasonOff: true });
    expect(vm.season).toMatchObject({ active: true, off: true, label: 'Christmas wishes left out', action: 'Put back' });
    expect(vm.preview).toBe('Hello Ada,\n\nBest regards');
    expect(vm.formatted).toBe('<div>Hello Ada,</div><div><br></div><div>Best regards</div>');
  });

  it('out of season: nothing in the text, and a note for the editor’s preview', () => {
    const vm = view(day(2026, 11, 21));
    expect(vm.season).toMatchObject({ active: false, label: '', note: 'The seasonal line prints nothing today. Christmas starts on 8 December.' });
    expect(vm.preview).toBe('Hello Ada,\n\nBest regards');
  });

  it('names an own occasion in its row', () => {
    season.set([{ name: 'Summer closing', from: '08-10', to: '08-25', texts: { EN: 'We are closed until 25 August.' } }]);
    expect(view(day(2026, 8, 12)).season).toMatchObject({ label: 'Summer closing: line included', text: 'We are closed until 25 August.' });
    season.set([]);
  });

  it('has no row for a text without the line, and asks for no extra field', () => {
    const vm = ff.fillForm('Hello {formtext: name=NAME}', {}, { now: day(2026, 12, 15) });
    expect(vm.season).toBeNull();
    expect(view(day(2026, 12, 15)).fields.map((f) => f.key)).toEqual(['NAME']);
  });
});

describe('the editor', () => {
  it('inserts the token the module reads', () => {
    expect(SEASONAL_TOKEN).toBe(season.TOKEN);
    expect(season.hasLine(`Hi\n${SEASONAL_TOKEN}`)).toBe(true);
  });

  it('lists a seasonal line with Edit, and the exact range Remove takes out', () => {
    const body = `Hello\n${SEASONAL_TOKEN}\n{ Seasonal } {seasonally}`;
    const lines = bodyItems(body).filter((i) => i.kind === 'seasonal');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(itemTitle(line)).toBe('Seasonal line');
      expect(itemDetail(line)).toBe('Your wishes, by time of year');
      // Not null: Edit opens Your occasions, and nothing in the token can be lost.
      expect(line.cfg).not.toBeNull();
      expect(body.slice(line.start, line.end)).toBe(line.raw);
    }
    const first = lines[0];
    expect(first ? body.slice(0, first.start) + body.slice(first.end) : '').toBe('Hello\n\n{ Seasonal } {seasonally}');
  });

  it('shows it as a chip in a formatted body', () => {
    expect(chipLabel('{seasonal}')).toBe('Seasonal line');
    expect(chipLabel('{seasonally}')).toBe('seasonally');
  });

  it('saves the occasions under the key every surface reads', () => {
    const api = readFileSync(resolve(process.cwd(), 'src', 'lib', 'api', 'settingsApi.ts'), 'utf8');
    expect(api).toContain(`const OCCASIONS_KEY = '${season.META_KEY}';`);
    expect(api).toContain(`const OCCASIONS_MAX = ${season.MAX_OWN + 3};`);
  });
});

describe('wishes per language, with the account details', () => {
  const CHRISTMAS = [{ id: 'christmas', texts: { EN: 'Merry Christmas from {my: company}.', IT: 'Buon Natale da {my: company}.' } }];

  it('picks the sentence of the snippet’s language, and the ready words where none is written', () => {
    details.set({ company: 'LeibTour' });
    season.set(CHRISTMAS);
    expect(season.currentLine('IT', day(2026, 12, 15))).toBe('Buon Natale da LeibTour.');
    expect(season.currentLine('en-GB', day(2026, 12, 15))).toBe('Merry Christmas from LeibTour.');
    expect(season.currentLine('ES', day(2026, 12, 15))).toBe('Feliz Navidad.');
    season.set([]);
  });

  it('never sends a wish half filled: a missing detail brings back the ready words', () => {
    details.set({ name: 'Ada' });
    season.set(CHRISTMAS);
    expect(season.currentLine('IT', day(2026, 12, 15))).toBe('Buon Natale.');
    season.set([]);
  });

  it('prints nothing for an own occasion whose detail is missing, and its other language when its own is not written', () => {
    details.set({});
    season.set([{ name: 'All year', from: '01-01', to: '12-31', texts: { IT: 'Saluti da {my: company}.' } }]);
    expect(season.currentLine('EN', day(2026, 6, 1))).toBe('');
    details.set({ company: 'Acme' });
    expect(season.currentLine('EN', day(2026, 6, 1))).toBe('Saluti da Acme.');
    season.set([]);
  });

  it('names the year of the occasion’s own day, already the new one on 28 December', () => {
    details.set({});
    season.set([{ id: 'newyear', texts: { EN: `Happy ${YEAR_TOKEN}!` } }]);
    expect(season.currentLine('EN', day(2026, 12, 28))).toBe('Happy 2027!');
    expect(season.currentLine('EN', day(2027, 1, 3))).toBe('Happy 2027!');
    const [, newYear] = season.list(season.get());
    expect(season.yearOf(newYear ?? null, day(2026, 11, 21))).toBe(2027);
    season.set([]);
  });

  it('keeps one sentence per language, and only the written ones', () => {
    const packed = season.pack(season.list([{ id: 'easter', texts: { FR: 'Joyeuses Pâques à tous.', XX: 'no' } }]));
    expect(packed).toEqual([{ id: 'easter', texts: { FR: 'Joyeuses Pâques à tous.' } }]);
    expect(SEASON_LANGS).toEqual(['EN', 'IT', 'ES', 'FR']);
  });

  it('refuses a calendar too long for the account to keep', () => {
    const long = 'x'.repeat(season.MAX_TEXT);
    const full = Array.from({ length: season.MAX_OWN }, (_, i) => ({
      name: `Own ${i}`, from: '03-01', to: '03-02', texts: { EN: long, IT: long, ES: long, FR: long },
    }));
    expect(season.fits(season.pack(season.list(full)))).toBe(false);
    expect(season.fits(season.pack(season.list(full.slice(0, 2))))).toBe(true);
  });
});

describe('your details in a snippet', () => {
  it('prints the account’s details and leaves no line where one is missing', () => {
    details.set({ name: 'Ada Rossi', company: 'Acme' });
    expect(engine.resolveBody('Best regards\n{my: name}\n{my: job title}\n{my: company}', {}, {})).toBe('Best regards\nAda Rossi\nAcme');
    details.set(null);
  });

  it('writes and reads back the token the module knows, for every detail', () => {
    for (const d of MY_DETAIL_WORDS) {
      expect(myToken(d.word)).toBe(details.token(d.word));
      expect(details.label(d.word)).toBe(d.label);
      const [item] = bodyItems(`Hi ${myToken(d.word)}`);
      expect(item?.kind).toBe('mine');
      expect(itemTitle(item as NonNullable<typeof item>)).toBe(d.label);
      expect(chipLabel(myToken(d.word))).toBe(d.label);
    }
  });

  it('is never a field, and lists an unknown detail so it can be removed', () => {
    expect(engine.extractFields('{my: company} {my_company}')).toEqual(['my_company']);
    const [item] = bodyItems('{my: shoe size}');
    expect(item ? itemDetail(item) : '').toBe('Not one of your details');
  });

  it('reports which details a sentence needs that the account lacks', () => {
    details.set({ company: 'Acme' });
    expect(details.missingIn('From {my: company}, {my: job title} and {my: name}')).toEqual(['job title', 'name']);
    expect(details.fill('From {my: company}.')).toBe('From Acme.');
    expect(details.fill('From {my: name}.')).toBeNull();
    details.set(null);
  });
});
