/**
 * Show or hide rules for the snippet body editor.
 *
 * A rule is an ordinary `{if:}` block, written so it can be built from three
 * dropdowns and read back in plain words, the way a form builder shows a
 * question only when an earlier answer calls for it:
 *
 * ```
 * IF PLAN equals "annual" THEN show the text ELSE hide it
 * {if: PLAN = "annual"}Two months free.{endif}
 *
 * IF SCORE is greater than 10 THEN hide the text ELSE show it
 * {if: SCORE > 10}{else}Section B{endif}
 *
 * IF NOTE is filled THEN show "Note: {NOTE}" ELSE show "No note."
 * {if: NOTE != ""}Note: {NOTE}{else}No note.{endif}
 *
 * IF RATE is "Refundable" THEN show "Full refund." ELSE IF RATE is "Fixed" THEN show "No refund."
 * {if: RATE = "Refundable"}Full refund.{elseif: RATE = "Fixed"}No refund.{endif}
 * ```
 *
 * The last shape is the Each option check (v3.70.0): one text per option of a
 * single choice, the way a form ties an answer to what follows it. Only the
 * options given a text are written, and a chain of two or more reads back as
 * one rule. One text alone is an Equals rule, and reads back as one.
 *
 * **Why hiding writes `{else}` instead of turning the check round.** Every
 * check has an opposite except `contains`, and `{if: X}{else}text{endif}` hides
 * the text for all six the same way. It also reads back unambiguously: an empty
 * first half is a hide rule, anything else a show rule.
 *
 * **What reaches the engine.** `{if:}`, `{else}`, `=`, `!=`, `>`, `<` and
 * `!= ""` are understood by every extension version that has conditions, so a
 * rule works the day it is written. `contains` is new in v3.62.0 (evalCondition
 * in `extension/formula-engine.js`, sbEvalCondition in
 * `app/public/mobile/index.html`); an older extension reads it as false.
 * `src/__tests__/conditionRule.test.ts` pins the round trip against the real
 * engine.
 *
 * **Blocks cannot nest.** The engine closes a block at the first `{endif}`
 * after it, so a rule's text may not hold another condition, and a rule may
 * not be inserted inside one.
 */

import { isValidFieldName } from '@/lib/formNumberToken';

export type RuleOperator =
  | 'eachOption'
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'lessThan'
  | 'contains'
  | 'isFilled';

export type RuleAction = 'show' | 'hide';

/**
 * What a rule can compare, by the field's kind. Dates and times are left out:
 * a picker stores `2026-10-07`, and asking someone to type that to compare
 * against would be a trap rather than a feature.
 */
export type RuleFieldKind = 'text' | 'number' | 'choice';

export interface RuleOperatorSpec {
  id: RuleOperator;
  /** The dropdown's wording. */
  label: string;
  /** The same check inside a sentence. */
  phrase: string;
  needsValue: boolean;
  /** The value has to be a number. */
  numeric: boolean;
  /** The kinds of field the check is offered for. */
  kinds: readonly RuleFieldKind[];
}

export const RULE_OPERATORS: readonly RuleOperatorSpec[] = [
  { id: 'eachOption', label: 'Each option has its own text', phrase: 'is', needsValue: false, numeric: false,
    kinds: ['choice'] },
  { id: 'equals', label: 'Equals', phrase: 'equals', needsValue: true, numeric: false,
    kinds: ['text', 'number', 'choice'] },
  { id: 'notEquals', label: 'Does not equal', phrase: 'does not equal', needsValue: true, numeric: false,
    kinds: ['text', 'number', 'choice'] },
  { id: 'greaterThan', label: 'Is greater than', phrase: 'is greater than', needsValue: true, numeric: true,
    kinds: ['text', 'number'] },
  { id: 'lessThan', label: 'Is less than', phrase: 'is less than', needsValue: true, numeric: true,
    kinds: ['text', 'number'] },
  { id: 'contains', label: 'Contains', phrase: 'contains', needsValue: true, numeric: false,
    kinds: ['text', 'choice'] },
  { id: 'isFilled', label: 'Is filled', phrase: 'is filled', needsValue: false, numeric: false,
    kinds: ['text', 'number', 'choice'] },
];

export function getRuleOperator(id: RuleOperator): RuleOperatorSpec {
  const spec = RULE_OPERATORS.find((op) => op.id === id);
  if (!spec) throw new Error(`Unknown rule check: ${id}`);
  return spec;
}

/**
 * The checks a field of this kind offers, in the dropdown's order. Each option
 * needs one answer at a time, so a menu that takes several picks goes without.
 */
