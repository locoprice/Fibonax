/**
 * A formula as steps, for people who do not write maths: start with a value,
 * then add, subtract, multiply, divide, take a percentage off or put one on
 * top, one step after another, top to bottom.
 *
 * `parseSteps` reads a formula into steps when it is a plain chain of them,
 * as the Price line, the Calculator and most formulas typed by hand are.
 * `buildSteps` writes steps back as an ordinary formula, adding the brackets
 * itself, so "subtract the saving, then take 10% off" means exactly that. The
 * engine and every fill surface read the result as they read any formula.
 *
 * A formula the steps cannot show (a function such as `datespan`, a bracket in
 * the middle of a line, a minus sign in front of a number) parses to null and
 * is changed as text instead.
 */

import { DEFAULT_DECIMALS, withRounding, type FormulaDecimals } from '@/lib/formulaToken';

export type StepOp = 'add' | 'sub' | 'mul' | 'div' | 'off' | 'on';

/** A box or saved value by name, or a number typed into the step. */
export type StepValue = { kind: 'name'; name: string } | { kind: 'number'; text: string };

export interface FormulaStep {
  /** null for the first step, which only says what to start with. */
  op: StepOp | null;
  value: StepValue;
}

export interface StepsFormula {
  steps: FormulaStep[];
  decimals: FormulaDecimals;
}

/** What each step is called, in the order the Add a step choices show them. */
export const STEP_OPS: readonly { op: StepOp; label: string }[] = [
  { op: 'add', label: 'Add' },
  { op: 'sub', label: 'Subtract' },
  { op: 'mul', label: 'Multiply by' },
  { op: 'div', label: 'Divide by' },
  { op: 'off', label: 'Take off %' },
  { op: 'on', label: 'Add %' },
];

export function stepOpLabel(op: StepOp): string {
  return STEP_OPS.find((s) => s.op === op)?.label ?? op;
}

export function isPercentOp(op: StepOp | null): boolean {
  return op === 'off' || op === 'on';
}

// ── Reading ─────────────────────────────────────────────────────────

type Node =
  | { t: 'num'; v: string }
  | { t: 'name'; v: string }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: Node; r: Node }
  | { t: 'round'; a: Node };

const TOKEN = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/()])/y;

function tokenize(src: string): string[] | null {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let at = 0;
  while (at < src.length) {
    if (/^\s*$/.test(src.slice(at))) break;
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    if (!m) return null;
    out.push(m[1] ?? '');
    at = TOKEN.lastIndex;
  }
  return out;
}

/** Plus, minus, times, divide, brackets and round(): the shapes steps can come from. */
function parseExpression(src: string): Node | null {
  const read = tokenize(src);
  if (!read || read.length === 0) return null;
  const tokens: readonly string[] = read;
  let i = 0;
  const peek = () => tokens[i];

  function factor(): Node | null {
    const tok = tokens[i];
    if (tok === undefined) return null;
    if (/^\d/.test(tok)) {
      i += 1;
      return { t: 'num', v: tok };
    }
    if (tok === '(') {
      i += 1;
      const inner = sum();
      if (!inner || tokens[i] !== ')') return null;
      i += 1;
      return inner;
    }
    if (/^[A-Za-z_]/.test(tok)) {
      i += 1;
      if (tokens[i] !== '(') return { t: 'name', v: tok };
      if (tok !== 'round') return null;
      i += 1;
      const inner = sum();
      if (!inner || tokens[i] !== ')') return null;
      i += 1;
      return { t: 'round', a: inner };
    }
    return null;
  }

  function product(): Node | null {
    let left = factor();
    while (left && (peek() === '*' || peek() === '/')) {
      const op = peek() as '*' | '/';
      i += 1;
      const right = factor();
      if (!right) return null;
      left = { t: 'bin', op, l: left, r: right };
    }
    return left;
  }

  function sum(): Node | null {
    let left = product();
    while (left && (peek() === '+' || peek() === '-')) {
      const op = peek() as '+' | '-';
      i += 1;
      const right = product();
      if (!right) return null;
      left = { t: 'bin', op, l: left, r: right };
    }
    return left;
  }

  const tree = sum();
  return tree && i === tokens.length ? tree : null;
}

