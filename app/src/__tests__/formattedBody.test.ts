import { describe, expect, it } from 'vitest';
import {
  chipLabel,
  docFromPlain,
  docToHtml,
  docToPlain,
  hasFormatting,
  positionAt,
  replacePlainRange,
  segmentTokens,
  syncDoc,
  type FormattedDoc,
} from '@/lib/formattedBody';

// The formatted box's model: the plain body every builder reads, the layout an
// email gets, and how a change made elsewhere (a window's Insert, Remove, a
// rename) keeps the formatting around it.

const DOC: FormattedDoc = [
  { list: 'none', runs: [{ text: 'Hello ', marks: [] }, { text: '{formtext: name=WHO}', marks: ['b'] }, { text: ',', marks: [] }] },
  { list: 'number', runs: [{ text: 'We pack it', marks: [] }] },
  { list: 'number', runs: [{ text: 'You get a link', marks: ['i'] }] },
  { list: 'none', runs: [] },
  { list: 'bullet', runs: [{ text: 'Thanks', marks: ['b', 'u'] }] },
];

describe('the plain body', () => {
  it('is every line in order, list lines with their prefix', () => {
    expect(docToPlain(DOC)).toBe('Hello {formtext: name=WHO},\n1. We pack it\n2. You get a link\n\n• Thanks');
  });

  it('reads back an unformatted body line for line, with nothing formatted', () => {
    const doc = docFromPlain('a\r\n\nb');
    expect(docToPlain(doc)).toBe('a\n\nb');
    expect(hasFormatting(doc)).toBe(false);
    expect(hasFormatting(DOC)).toBe(true);
  });

  it('counts a numbered list again after a break', () => {
    const doc: FormattedDoc = [
      { list: 'number', runs: [{ text: 'a', marks: [] }] },
      { list: 'none', runs: [{ text: 'x', marks: [] }] },
      { list: 'number', runs: [{ text: 'b', marks: [] }] },
    ];
    expect(docToPlain(doc)).toBe('1. a\nx\n1. b');
  });
});

describe('the layout', () => {
  it('is one div a line, lists as lists, marks as tags, fields as escaped text', () => {
    expect(docToHtml(DOC)).toBe(
      '<div>Hello <b>{formtext: name=WHO}</b>,</div>' +
        '<ol><li>We pack it</li><li><i>You get a link</i></li></ol>' +
        '<div><br></div>' +
        '<ul><li><b><u>Thanks</u></b></li></ul>',
    );
    expect(docToHtml(docFromPlain('a < b & c'))).toBe('<div>a &lt; b &amp; c</div>');
  });
});

describe('a change made outside the box', () => {
  const plain = docToPlain(DOC);

  it('finds the line and character of a plain offset, past a list prefix', () => {
    expect(positionAt(DOC, plain.indexOf('We pack'))).toEqual({ block: 1, char: 0 });
    expect(positionAt(DOC, plain.indexOf('1. '))).toEqual({ block: 1, char: 0 });
  });

  it('keeps every mark when a field is renamed', () => {
    const renamed = syncDoc(DOC, plain.replace('name=WHO', 'name=CLIENT'));
    expect(renamed[0]?.runs).toEqual([
      { text: 'Hello ', marks: [] },
      { text: '{formtext: name=CLIENT}', marks: ['b'] },
      { text: ',', marks: [] },
    ]);
    expect(renamed.slice(1)).toEqual(DOC.slice(1));
  });

  it('inserts a code at the caret and keeps the lists', () => {
    const at = plain.indexOf('We pack it') + 'We pack it'.length;
    const next = syncDoc(DOC, `${plain.slice(0, at)} {picture: src=https://a.co/l.png}${plain.slice(at)}`);
    expect(next[1]).toEqual({ list: 'number', runs: [{ text: 'We pack it {picture: src=https://a.co/l.png}', marks: [] }] });
    expect(docToPlain(next)).toBe(docToPlain(DOC).replace('We pack it', 'We pack it {picture: src=https://a.co/l.png}'));
  });

  it('turns new lines starting with "• " or "1. " into list lines', () => {
    const next = replacePlainRange(docFromPlain('Intro'), 5, 5, '\n• one\n1. two\nend');
    expect(next.map((b) => b.list)).toEqual(['none', 'bullet', 'number', 'none']);
    expect(docToPlain(next)).toBe('Intro\n• one\n1. two\nend');
  });

  it('makes a list line plain when its prefix is taken out', () => {
    const next = syncDoc(DOC, plain.replace('• Thanks', 'Thanks'));
    expect(next[4]).toEqual({ list: 'none', runs: [{ text: 'Thanks', marks: ['b', 'u'] }] });
  });

  it('takes a removed line out whole', () => {
    const next = syncDoc(DOC, plain.replace('\n2. You get a link', ''));
    expect(docToPlain(next)).toBe('Hello {formtext: name=WHO},\n1. We pack it\n\n• Thanks');
    expect(next[2]).toEqual({ list: 'none', runs: [] });
  });

  it('leaves the document alone when nothing changed', () => {
    expect(syncDoc(DOC, plain)).toBe(DOC);
  });
});

describe('chips', () => {
  it('cuts a line into text and codes, a button whole', () => {
    expect(segmentTokens('Hi {NAME}, {{OLD}} {button label="x"}A = 1{/button} {unclosed')).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'token', raw: '{NAME}' },
      { kind: 'text', text: ', ' },
      { kind: 'token', raw: '{{OLD}}' },
      { kind: 'text', text: ' ' },
      { kind: 'token', raw: '{button label="x"}A = 1{/button}' },
      { kind: 'text', text: ' {unclosed' },
    ]);
  });

  it('says what each code is in plain words', () => {
    expect(chipLabel('{formtext: name=WHO; default=Ana}')).toBe('WHO');
    expect(chipLabel('{formmenu: A,B; name=PLAN}')).toBe('PLAN');
    expect(chipLabel('{picture: src=https://a.co/l.png; alt=Logo; size=small}')).toBe('Picture: Logo');
    expect(chipLabel('{if: PLAN = "A"}')).toBe('If PLAN = "A"');
    expect(chipLabel('{endif}')).toBe('End of rule');
    expect(chipLabel('{= PRICE * 2}')).toBe('= PRICE * 2');
    expect(chipLabel('{button label="10% off"}P = 1{/button}')).toBe('Button: 10% off');
    expect(chipLabel('{greeting}')).toBe('Greeting');
  });
});