export function operatorsFor(kind: RuleFieldKind, multiple = false): RuleOperatorSpec[] {
  return RULE_OPERATORS.filter(
    (op) => op.kinds.includes(kind) && !(op.id === 'eachOption' && multiple),
  );
}

/**
 * The check a field opens on. A single choice opens on Each option, the
 * question a choice usually answers. A menu that takes several picks holds them
 * as one line, so asking whether it contains an option is what "was this
 * ticked" means.
 */
export function defaultOperator(kind: RuleFieldKind, multiple = false): RuleOperator {
  if (kind !== 'choice') return 'equals';
  return multiple ? 'contains' : 'eachOption';
}

/** A fill-form field type as a rule sees it, or null when rules cannot compare it. */
export function ruleFieldKind(type: string): RuleFieldKind | null {
  if (type === 'number') return 'number';
  if (type === 'dd') return 'choice';
  if (type === 'text') return 'text';
  return null;
}

export interface ConditionRule {
  field: string;
  operator: RuleOperator;
  /** As typed. Unused by `isFilled`. */
  value: string;
  action: RuleAction;
  /** The text the rule shows or hides. It may hold fields and formulas. */
  content: string;
  /** Show rules only: what prints instead when the check fails. '' prints nothing. */
  otherwise: string;
  /**
   * Each option only: the text each option prints, in the order written. The
   * fields above go unused for it. Left out of every other rule.
   */
  cases?: RuleCase[];
}

/** One option of an Each option rule and the text it prints. '' prints nothing. */
export interface RuleCase {
  value: string;
  content: string;
}

/**
 * A typed number in the engine's spelling: `2,5` becomes `2.5`, and `1.500`
 * becomes `1500`, because one mark followed by exactly three digits is
 * thousands, as sbToNumber reads the answer the rule is checked against
 * (`extension/formula-engine.js`). Null when it is not one.
 */
export function parseRuleNumber(raw: string): string | null {
  const s = raw.trim();
  if (!/^-?\d+(?:[.,]\d+)?$/.test(s)) return null;
  if (/^-?[1-9]\d{0,2}[.,]\d{3}$/.test(s)) return String(Number(s.replace(/[.,]/, '')));
  return String(Number(s.replace(',', '.')));
}

/** Whether the check compares numbers for this field. */
function comparesNumbers(operator: RuleOperator, kind: RuleFieldKind): boolean {
  const spec = getRuleOperator(operator);
  return spec.numeric || (kind === 'number' && (operator === 'equals' || operator === 'notEquals'));
}

// A quote would end the value early, and a brace would end the whole token.
const UNSAFE_VALUE = /["'{}]/;

/** Why the value cannot be written, or '' when it can. */
export function ruleValueError(operator: RuleOperator, value: string, kind: RuleFieldKind): string {
  const spec = getRuleOperator(operator);
  if (!spec.needsValue) return '';
  if (value.trim() === '') return 'Type the value to compare with.';
  if (comparesNumbers(operator, kind)) {
    return parseRuleNumber(value) === null ? 'Type a number, like 10 or 2.5.' : '';
  }
  return UNSAFE_VALUE.test(value) ? 'Quotes and curly brackets cannot go in a value.' : '';
}

// What would close or split the block from inside it.
const NESTED = /\{\s*(?:if:|elseif:|else\s*\}|endif\s*\})/i;

/** Why the text cannot be written, or '' when it can. `required` is false for the optional Otherwise. */
export function ruleTextError(text: string, required: boolean): string {
  if (required && text.trim() === '') return 'Type the text this rule shows or hides.';
  return NESTED.test(text)
    ? 'A rule cannot hold another condition. Take out the {if:}, {else} or {endif}.'
    : '';
}

/** The options of an Each option rule that print something, so get written. */
function writtenCases(rule: ConditionRule): RuleCase[] {
  return (rule.cases ?? []).filter((c) => c.content.trim() !== '');
}

/** Why an Each option rule cannot be written, or '' when it can. */
export function eachOptionError(rule: ConditionRule): string {
  const cases = writtenCases(rule);
  if (cases.length === 0) return 'Type the text for at least one option.';
  for (const c of cases) {
    if (c.value.trim() === '' || UNSAFE_VALUE.test(c.value)) {
      return `The option ${c.value} has a quote or a curly bracket, so a rule cannot check it. Rename it in the Choice field.`;
    }
    const textError = ruleTextError(c.content, false);
    if (textError !== '') return textError;
  }
  return '';
}