function leafValue(n: Node): StepValue | null {
  if (n.t === 'num') return { kind: 'number', text: n.v };
  if (n.t === 'name') return { kind: 'name', name: n.v };
  return null;
}

const isNum = (n: Node, v: string) => n.t === 'num' && Number(n.v) === Number(v);

/** The tree as steps, or null when it is not one chain of them. */
function chain(n: Node): FormulaStep[] | null {
  const leaf = leafValue(n);
  if (leaf) return [{ op: null, value: leaf }];
  if (n.t !== 'bin') return null;

  // X * (100 - P) / 100 and X * (100 + P) / 100: a percentage off, or on top.
  if (n.op === '/' && isNum(n.r, '100') && n.l.t === 'bin' && n.l.op === '*') {
    const pct = n.l.r;
    if (pct.t === 'bin' && (pct.op === '-' || pct.op === '+') && isNum(pct.l, '100')) {
      const value = leafValue(pct.r);
      const before = chain(n.l.l);
      if (value && before) return [...before, { op: pct.op === '-' ? 'off' : 'on', value }];
    }
  }

  const value = leafValue(n.r);
  const before = chain(n.l);
  if (!value || !before) return null;
  const op: StepOp = n.op === '+' ? 'add' : n.op === '-' ? 'sub' : n.op === '*' ? 'mul' : 'div';
  return [...before, { op, value }];
}

/** A formula as steps, or null when the steps cannot show it. */
export function parseSteps(expression: string): StepsFormula | null {
  const tree = parseExpression(expression);
  if (!tree) return null;
  let decimals: FormulaDecimals = DEFAULT_DECIMALS;
  let inner = tree;
  // The two roundings the builders write: round(X), and round((X) * 10) / 10.
  if (tree.t === 'round') {
    decimals = 0;
    inner = tree.a;
  } else if (
    tree.t === 'bin' &&
    tree.op === '/' &&
    isNum(tree.r, '10') &&
    tree.l.t === 'round' &&
    tree.l.a.t === 'bin' &&
    tree.l.a.op === '*' &&
    isNum(tree.l.a.r, '10')
  ) {
    decimals = 1;
    inner = tree.l.a.l;
  }
  const steps = chain(inner);
  return steps ? { steps, decimals } : null;
}

// ── Writing ─────────────────────────────────────────────────────────

/** A typed number as the engine reads it: `1,5` becomes `1.5`. null when it is not one. */
export function stepNumber(text: string): string | null {
  const s = text.trim().replace(',', '.');
  return /^\d+(?:\.\d+)?$/.test(s) ? s : null;
}

/** Whether every step names something or holds a number, so the formula can be written. */
export function stepsComplete(steps: readonly FormulaStep[]): boolean {
  return (
    steps.length > 0 &&
    steps.every((s) => (s.value.kind === 'name' ? s.value.name !== '' : stepNumber(s.value.text) !== null))
  );
}

function valueText(v: StepValue): string {
  return v.kind === 'name' ? v.name : (stepNumber(v.text) ?? '0');
}

/**
 * The steps as a formula. Brackets go in only where the order needs them: a
 * multiplication after an addition works on the whole running total.
 */
export function buildSteps(f: StepsFormula): string {
  const [first, ...rest] = f.steps;
  if (!first) return '';
  let expr = valueText(first.value);
  let additive = false;
  for (const step of rest) {
    const v = valueText(step.value);
    const whole = additive ? `(${expr})` : expr;
    switch (step.op) {
      case 'add':
        expr = `${expr} + ${v}`;
        additive = true;
        break;
      case 'sub':
        expr = `${expr} - ${v}`;
        additive = true;
        break;
      case 'mul':
        expr = `${whole} * ${v}`;
        additive = false;
        break;
      case 'div':
        expr = `${whole} / ${v}`;
        additive = false;
        break;
      case 'off':
        expr = `${whole} * (100 - ${v}) / 100`;
        additive = false;
        break;
      case 'on':
        expr = `${whole} * (100 + ${v}) / 100`;
        additive = false;
        break;
      case null:
        break;
    }
  }
  return withRounding(expr, f.decimals);
}

/** A name as a person would read it: YOUR_PRICE is "Your price". */
export function humanizeName(name: string): string {
  const words = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
