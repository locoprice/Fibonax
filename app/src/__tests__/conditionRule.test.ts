import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildRuleCondition,
  buildRuleToken,
  defaultOperator,
  eachOptionError,
  findRuleAt,
  isValidRule,
  mergeEdits,
  operatorsFor,
  parseRuleCondition,
  parseRuleNumber,
  relocateRule,
  RULE_OPERATORS,
  ruleExcerpt,
  ruleFieldKind,
  rulesInBody,
  ruleTextError,
  ruleValueError,
  summarizeRule,
  summaryText,
  type ConditionRule,
  type RuleFieldKind,
} from '@/lib/conditionRule';
import { buildFormulaToken, buildInterestToken, buildPriceAdjustToken } from '@/lib/formulaToken';
import { buildFormMenuToken, menuTokensIn, setMenuPrint } from '@/lib/formMenuToken';
import type { SbFillFormViewModel } from '@/lib/fillFormEngine';

// The dashboard writes the rule and the shipping engine resolves it, so the
// round trip runs against the REAL engine: a rule that reads right in the window
// and prints the wrong branch in the message is the defect this guards.
type Requirer = (id: string) => unknown;

function loadHelper<T>(path: string, req?: Requirer): T {
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

interface FormulaEngine {
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
  validateTemplate: (body: string) => { ok: boolean };
  sbToNumber: (raw: unknown) => number | null;
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

// The fill form every surface draws, whose preview is what the operator reads
// before inserting. It reaches for the engine by a path relative to itself.
const fillForm = loadHelper<{
  fillForm: (text: string, values: Record<string, string>, opts: Record<string, unknown>) => SbFillFormViewModel;
}>(resolve(process.cwd(), '..', 'extension', 'shared', 'fill-form.js'), (id) => {
  if (id === '../formula-engine.js') return engine;
  throw new Error(`fill-form.js asked for an unexpected module: ${id}`);
});

function rule(patch: Partial<ConditionRule>): ConditionRule {
  return {
    field: 'PLAN',
    operator: 'equals',
    value: 'annual',
    action: 'show',
    content: 'Two months free.',
    otherwise: '',
    ...patch,
  };
}

/** Writes the rule, then expands it with `vals` through the engine. */
function expand(r: ConditionRule, kind: RuleFieldKind, vals: Record<string, string>): string {
  return engine.resolveBody(`A ${buildRuleToken(r, kind)} B`, vals);
}

describe('conditionRule — the checks', () => {
  it('offers the seven checks, each only where it means something', () => {
    expect(RULE_OPERATORS.map((op) => op.id)).toEqual([
      'eachOption', 'equals', 'notEquals', 'greaterThan', 'lessThan', 'contains', 'isFilled',
    ]);
    expect(operatorsFor('number').map((op) => op.id)).not.toContain('contains');
    expect(operatorsFor('choice').map((op) => op.id)).not.toContain('greaterThan');
    expect(operatorsFor('text')).toHaveLength(6);
    // Each option needs one answer at a time: a single choice only.
    expect(operatorsFor('choice').map((op) => op.id)[0]).toBe('eachOption');
    expect(operatorsFor('choice', true).map((op) => op.id)).not.toContain('eachOption');
    expect(operatorsFor('text').map((op) => op.id)).not.toContain('eachOption');
  });

  it('opens a single choice on Each option, a multiple one on Contains, the rest on Equals', () => {
    expect(defaultOperator('choice', true)).toBe('contains');
    expect(defaultOperator('choice', false)).toBe('eachOption');
    expect(defaultOperator('number')).toBe('equals');
    expect(defaultOperator('text')).toBe('equals');
  });

  it('reads the fill form types it can compare, and no dates', () => {
    expect(ruleFieldKind('text')).toBe('text');
    expect(ruleFieldKind('number')).toBe('number');
    expect(ruleFieldKind('dd')).toBe('choice');
    expect(ruleFieldKind('date')).toBeNull();
    expect(ruleFieldKind('time')).toBeNull();
    expect(ruleFieldKind('datetime')).toBeNull();
  });
});

describe('conditionRule — writing', () => {
  it('writes each check in the engine syntax', () => {
    const at = (patch: Partial<ConditionRule>, kind: RuleFieldKind = 'text') =>
      buildRuleCondition(rule(patch), kind);
    expect(at({})).toBe('PLAN = "annual"');
    expect(at({ operator: 'notEquals' })).toBe('PLAN != "annual"');
    expect(at({ operator: 'contains', value: 'ann' })).toBe('PLAN contains "ann"');
    expect(at({ operator: 'isFilled' })).toBe('PLAN != ""');
    expect(at({ field: 'SCORE', operator: 'greaterThan', value: '10' })).toBe('SCORE > 10');
    expect(at({ field: 'SCORE', operator: 'lessThan', value: '2,5' })).toBe('SCORE < 2.5');
    // A number field compares as a number, so 10,00 equals 10.
    expect(at({ field: 'SCORE', value: '10' }, 'number')).toBe('SCORE == 10');
    expect(at({ field: 'SCORE', operator: 'notEquals', value: '10' }, 'number')).toBe('SCORE != 10');
    // The value is trimmed: a trailing space would never match.
    expect(at({ value: ' annual ' })).toBe('PLAN = "annual"');
  });

  it('writes show, show with an alternative, and hide', () => {
    expect(buildRuleToken(rule({}), 'text')).toBe('{if: PLAN = "annual"}Two months free.{endif}');
    expect(buildRuleToken(rule({ otherwise: 'Pay monthly.' }), 'text')).toBe(
      '{if: PLAN = "annual"}Two months free.{else}Pay monthly.{endif}',
    );
    expect(buildRuleToken(rule({ action: 'hide', otherwise: 'ignored' }), 'text')).toBe(
      '{if: PLAN = "annual"}{else}Two months free.{endif}',
    );
  });

  it('reads numbers the way people type them', () => {
    expect(parseRuleNumber('10')).toBe('10');
    expect(parseRuleNumber(' 2,5 ')).toBe('2.5');
    expect(parseRuleNumber('-3.75')).toBe('-3.75');
    expect(parseRuleNumber('ten')).toBeNull();
    expect(parseRuleNumber('1.200,50')).toBeNull();
    expect(parseRuleNumber('')).toBeNull();
  });

  it('reads thousands the way the engine reads the answer', () => {
    // "greater than 1.500" next to an answer of "1.600" must compare 1500 with
    // 1600, not 1.5 with 1600.
    for (const typed of ['1.500', '1,500', '-2.400', '999.999', '1.5', '12,50', '0.125', '1234.567', '1.2345']) {
      expect(Number(parseRuleNumber(typed))).toBe(engine.sbToNumber(typed));
    }
    expect(parseRuleNumber('1.500')).toBe('1500');
    expect(parseRuleNumber('0,125')).toBe('0.125');
  });

  it('refuses what would break the token or the block', () => {
    expect(ruleValueError('equals', '', 'text')).not.toBe('');
    expect(ruleValueError('equals', 'say "hi"', 'text')).not.toBe('');
    expect(ruleValueError('contains', 'a}b', 'text')).not.toBe('');
    expect(ruleValueError('greaterThan', 'ten', 'text')).not.toBe('');
    expect(ruleValueError('equals', 'ten', 'number')).not.toBe('');
    expect(ruleValueError('isFilled', '', 'text')).toBe('');
    expect(ruleTextError('', true)).not.toBe('');
    expect(ruleTextError('', false)).toBe('');
    expect(ruleTextError('a {if: X}b', true)).not.toBe('');
    expect(ruleTextError('a {else} b', true)).not.toBe('');
    expect(ruleTextError('a {endif}', true)).not.toBe('');
    // A field named like a branch tag is still a field.
    expect(ruleTextError('Hello {elsewhere}', true)).toBe('');
    expect(isValidRule(rule({}), 'text')).toBe(true);
    expect(isValidRule(rule({ field: '1PLAN' }), 'text')).toBe(false);
    expect(isValidRule(rule({ operator: 'contains' }), 'number')).toBe(false);
    expect(isValidRule(rule({ otherwise: '{endif}' }), 'text')).toBe(false);
    // Hide ignores the alternative, so a bad one does not block it.
    expect(isValidRule(rule({ action: 'hide', otherwise: '{endif}' }), 'text')).toBe(true);
  });
});

describe('conditionRule — the engine prints the right branch', () => {
  it('equals ignores case, and the alternative prints when it fails', () => {
    const r = rule({ otherwise: 'Pay monthly.' });
    expect(expand(r, 'text', { PLAN: 'Annual' })).toBe('A Two months free. B');
    expect(expand(r, 'text', { PLAN: 'monthly' })).toBe('A Pay monthly. B');
  });

  it('hide drops the text when the check holds and keeps it otherwise', () => {
    const r = rule({ field: 'SCORE', operator: 'greaterThan', value: '10', action: 'hide', content: 'Section B' });
    expect(expand(r, 'number', { SCORE: '12' })).toBe('A  B');
    expect(expand(r, 'number', { SCORE: '3' })).toBe('A Section B B');
  });

  it('contains finds a pick inside a multiple choice', () => {
    const r = rule({ field: 'EXTRAS', operator: 'contains', value: 'Delivery', content: 'Delivery booked.' });
    expect(expand(r, 'choice', { EXTRAS: 'Setup, delivery' })).toBe('A Delivery booked. B');
    expect(expand(r, 'choice', { EXTRAS: 'Setup' })).toBe('A  B');
  });

  it('is filled holds once anything is typed', () => {
    const r = rule({ field: 'NOTE', operator: 'isFilled', content: 'Note: {NOTE}' });
    expect(expand(r, 'text', { NOTE: 'Call first' })).toBe('A Note: Call first B');
    expect(expand(r, 'text', { NOTE: '' })).toBe('A  B');
  });

  it('a number field reads 1.200,50 as a number', () => {
    const r = rule({ field: 'TOTAL', operator: 'greaterThan', value: '1000', content: 'Free delivery.' });
    expect(expand(r, 'number', { TOTAL: '1.200,50' })).toBe('A Free delivery. B');
    const eq = rule({ field: 'TOTAL', value: '10', content: 'Ten.' });
    expect(expand(eq, 'number', { TOTAL: '10,00' })).toBe('A Ten. B');
  });

  it('every block it writes passes the template check', () => {
    for (const r of [
      rule({}),
      rule({ otherwise: 'x' }),
      rule({ action: 'hide' }),
      rule({ operator: 'contains' }),
      rule({ operator: 'isFilled' }),
    ]) {
      expect(engine.validateTemplate(buildRuleToken(r, 'text')).ok).toBe(true);
    }
  });
});

describe('conditionRule — reading back', () => {
  it('parses every condition it writes', () => {
    expect(parseRuleCondition('PLAN = "annual"')).toEqual({ field: 'PLAN', operator: 'equals', value: 'annual' });
    expect(parseRuleCondition("PLAN != 'x'")).toEqual({ field: 'PLAN', operator: 'notEquals', value: 'x' });
    expect(parseRuleCondition('PLAN != ""')).toEqual({ field: 'PLAN', operator: 'isFilled', value: '' });
    expect(parseRuleCondition('PLAN CONTAINS "a"')).toEqual({ field: 'PLAN', operator: 'contains', value: 'a' });
    expect(parseRuleCondition('N > 10')).toEqual({ field: 'N', operator: 'greaterThan', value: '10' });
    expect(parseRuleCondition('N < -2.5')).toEqual({ field: 'N', operator: 'lessThan', value: '-2.5' });
    expect(parseRuleCondition('N == 3')).toEqual({ field: 'N', operator: 'equals', value: '3' });
    expect(parseRuleCondition('N != 3')).toEqual({ field: 'N', operator: 'notEquals', value: '3' });
  });

  it('leaves shapes it does not write to the body', () => {
    expect(parseRuleCondition('N >= 10')).toBeNull();
    expect(parseRuleCondition('PRICE - 25 > 100')).toBeNull();
    expect(parseRuleCondition('A > B')).toBeNull();
    expect(parseRuleCondition('PLAN = ""')).toBeNull();
    expect(parseRuleCondition('COUNT')).toBeNull();
  });

  it('round-trips every shape through the body', () => {
    const shapes: [ConditionRule, RuleFieldKind][] = [
      [rule({}), 'text'],
      [rule({ otherwise: 'Pay monthly.' }), 'text'],
      [rule({ action: 'hide' }), 'choice'],
      [rule({ operator: 'contains', value: 'x' }), 'choice'],
      [rule({ operator: 'isFilled', value: '' }), 'text'],
      [rule({ field: 'N', operator: 'greaterThan', value: '10' }), 'number'],
      [rule({ field: 'N', operator: 'equals', value: '2.5' }), 'number'],
    ];
    for (const [r, kind] of shapes) {
      const body = `Hello\n${buildRuleToken(r, kind)}\nBye`;
      const [entry] = rulesInBody(body);
      expect(entry?.rule).toEqual(r);
      expect(entry?.raw).toBe(buildRuleToken(r, kind));
    }
  });

  it('lists hand-written blocks without a rule, and skips formula guards', () => {
    const body = [
      '{if: N >= 5}big{elseif: N > 2}mid{else}small{endif}',
      buildFormulaToken({ operation: 'percentChange', names: ['NUM_1', 'NUM_2'], decimals: 2 }),
      buildPriceAdjustToken({
        adjustment: 'savingPercent', price: 'YOUR_PRICE', other: 'LIST_PRICE', percentSource: 'typed',
        percent: '', rate: '', newRate: '', decimals: 0,
      }),
      buildInterestToken({ kind: 'simple', names: ['P', 'R', 'T'], decimals: 2 }),
      '{if: PLAN = "annual"}Yearly{endif}',
    ].join('\n');
    const found = rulesInBody(body);
    expect(found).toHaveLength(2);
    expect(found[0]?.rule).toBeNull();
    expect(found[0]?.condition).toBe('N >= 5');
    expect(found[1]?.rule?.content).toBe('Yearly');
  });

  it('reads blocks the way the engine closes them, and skips an unclosed one', () => {
    const body = '{if: A = "x"}one{endif} {if: B = "y"}two';
    const found = rulesInBody(body);
    expect(found).toHaveLength(1);
    expect(found[0]?.rule?.field).toBe('A');
  });

  it('finds the rule under the caret, edges included', () => {
    const body = 'Hi {if: PLAN = "annual"}Yearly{endif} bye';
    const start = body.indexOf('{if:');
    const end = body.indexOf('{endif}') + '{endif}'.length;
    expect(findRuleAt(body, start)?.start).toBe(start);
    expect(findRuleAt(body, end)?.end).toBe(end);
    expect(findRuleAt(body, start + 10)?.rule?.field).toBe('PLAN');
    expect(findRuleAt(body, 1)).toBeNull();
    expect(findRuleAt(body, body.length)).toBeNull();
  });

  it('finds a rule again after the text before it moved', () => {
    const block = '{if: PLAN = "annual"}Yearly{endif}';
    const before = `x{if: N > 1}a{endif} ${block}`;
    const entry = rulesInBody(before)[1];
    expect(entry).toBeDefined();
    if (!entry) return;
    const after = ` ${block}`;
    expect(relocateRule(after, entry)?.start).toBe(1);
    expect(relocateRule('nothing here', entry)).toBeNull();
  });
});

describe('conditionRule — plain words', () => {
  it('says what happens in both cases', () => {
    expect(summaryText(summarizeRule(rule({})))).toBe(
      'IF PLAN equals "annual" THEN show "Two months free." ELSE hide it',
    );
    expect(summaryText(summarizeRule(rule({ otherwise: 'Pay monthly.' })))).toBe(
      'IF PLAN equals "annual" THEN show "Two months free." ELSE show "Pay monthly."',
    );
    expect(
      summaryText(summarizeRule(rule({ field: 'SCORE', operator: 'greaterThan', value: '10', action: 'hide', content: 'Section B' }))),
    ).toBe('IF SCORE is greater than 10 THEN hide "Section B" ELSE show it');
    expect(summaryText(summarizeRule(rule({ field: 'NOTE', operator: 'isFilled', value: '' })))).toBe(
      'IF NOTE is filled THEN show "Two months free." ELSE hide it',
    );
  });

  it('marks the three keywords so they can be drawn as tags', () => {
    const keywords = summarizeRule(rule({})).filter((p) => p.kind === 'keyword').map((p) => p.text);
    expect(keywords).toEqual(['IF', 'THEN', 'ELSE']);
  });

  it('shortens long text to one line', () => {
    expect(ruleExcerpt('**Bold**\n\n  and   [yellow]marked[/yellow]')).toBe('Bold and marked');
    const long = 'word '.repeat(20);
    expect(ruleExcerpt(long).endsWith('…')).toBe(true);
    expect(ruleExcerpt(long).length).toBeLessThanOrEqual(41);
  });
});

describe('conditionRule: Each option', () => {
  const RATE_OPTIONS = ['REFUNDABLE', 'NOT REFUNDABLE'];
  const field = buildFormMenuToken({
    options: RATE_OPTIONS,
    selected: ['REFUNDABLE'],
    name: 'RATE',
    multiple: false,
    cols: null,
    print: false,
  });

  function each(cases: [string, string][]): ConditionRule {
    return rule({
      field: 'RATE',
      operator: 'eachOption',
      value: '',
      content: '',
      cases: cases.map(([value, content]) => ({ value, content })),
    });
  }

  const both = each([
    ['REFUNDABLE', 'Full refund.'],
    ['NOT REFUNDABLE', 'After booking, no refund.'],
  ]);
  const body = `Hello.\n${field}\n${buildRuleToken(both, 'choice')}\nThanks.`;

  it('writes one branch per option given a text, and skips the empty ones', () => {
    expect(buildRuleToken(both, 'choice')).toBe(
      '{if: RATE = "REFUNDABLE"}Full refund.{elseif: RATE = "NOT REFUNDABLE"}After booking, no refund.{endif}',
    );
    const one = each([['REFUNDABLE', ''], ['NOT REFUNDABLE', 'No refund.']]);
    expect(buildRuleToken(one, 'choice')).toBe('{if: RATE = "NOT REFUNDABLE"}No refund.{endif}');
    expect(engine.validateTemplate(buildRuleToken(both, 'choice')).ok).toBe(true);
  });

  it('prints only the picked option text, never the option itself', () => {
    expect(engine.resolveBody(body, { RATE: 'REFUNDABLE' })).toBe('Hello.\nFull refund.\nThanks.');
    expect(engine.resolveBody(body, { RATE: 'NOT REFUNDABLE' })).toBe(
      'Hello.\nAfter booking, no refund.\nThanks.',
    );
  });

  it('switching back and forth never leaves an old text behind', () => {
    for (const pick of ['REFUNDABLE', 'NOT REFUNDABLE', 'REFUNDABLE', 'NOT REFUNDABLE']) {
      const out = engine.resolveBody(body, { RATE: pick });
      expect(out.includes('Full refund.')).toBe(pick === 'REFUNDABLE');
      expect(out.includes('no refund')).toBe(pick === 'NOT REFUNDABLE');
      expect(out).not.toContain('REFUNDABLE');
    }
  });

  it('the fill form preview reads exactly what is inserted', () => {
    for (const pick of RATE_OPTIONS) {
      const vm = fillForm.fillForm(body, { RATE: pick }, {});
      expect(vm.fields.map((f) => f.key)).toEqual(['RATE']);
      expect(vm.fields[0]?.options).toEqual(RATE_OPTIONS);
      expect(vm.preview).toBe(engine.resolveBody(body, { RATE: pick }));
    }
    // Untouched, a single choice answers with its default.
    expect(fillForm.fillForm(body, {}, {}).preview).toBe('Hello.\nFull refund.\nThanks.');
  });

  it('keeps a second choice and the plain text around it working on their own', () => {
    const extra = buildFormMenuToken({
      options: ['Card', 'Transfer'], selected: ['Card'], name: 'PAY', multiple: false, cols: null,
    });
    const pay = buildRuleToken(
      rule({ field: 'PAY', operator: 'eachOption', value: '', content: '',
        cases: [{ value: 'Card', content: 'Pay by card.' }, { value: 'Transfer', content: 'Pay by transfer.' }] }),
      'choice',
    );
    const twoFields = `${body}\nMethod: ${extra}\n${pay}`;
    expect(engine.resolveBody(twoFields, { RATE: 'NOT REFUNDABLE', PAY: 'Card' })).toBe(
      'Hello.\nAfter booking, no refund.\nThanks.\nMethod: Card\nPay by card.',
    );
  });

  it('reads the chain back as one rule, and round-trips it', () => {
    const [entry] = rulesInBody(buildRuleToken(both, 'choice'));
    expect(entry?.rule).toEqual(both);
    expect(summaryText(summarizeRule(both))).toBe(
      'IF RATE is "REFUNDABLE" THEN show "Full refund." ELSE IF RATE is "NOT REFUNDABLE" THEN show "After booking, no refund." ELSE print nothing',
    );
  });

  it('leaves chains it does not write to the body', () => {
    for (const raw of [
      '{if: A = "x"}a{elseif: B = "y"}b{endif}',
      '{if: A = "x"}a{elseif: A != "y"}b{endif}',
      '{if: A = "x"}a{elseif: A = "y"}b{else}c{endif}',
      '{if: N == 1}a{elseif: N == 2}b{endif}',
    ]) {
      expect(rulesInBody(raw)[0]?.rule).toBeNull();
    }
  });

  it('needs one text, and an option a rule can check', () => {
    expect(eachOptionError(each([['REFUNDABLE', ''], ['NOT REFUNDABLE', ' ']]))).not.toBe('');
    expect(eachOptionError(each([['Owner\'s rate', 'x']]))).not.toBe('');
    expect(eachOptionError(each([['A', 'a {endif}']]))).not.toBe('');
    expect(eachOptionError(both)).toBe('');
    expect(isValidRule(both, 'choice')).toBe(true);
    // A chain typed by hand on a text field stays editable.
    expect(isValidRule(both, 'text')).toBe(true);
  });
});

describe('conditionRule: the rule and the print switch land together', () => {
  it('rewrites the stretch from the first change to the last', () => {
    const body = 'A{formmenu: x,y; name=M}B C';
    const [menu] = menuTokensIn(body);
    expect(menu).toBeDefined();
    if (!menu) return;
    const merged = mergeEdits(body, [
      { start: body.length, end: body.length, text: '{if: M = "x"}X{endif}' },
      { start: menu.start, end: menu.end, text: setMenuPrint(menu.raw, false) },
    ]);
    expect(merged).toEqual({
      start: 1,
      end: body.length,
      text: '{formmenu: x,y; name=M; print=no}B C{if: M = "x"}X{endif}',
    });
    if (!merged) return;
    const next = body.slice(0, merged.start) + merged.text + body.slice(merged.end);
    expect(engine.resolveBody(next, { M: 'x' })).toBe('AB CX');
  });

  it('refuses two changes that overlap', () => {
    expect(mergeEdits('abcdef', [{ start: 1, end: 4, text: '' }, { start: 2, end: 3, text: '' }])).toBeNull();
    expect(mergeEdits('abc', [])).toBeNull();
  });
});