/** Whether the rule can be written. Whether the field still exists is the dialog's to check. */
export function isValidRule(rule: ConditionRule, kind: RuleFieldKind): boolean {
  if (!isValidFieldName(rule.field)) return false;
  // Checked whatever the field: a chain read back from the body stays editable
  // even when its field is not a single choice.
  if (rule.operator === 'eachOption') return eachOptionError(rule) === '';
  if (!getRuleOperator(rule.operator).kinds.includes(kind)) return false;
  if (ruleValueError(rule.operator, rule.value, kind) !== '') return false;
  if (ruleTextError(rule.content, true) !== '') return false;
  return rule.action === 'hide' || ruleTextError(rule.otherwise, false) === '';
}

/** The condition inside `{if: …}`. */
export function buildRuleCondition(rule: ConditionRule, kind: RuleFieldKind): string {
  const { field, operator } = rule;
  const value = rule.value.trim();
  const number = parseRuleNumber(value) ?? value;
  const numeric = comparesNumbers(operator, kind);
  switch (operator) {
    case 'eachOption':
      return `${field} = "${(writtenCases(rule)[0]?.value ?? '').trim()}"`;
    case 'equals':
      return numeric ? `${field} == ${number}` : `${field} = "${value}"`;
    case 'notEquals':
      return numeric ? `${field} != ${number}` : `${field} != "${value}"`;
    case 'greaterThan':
      return `${field} > ${number}`;
    case 'lessThan':
      return `${field} < ${number}`;
    case 'contains':
      return `${field} contains "${value}"`;
    case 'isFilled':
      return `${field} != ""`;
  }
}

/** Writes the whole block. */
export function buildRuleToken(rule: ConditionRule, kind: RuleFieldKind): string {
  if (rule.operator === 'eachOption') {
    const branches = writtenCases(rule).map(
      (c, i) => `{${i === 0 ? 'if' : 'elseif'}: ${rule.field} = "${c.value.trim()}"}${c.content}`,
    );
    return `${branches.join('')}{endif}`;
  }
  const head = `{if: ${buildRuleCondition(rule, kind)}}`;
  if (rule.action === 'hide') return `${head}{else}${rule.content}{endif}`;
  return rule.otherwise !== ''
    ? `${head}${rule.content}{else}${rule.otherwise}{endif}`
    : `${head}${rule.content}{endif}`;
}

const NAME = '([A-Za-z_][A-Za-z0-9_]*)';
const QUOTED = `["']([^"']*)["']`;
const CONTAINS_RE = new RegExp(`^${NAME}\\s+contains\\s+${QUOTED}$`, 'i');
const TEXT_RE = new RegExp(`^${NAME}\\s*(==|!=|<>|=)\\s*${QUOTED}$`);
const NUMBER_RE = new RegExp(`^${NAME}\\s*(==|!=|>|<)\\s*(-?\\d+(?:\\.\\d+)?)$`);
const NUMBER_OPS: Record<string, RuleOperator> = {
  '==': 'equals',
  '!=': 'notEquals',
  '>': 'greaterThan',
  '<': 'lessThan',
};

/**
 * The field, check and value of a condition the builder could have written, or
 * null for anything else (`>=`, arithmetic, two fields), which stays as typed.
 */
export function parseRuleCondition(
  condition: string,
): Pick<ConditionRule, 'field' | 'operator' | 'value'> | null {
  const c = condition.trim();
  let m = CONTAINS_RE.exec(c);
  if (m) return { field: m[1] ?? '', operator: 'contains', value: m[2] ?? '' };
  m = TEXT_RE.exec(c);
  if (m) {
    const field = m[1] ?? '';
    const value = m[3] ?? '';
    const equal = m[2] === '=' || m[2] === '==';
    // `= ""` asks whether a field is empty, which no rule writes: hiding
    // when it is filled says the same thing.
    if (value === '') return equal ? null : { field, operator: 'isFilled', value: '' };
    return { field, operator: equal ? 'equals' : 'notEquals', value };
  }
  m = NUMBER_RE.exec(c);
  if (m) {
    const operator = NUMBER_OPS[m[2] ?? ''];
    if (operator) return { field: m[1] ?? '', operator, value: m[3] ?? '' };
  }
  return null;
}

// The engine's own branch tags (_splitIfBranches in extension/formula-engine.js).
const BRANCH_TAG = /\{(else(?:if:[^}]*)?)\}/g;

/**
 * An Each option chain: every branch asks whether the same field equals a
 * quoted option, and there is no {else}. Anything else is left to the body.
 */
