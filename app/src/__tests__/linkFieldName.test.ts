import { describe, expect, it } from 'vitest';
import { fieldNameFromWords, fieldNameTaken } from '@/lib/linkFieldName';

// The Fill from a pasted link entry names a new field after the word it reads
// on the page, so the form says what the field is. The name has to be one the
// engine accepts and one the snippet does not already use.

describe('fieldNameFromWords', () => {
  it('turns the word into a field name', () => {
    expect(fieldNameFromWords('Customer', '', 'TEXT_1')).toBe('CUSTOMER');
    expect(fieldNameFromWords('Start date', '', 'DATE_1')).toBe('START_DATE');
    expect(fieldNameFromWords('  Order no.  ', '', 'TEXT_1')).toBe('ORDER_NO');
  });

  it('drops accents and takes the first of several spellings', () => {
    expect(fieldNameFromWords('Référence', '', 'TEXT_1')).toBe('REFERENCE');
    expect(fieldNameFromWords('Start date|Starts', '', 'DATE_1')).toBe('START_DATE');
  });

  it('falls back when the word cannot be a name', () => {
    expect(fieldNameFromWords('', '', 'TEXT_1')).toBe('TEXT_1');
    expect(fieldNameFromWords('   ', '', 'TEXT_1')).toBe('TEXT_1');
    expect(fieldNameFromWords('2 boxes', '', 'NUM_1')).toBe('NUM_1');
    expect(fieldNameFromWords('***', '', 'TEXT_1')).toBe('TEXT_1');
  });

  it('falls back when the snippet already uses the name', () => {
    expect(fieldNameFromWords('Customer', 'Hi {formtext: name=CUSTOMER}', 'TEXT_1')).toBe('TEXT_1');
    expect(fieldNameFromWords('Customer', 'Hi {customer}', 'TEXT_1')).toBe('TEXT_1');
    expect(fieldNameFromWords('Customer', 'Hi {{CUSTOMER}}', 'TEXT_1')).toBe('TEXT_1');
    expect(fieldNameFromWords('Total', '{TOTAL=PRICE * 2}', 'NUM_1')).toBe('NUM_1');
    // A longer name that only starts the same is another field.
    expect(fieldNameFromWords('Customer', 'Hi {formtext: name=CUSTOMER_NAME}', 'TEXT_1')).toBe('CUSTOMER');
  });

  it('keeps a long word within a name the engine reads', () => {
    const long = fieldNameFromWords('Date of arrival at the main warehouse in the north', '', 'DATE_1');
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.startsWith('DATE_OF_ARRIVAL')).toBe(true);
    expect(long.endsWith('_')).toBe(false);
  });
});

describe('fieldNameTaken', () => {
  it('reads field tokens, placeholders and saved values, in any case', () => {
    expect(fieldNameTaken('{formdate: name=start; format=long}', 'START')).toBe(true);
    expect(fieldNameTaken('{START}', 'START')).toBe(true);
    expect(fieldNameTaken('{{ START }}', 'START')).toBe(true);
    expect(fieldNameTaken('{START = 1}', 'START')).toBe(true);
    expect(fieldNameTaken('{formdate: name=START_2}', 'START')).toBe(false);
    expect(fieldNameTaken('Start here', 'START')).toBe(false);
  });
});
