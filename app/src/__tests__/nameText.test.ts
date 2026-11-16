import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { nameFromEvent, readNameInput, sanitizeName, type NameBox } from '@/lib/nameText';

/** A text box holding `value` with the caret at `caret`, recording where it is put. */
function box(value: string, caret: number | null = value.length): NameBox & { caret: number | null } {
  return {
    value,
    selectionStart: caret,
    caret,
    setSelectionRange(start: number) {
      this.caret = start;
      this.selectionStart = start;
    },
  };
}

describe('sanitizeName', () => {
  it('turns every letter into a capital', () => {
    expect(sanitizeName('quote english')).toBe('QUOTE ENGLISH');
    expect(sanitizeName('Quote English')).toBe('QUOTE ENGLISH');
    expect(sanitizeName('TIME')).toBe('TIME');
  });

  it('capitalises accented letters and other scripts', () => {
    expect(sanitizeName('città')).toBe('CITTÀ');
    expect(sanitizeName('Añadir número 3')).toBe('AÑADIR NÚMERO 3');
    expect(sanitizeName('привет')).toBe('ПРИВЕТ');
  });

  it('keeps digits, spaces and punctuation', () => {
    expect(sanitizeName('a-b_c (x). 42')).toBe('A-B_C (X). 42');
  });

  it('drops single emoji, joined sequences, flags, keycaps and skin tones', () => {
    expect(sanitizeName('😀 Hello')).toBe(' HELLO');
    expect(sanitizeName('Team 👨‍👩‍👧')).toBe('TEAM ');
    expect(sanitizeName('🇮🇹IT')).toBe('IT');
    expect(sanitizeName('Step 3️⃣')).toBe('STEP 3');
    expect(sanitizeName('Ok👍🏽')).toBe('OK');
  });

  it('returns an empty string for an emoji-only name', () => {
    expect(sanitizeName('🔥✨')).toBe('');
  });
});

describe('readNameInput', () => {
  it('writes the capitals back into the box', () => {
    const typed = box('quote');
    expect(readNameInput(typed)).toBe('QUOTE');
    expect(typed.value).toBe('QUOTE');
  });

  it('keeps the caret where it was when a letter is typed mid-name', () => {
    // "QUOTE ENGLISH" with an "x" typed after QUOTE: the caret sits after it.
    const typed = box('QUOTEx ENGLISH', 6);
    expect(readNameInput(typed)).toBe('QUOTEX ENGLISH');
    expect(typed.caret).toBe(6);
  });

  it('moves the caret back by what was dropped before it', () => {
    const pasted = box('ab😀cd', 4);
    expect(readNameInput(pasted)).toBe('ABCD');
    expect(pasted.caret).toBe(2);
  });

  it('moves the caret forward when one letter becomes two', () => {
    const typed = box('straße', 5);
    expect(readNameInput(typed)).toBe('STRASSE');
    expect(typed.caret).toBe(6);
  });

  it('leaves a box that is already clean untouched', () => {
    const clean = box('QUOTE 3', 2);
    let moved = false;
    clean.setSelectionRange = () => { moved = true; };
    expect(readNameInput(clean)).toBe('QUOTE 3');
    expect(moved).toBe(false);
  });

  it('puts the caret at the end when the box reports none', () => {
    const typed = box('abc', null);
    readNameInput(typed);
    expect(typed.caret).toBe(3);
  });
});

describe('nameFromEvent', () => {
  it('cleans the box on an ordinary change', () => {
    const typed = box('hello');
    expect(nameFromEvent({ currentTarget: typed, nativeEvent: { isComposing: false } as unknown as Event })).toBe('HELLO');
    expect(typed.value).toBe('HELLO');
  });

  it('leaves the box alone while a letter is being composed', () => {
    const typed = box('caf´');
    expect(nameFromEvent({ currentTarget: typed, nativeEvent: { isComposing: true } as unknown as Event })).toBe('caf´');
    expect(typed.value).toBe('caf´');
  });

  it('cleans the box when the composition ends', () => {
    // A composition-end event carries no isComposing flag at all.
    const typed = box('café');
    expect(nameFromEvent({ currentTarget: typed, nativeEvent: {} as Event })).toBe('CAFÉ');
    expect(typed.value).toBe('CAFÉ');
  });
});

// The phone page cannot load this module, so it keeps its own copy of the
// rule. Its real functions are cut out of the page and run here.
describe('the phone keeps the same rule', () => {
  const page = readFileSync(resolve(process.cwd(), 'public', 'mobile', 'index.html'), 'utf8');
  const emojiFrom = page.indexOf('var MEM_NAME_EMOJI=');
  const emojiTo = page.indexOf('})();', emojiFrom) + '})();'.length;
  const rulesFrom = page.indexOf('function memCleanName(');
  const rulesTo = page.indexOf('function memPlural(', rulesFrom);

  interface Phone {
    memCleanName(value: unknown): string;
    memWatchName(box: unknown): void;
    memNameToSave(box: { value: string }, saved: string | null): string;
  }
  const phone = vm.runInNewContext(
    `${page.slice(emojiFrom, emojiTo)}\n${page.slice(rulesFrom, rulesTo)}\n({ memCleanName, memWatchName, memNameToSave })`,
  ) as Phone;

  it('finds the phone functions where they are expected', () => {
    expect(emojiFrom).toBeGreaterThan(-1);
    expect(rulesFrom).toBeGreaterThan(-1);
    expect(rulesTo).toBeGreaterThan(rulesFrom);
  });

  it('cleans a name exactly as the dashboard does', () => {
    for (const name of ['quote english', 'Città', 'Añadir número 3', 'a-b_c (x). 42', '😀 Hello', 'Team 👨‍👩‍👧', 'Step 3️⃣', 'straße', '🔥✨', '']) {
      expect(phone.memCleanName(name)).toBe(sanitizeName(name));
    }
  });

  /** A phone text box that records its listeners, as far as memWatchName uses one. */
  function phoneBox(value: string, caret: number) {
    const listeners: Record<string, (event: { isComposing?: boolean }) => void> = {};
    return {
      value,
      selectionStart: caret,
      setSelectionRange(start: number) { this.selectionStart = start; },
      addEventListener(type: string, fn: (event: { isComposing?: boolean }) => void) { listeners[type] = fn; },
      fire(type: string, event: { isComposing?: boolean } = {}) { listeners[type]?.(event); },
    };
  }

  it('turns typing into capitals and keeps the caret in place', () => {
    const typed = phoneBox('QUOTEx ENGLISH', 6);
    phone.memWatchName(typed);
    typed.fire('input', { isComposing: false });
    expect([typed.value, typed.selectionStart]).toEqual(['QUOTEX ENGLISH', 6]);
  });

  it('waits for the keyboard to finish a word before touching the box', () => {
    const typed = phoneBox('hel', 3);
    phone.memWatchName(typed);
    typed.fire('input', { isComposing: true });
    expect(typed.value).toBe('hel');
    typed.fire('compositionend');
    expect(typed.value).toBe('HEL');
  });

  it('sends a new or edited name in capitals', () => {
    expect(phone.memNameToSave({ value: ' opening hours ' }, null)).toBe('OPENING HOURS');
    expect(phone.memNameToSave({ value: 'Opening hours 2' }, 'Opening hours')).toBe('OPENING HOURS 2');
  });

  it('sends a saved name the person did not touch exactly as it was', () => {
    expect(phone.memNameToSave({ value: 'Opening hours' }, 'Opening hours')).toBe('Opening hours');
  });
});