function parseEachOption(condition: string, inner: string, tags: RegExpMatchArray[]): ConditionRule | null {
  const heads = [condition, ...tags.map((t) => (t[1] ?? '').slice('elseif:'.length))];
  const cases: RuleCase[] = [];
  let field = '';
  let from = 0;
  for (let i = 0; i < heads.length; i++) {
    const head = (heads[i] ?? '').trim();
    const check = TEXT_RE.test(head) ? parseRuleCondition(head) : null;
    if (!check || check.operator !== 'equals') return null;
    if (i === 0) field = check.field;
    else if (check.field !== field) return null;
    const tag = tags[i];
    const to = tag ? (tag.index ?? 0) : inner.length;
    cases.push({ value: check.value, content: inner.slice(from, to) });
    if (tag) from = to + tag[0].length;
  }
  return { field, operator: 'eachOption', value: '', action: 'show', content: '', otherwise: '', cases };
}

function parseRuleBlock(condition: string, inner: string): ConditionRule | null {
  const tags = [...inner.matchAll(BRANCH_TAG)];
  if (tags.length > 0 && tags.every((t) => (t[1] ?? '').startsWith('elseif:'))) {
    return parseEachOption(condition, inner, tags);
  }
  const check = parseRuleCondition(condition);
  if (!check) return null;
  if (tags.some((t) => (t[1] ?? '') !== 'else') || tags.length > 1) return null;
  const tag = tags[0];
  if (!tag) {
    return inner.trim() === '' ? null : { ...check, action: 'show', content: inner, otherwise: '' };
  }
  const at = tag.index ?? 0;
  const first = inner.slice(0, at);
  const second = inner.slice(at + tag[0].length);
  if (first === '' && second.trim() !== '') {
    return { ...check, action: 'hide', content: second, otherwise: '' };
  }
  if (first.trim() === '') return null;
  return { ...check, action: 'show', content: first, otherwise: second };
}

/**
 * A guard a formula window wrote around its answer, `{if: NUM_2 != 0}{=…}%{endif}`:
 * a formula and signs, no words. It belongs to the formula, which the formula
 * windows list and remove, so it is not offered as a rule.
 */
function isFormulaGuard(inner: string): boolean {
  return /\{=/.test(inner) && !/\p{L}/u.test(inner.replace(/\{[^}]*\}/g, ''));
}

export interface RuleInBody {
  /** The whole block, `{if:` to `{endif}`. */
  start: number;
  end: number;
  raw: string;
  /** What sits inside `{if: …}`, trimmed. */
  condition: string;
  /** The rule, or null when the block was written by hand in a shape the builder does not write. */
  rule: ConditionRule | null;
}

const IF_HEAD = /\{\s*if:([^}]*)\}/g;
const ENDIF = '{endif}';

/**
 * Every condition in the body, in order, read the way the engine reads it: a
 * block runs from its `{if:}` to the first `{endif}` after it. An unclosed one
 * is not listed; the template check already flags it.
 */
export function rulesInBody(body: string): RuleInBody[] {
  const out: RuleInBody[] = [];
  const re = new RegExp(IF_HEAD.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const headEnd = m.index + m[0].length;
    const close = body.indexOf(ENDIF, headEnd);
    if (close === -1) break;
    const end = close + ENDIF.length;
    const inner = body.slice(headEnd, close);
    if (!isFormulaGuard(inner)) {
      const condition = (m[1] ?? '').trim();
      out.push({
        start: m.index,
        end,
        raw: body.slice(m.index, end),
        condition,
        rule: parseRuleBlock(condition, inner),
      });
    }
    re.lastIndex = end;
  }
  return out;
}

/**
 * The rule the caret sits in, or null. A caret on either edge counts as inside,
 * as it does for a menu, so clicking just after `{endif}` still finds it.
 */
export function findRuleAt(body: string, caret: number): RuleInBody | null {
  const pos = Math.min(Math.max(Number.isFinite(caret) ? caret : 0, 0), body.length);
  return rulesInBody(body).find((r) => pos >= r.start && pos <= r.end) ?? null;
}

/**
 * Where a rule being edited sits now. Removing another rule while the window is
 * open moves it, so it is found again by its text, nearest its old place.
 */
export function relocateRule(body: string, rule: RuleInBody): RuleInBody | null {
  if (body.slice(rule.start, rule.end) === rule.raw) return rule;
  const matches = rulesInBody(body).filter((r) => r.raw === rule.raw);
  if (matches.length === 0) return null;
  return matches.reduce((best, r) =>
    Math.abs(r.start - rule.start) < Math.abs(best.start - rule.start) ? r : best,
  );
}

