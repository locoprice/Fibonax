import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFormulaToken, buildPriceAdjustToken } from '@/lib/formulaToken';
import { buildSteps, humanizeName, parseSteps, stepNumber, stepsComplete, type StepsFormula } from '@/lib/formulaSteps';

// Editing a formula as steps must never change what it prints. Every case runs
// the original and the rewritten formula through the REAL engine.

const engine = (() => {
  const src = readFileSync(resolve(process.cwd(), '..', 'extension', 'formula-engine.js'), 'utf8');
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', 'require', src)(mod, mod.exports, () => ({}));
  return mod.exports as { resolveBody: (body: string, vals: Record<string, string>) => string };
})();

const VALS = { A: '889', B: '13.34', C: '25', D: '1.5', OTA_PRICE: '1355', YOUR_PRICE: '889' };
const run = (expr: string) => engine.resolveBody(`{=${expr}}`, { ...VALS });

const name = (n: string) => ({ kind: 'name' as const, name: n });
const num = (t: string) => ({ kind: 'number' as const, text: t });

describe('formulaSteps: reading a formula as steps', () => {
  it('reads a chain, its percentages and its rounding', () => {
    expect(parseSteps('YOUR_PRICE - BANK_TRANSFER_SAVING')).toEqual({
      steps: [
        { op: null, value: name('YOUR_PRICE') },
        { op: 'sub', value: name('BANK_TRANSFER_SAVING') },
      ],
      decimals: 2,
    });
    expect(parseSteps('round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)')).toEqual({
      steps: [
        { op: null, value: name('OTA_PRICE') },
        { op: 'sub', value: name('YOUR_PRICE') },
        { op: 'div', value: name('OTA_PRICE') },
        { op: 'mul', value: num('100') },
      ],
      decimals: 0,
    });
    expect(parseSteps('YOUR_PRICE * (100 + 3) / 100')?.steps[1]).toEqual({ op: 'on', value: num('3') });
    expect(parseSteps('round((A * (100 - D) / 100) * 10) / 10')).toEqual({
      steps: [{ op: null, value: name('A') }, { op: 'off', value: name('D') }],
      decimals: 1,
    });
    expect(parseSteps('BANK_TRANSFER_PRICE')).toEqual({ steps: [{ op: null, value: name('BANK_TRANSFER_PRICE') }], decimals: 2 });
  });

  it('reads what the Price line and the Calculator write', () => {
    const price = buildPriceAdjustToken({
      adjustment: 'minusPercent', price: 'A', other: '', percentSource: 'rate', percent: '', rate: 'D', newRate: '', decimals: 0,
    });
    const priceExpr = /\{=([^}]*)\}/.exec(price)?.[1] ?? '';
    expect(parseSteps(priceExpr)?.steps.map((s) => s.op)).toEqual([null, 'off']);
    const calc = /\{=([^}]*)\}/.exec(buildFormulaToken({ operation: 'subtract', names: ['A', 'B', 'C'], decimals: 1 }))?.[1] ?? '';
    expect(parseSteps(calc)).toEqual({
      steps: [{ op: null, value: name('A') }, { op: 'sub', value: name('B') }, { op: 'sub', value: name('C') }],
      decimals: 1,
    });
  });

  it('leaves to text what steps cannot show', () => {
    for (const expr of ['datespan(A,B,"between")', 'A - B * C', 'min(A, B)', '-A + B', 'A *', '', 'round(A, 1)']) {
      expect(parseSteps(expr)).toBeNull();
    }
  });
});

describe('formulaSteps: writing steps back', () => {
  const cases = [
    'A - B',
    'A - B + C',
    'round(A - B)',
    'A * (100 - D) / 100',
    'round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)',
    'round((A + C) * 10) / 10',
    'A / 4 * 3',
    '(A - B) * (100 + D) / 100',
  ];

  it('prints exactly what the formula printed before', () => {
    for (const expr of cases) {
      const steps = parseSteps(expr);
      expect(steps, expr).not.toBeNull();
      expect(run(buildSteps(steps!)), expr).toBe(run(expr));
    }
  });

  it('reads back the same steps it wrote', () => {
    for (const expr of cases) {
      const steps = parseSteps(expr)!;
      expect(parseSteps(buildSteps(steps)), expr).toEqual(steps);
    }
  });

  it('puts in the brackets the order needs', () => {
    const f: StepsFormula = {
      steps: [
        { op: null, value: name('A') },
        { op: 'sub', value: name('B') },
        { op: 'add', value: name('C') },
        { op: 'off', value: num('10') },
      ],
      decimals: 2,
    };
    expect(buildSteps(f)).toBe('(A - B + C) * (100 - 10) / 100');
    expect(run(buildSteps(f))).toBe(String(Math.round(((889 - 13.34 + 25) * 0.9) * 100) / 100));
  });

  it('writes each rounding the way every extension version reads it', () => {
    const steps: StepsFormula['steps'] = [{ op: null, value: name('A') }, { op: 'div', value: num('3') }];
    expect(buildSteps({ steps, decimals: 0 })).toBe('round(A / 3)');
    expect(buildSteps({ steps, decimals: 1 })).toBe('round((A / 3) * 10) / 10');
    expect(buildSteps({ steps, decimals: 2 })).toBe('A / 3');
  });

  it('takes a number typed with a comma and refuses one that is not a number', () => {
    expect(stepNumber('1,5')).toBe('1.5');
    expect(stepNumber('abc')).toBeNull();
    expect(stepsComplete([{ op: null, value: name('A') }, { op: 'off', value: num('') }])).toBe(false);
    expect(stepsComplete([{ op: null, value: name('A') }, { op: 'off', value: num('2,5') }])).toBe(true);
  });

  it('names values the way a person reads them', () => {
    expect(humanizeName('BANK_TRANSFER_SAVING')).toBe('Bank transfer saving');
  });
});
