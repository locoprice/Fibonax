import { describe, expect, it } from 'vitest';
import {
  bodyItems,
  changedSpan,
  itemTitle,
  parseFormButtonToken,
  parseFormDateToken,
  parseFormNumberToken,
  parseFormTextToken,
  parseFormTimeToken,
  readersOf,
  renameInBody,
} from '@/lib/bodyItems';
import { buildFormButtonToken } from '@/lib/formButtonToken';
import { buildFormDateToken } from '@/lib/formDateToken';
import { buildFormNumberToken } from '@/lib/formNumberToken';
import { buildFormTextToken } from '@/lib/formTextToken';
import { buildFormTimeToken } from '@/lib/formTimeToken';
import { buildDateRangeToken } from '@/lib/dateRangeToken';

// Edit and Remove for every element (root CLAUDE.md): what the editor lists,
// and that reading an element into its window and writing it back loses nothing.

const QUOTE =
  'SENT {formdate: name=TIME_1; type=time; format=HH:mm} · {formdate: name=DATE_1; format=DD/MM/YYYY} - VALID FOR {formtext: name=HOURS; type=number; default=3} HOURS\n' +
  'IN: {formdate: name=START_1; format=DD/MM/YYYY}\nOUT: {formdate: name=END_1; after=START_1; format=DD/MM/YYYY}\n' +
  'NIGHTS: {= datespan(START_1,END_1,"between") }\n' +
  'Request: {formtext: name=JOTFORM_LINK}\nProperty: {formtext: name=PROPERTY_LINK; default=PORTFOLIO}\n' +
  'Room: {formmenu: Studio,One bedroom; name=Accommodation; default=Studio}\n' +
  'Pay: {formmenu: Card,Transfer; name=PAYMENT; default=Card; other=Other}\n' +
  'Price: {formtext: name=YOUR_PRICE; type=number; label=Your price}€\n' +
  '{button label="10% off" trim=left}YOUR_PRICE = YOUR_PRICE * 0.9{/button}\n' +
  'Sent {time: DD/MM/YYYY; shift=tomorrow} {greeting}\n' +
  '{{OLD_STYLE}} {if: YOUR_PRICE > 0}Saving{endif}';

describe('bodyItems: what the editor lists', () => {
  it('finds every field, button, automatic date and greeting, in order', () => {
    expect(bodyItems(QUOTE).map((i) => [i.kind, itemTitle(i)])).toEqual([
      ['time', 'TIME_1'],
      ['date', 'DATE_1'],
      ['number', 'HOURS'],
      ['date', 'START_1'],
      ['date', 'END_1'],
      ['text', 'JOTFORM_LINK'],
      ['text', 'PROPERTY_LINK'],
      ['menu', 'Accommodation'],
      ['menu', 'PAYMENT'],
      ['number', 'YOUR_PRICE'],
      ['button', '10% off'],
      ['auto', 'Automatic date'],
      ['greeting', 'Greeting'],
    ]);
  });

  it('can edit every element of a quote written by the builders', () => {
    const editable = bodyItems(QUOTE).filter((i) => i.kind !== 'greeting');
    expect(editable.every((i) => i.cfg !== null)).toBe(true);
  });

  it('gives each element the exact range Remove takes out', () => {
    for (const item of bodyItems(QUOTE)) expect(QUOTE.slice(item.start, item.end)).toBe(item.raw);
  });

  it('reads the fields a date range writes, including the rule on its closing date', () => {
    const range = buildDateRangeToken({ start: 'START_1', end: 'END_1', mode: 'inclusive', withFields: true, format: 'DD/MM/YYYY' });
    const end = bodyItems(range).find((i) => i.name === 'END_1');
    expect(end?.kind === 'date' ? end.cfg?.after : '').toBe('START_1');
  });
});

describe('bodyItems: read back, written again, nothing lost', () => {
  it('text', () => {
    const raw = buildFormTextToken({ name: 'GUEST', default: 'Ada', personName: true, link: 'after:Name' });
    expect(buildFormTextToken(parseFormTextToken(raw)!)).toBe(raw);
  });

  it('number', () => {
    const raw = buildFormNumberToken({ name: 'TOTAL', format: 'currency', currency: 'USD', default: '10', label: 'Total', link: 'before:Box|Boxes' });
    expect(buildFormNumberToken(parseFormNumberToken(raw)!)).toBe(raw);
  });

  it('date and time', () => {
    const date = buildFormDateToken({ name: 'END_1', kind: 'date', format: 'long', after: 'START_1' });
    const time = buildFormDateToken({ name: 'AT', kind: 'time', format: 'hh:mm A' });
    expect(buildFormDateToken(parseFormDateToken(date)!)).toBe(date);
    expect(buildFormDateToken(parseFormDateToken(time)!)).toBe(time);
  });

  it('button', () => {
    const raw = buildFormButtonToken({ label: 'Add fee', trim: 'yes', lines: [{ field: 'SUB', expr: 'A + B' }, { field: 'TOTAL', expr: 'SUB * 1.2' }] });
    expect(buildFormButtonToken(parseFormButtonToken(raw)!)).toBe(raw);
  });

  it('automatic date', () => {
    const raw = buildFormTimeToken({ format: 'DD/MM/YYYY HH:mm', shift: '+3D', at: '09:00' });
    expect(buildFormTimeToken(parseFormTimeToken(raw)!)).toBe(raw);
  });

  it('turns down a token holding a setting its window does not know', () => {
    expect(parseFormTextToken('{formtext: name=A; colour=red}')).toBeNull();
    expect(parseFormDateToken('{formdate: name=A; type=datetime}')).toBeNull();
    expect(parseFormNumberToken('{formtext: name=A; type=number; format=weird}')).toBeNull();
    expect(parseFormButtonToken('{button label="x" color=red}A = 1{/button}')).toBeNull();
    expect(parseFormTimeToken('{time: DD/MM/YYYY; shift=whenever}')).toBeNull();
  });

  it('reads settings in any order and spacing', () => {
    expect(parseFormTextToken('{formtext:default=Ada ;name=GUEST}')).toEqual({ name: 'GUEST', default: 'Ada', link: '' });
  });
});

describe('bodyItems: what reads a field', () => {
  const body = 'Price {formtext: name=P; type=number}\nCard {=P * 1.03}\n{if: P > 0}ok{endif}\n{button}P = P * 2{/button}\nP alone';

  it('counts formulas, rules and buttons that read it, and nothing in plain text', () => {
    const own = bodyItems(body)[0]!;
    expect(readersOf(body, 'P', own.start, own.end)).toBe(3);
  });

  it('renames those readers with the field, leaving the words around them', () => {
    const own = bodyItems(body)[0]!;
    const renamed = buildFormNumberToken({ name: 'PRICE', format: 'plain', currency: 'EUR', default: '' });
    const next = body.slice(0, own.start) + renamed + body.slice(own.end);
    expect(renameInBody(next, 'P', 'PRICE', own.start, own.start + renamed.length)).toBe(
      'Price {formtext: name=PRICE; type=number}\nCard {=PRICE * 1.03}\n{if: PRICE > 0}ok{endif}\n{button}PRICE = PRICE * 2{/button}\nP alone',
    );
  });

  it('finds the one stretch that changed', () => {
    expect(changedSpan('abcXYZdef', 'abcQdef')).toEqual({ start: 3, end: 6, text: 'Q' });
    expect(changedSpan('same', 'same')).toEqual({ start: 4, end: 4, text: '' });
  });
});