/** One change to the body: `text` in place of what runs from `start` to `end`. */
export interface BodyEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Several changes as one: the stretch from the first to the last, rewritten.
 * A rule and the print switch on its field land together this way, and neither
 * shifts the other's place. Null when two overlap.
 */
export function mergeEdits(body: string, edits: readonly BodyEdit[]): BodyEdit | null {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const first = sorted[0];
  if (!first) return null;
  let text = '';
  let at = first.start;
  for (const edit of sorted) {
    if (edit.start < at) return null;
    text += body.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return { start: first.start, end: at, text };
}

// ── Plain words ─────────────────────────────────────────────────────

/**
 * One piece of a rule's summary. The window draws each kind its own way: the
 * three keywords as tags, the field and the values in the body's monospace.
 */
export interface RuleSummaryPart {
  kind: 'keyword' | 'field' | 'value' | 'text';
  text: string;
}

const EXCERPT_MAX = 40;

/** A text as one short line, without style markers, for a summary. */
export function ruleExcerpt(text: string): string {
  const flat = text
    .replace(/\*\*/g, '')
    .replace(/\[\/?(?:blue|yellow|red)\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX).trimEnd()}…` : flat;
}

function quoted(text: string): string {
  return `"${text}"`;
}

/** The value as the summary prints it: numbers bare, text in quotes. */
function summaryValue(rule: ConditionRule): string {
  const spec = getRuleOperator(rule.operator);
  const value = rule.value.trim();
  if (spec.numeric) return parseRuleNumber(value) ?? value;
  if (rule.operator !== 'contains' && parseRuleNumber(value) !== null) return value;
  return quoted(value);
}

/**
 * `IF PLAN equals "annual" THEN show "Two months free." ELSE hide it`, as parts.
 * The ELSE always says what happens, so nobody has to work out that a shown
 * text is otherwise hidden.
 */
export function summarizeRule(rule: ConditionRule): RuleSummaryPart[] {
  if (rule.operator === 'eachOption') return summarizeEachOption(rule);
  const spec = getRuleOperator(rule.operator);
  const parts: RuleSummaryPart[] = [
    { kind: 'keyword', text: 'IF' },
    { kind: 'field', text: rule.field },
    { kind: 'text', text: spec.phrase },
  ];
  if (spec.needsValue) parts.push({ kind: 'value', text: summaryValue(rule) });
  parts.push(
    { kind: 'keyword', text: 'THEN' },
    { kind: 'text', text: rule.action },
    { kind: 'value', text: quoted(ruleExcerpt(rule.content)) },
    { kind: 'keyword', text: 'ELSE' },
  );
  if (rule.action === 'hide') parts.push({ kind: 'text', text: 'show it' });
  else if (rule.otherwise.trim() === '') parts.push({ kind: 'text', text: 'hide it' });
  else parts.push({ kind: 'text', text: 'show' }, { kind: 'value', text: quoted(ruleExcerpt(rule.otherwise)) });
  return parts;
}

/**
 * `IF RATE is "Refundable" THEN show "Full refund." ELSE IF RATE is "Fixed" THEN
 * show "No refund." ELSE print nothing`, as parts. Options left empty are not
 * written, so they are not read out either.
 */
function summarizeEachOption(rule: ConditionRule): RuleSummaryPart[] {
  const parts: RuleSummaryPart[] = [];
  writtenCases(rule).forEach((c, i) => {
    parts.push(
      { kind: 'keyword', text: i === 0 ? 'IF' : 'ELSE IF' },
      { kind: 'field', text: rule.field },
      { kind: 'text', text: 'is' },
      { kind: 'value', text: quoted(c.value.trim()) },
      { kind: 'keyword', text: 'THEN' },
      { kind: 'text', text: 'show' },
      { kind: 'value', text: quoted(ruleExcerpt(c.content)) },
    );
  });
  parts.push({ kind: 'keyword', text: 'ELSE' }, { kind: 'text', text: 'print nothing' });
  return parts;
}

/** A condition written by hand, which the builder lists but does not edit. */
export function summarizeCustomCondition(condition: string): RuleSummaryPart[] {
  return [
    { kind: 'keyword', text: 'IF' },
    { kind: 'value', text: condition },
    { kind: 'text', text: '(written by hand: change it in the body)' },
  ];
}

/** The parts as one line, for screen readers and the Undo note. */
export function summaryText(parts: readonly RuleSummaryPart[]): string {
  return parts.map((p) => p.text).join(' ');
}

/** A body entry's summary, whichever way it was written. */
export function summarizeEntry(entry: RuleInBody): RuleSummaryPart[] {
  return entry.rule ? summarizeRule(entry.rule) : summarizeCustomCondition(entry.condition);
}
