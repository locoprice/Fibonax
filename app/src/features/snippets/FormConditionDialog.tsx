import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { fillFormApi, loadFillFormEngine } from '@/lib/fillFormEngine';
import { menuTokensIn, parseFormMenuToken, setMenuPrint } from '@/lib/formMenuToken';
import { editTextError, insideCondition } from '@/lib/formulaToken';
import {
  buildRuleToken,
  defaultOperator,
  eachOptionError,
  getRuleOperator,
  isValidRule,
  joinsTight,
  mergeEdits,
  operatorsFor,
  relocateRule,
  ruleFieldKind,
  rulesInBody,
  ruleTextError,
  ruleValueError,
  summarizeEntry,
  summarizeRule,
  summaryText,
  type BodyEdit,
  type ConditionRule,
  type RuleAction,
  type RuleCase,
  type RuleFieldKind,
  type RuleInBody,
  type RuleOperator,
  type RuleSummaryPart,
} from '@/lib/conditionRule';
import { cn } from '@/lib/utils';
import {
  BodyListSection,
  EditingBanner,
  ERROR,
  FormulaDialogFrame,
  HINT,
  InsertsBox,
  SECTION_LABEL,
  SELECT,
  type BodyListItem,
} from '@/features/snippets/formulaDialogParts';

/** The check of a condition typed by hand, as its row's edit box changes it. */
function conditionEdit(entry: RuleInBody): NonNullable<BodyListItem['inlineEdit']> {
  const colon = entry.raw.indexOf(':');
  const brace = entry.raw.indexOf('}');
  const inner = entry.raw.slice(colon + 1, brace);
  const start = entry.start + colon + 1 + (inner.length - inner.trimStart().length);
  return {
    start,
    end: start + inner.trim().length,
    text: inner.trim(),
    label: 'Show the text when',
    error: (text: string) => editTextError(text, 'Type a condition, or use Remove to take it out.'),
  };
}

/** A field a rule can check, as the shared fill-form decider reads the body. */
interface RuleField {
  key: string;
  label: string;
  kind: RuleFieldKind;
  options: string[];
  multiple: boolean;
}

/** What the window holds while a rule is built. `operator` null means the field's own default. */
interface RuleDraft {
  field: string;
  operator: RuleOperator | null;
  value: string;
  action: RuleAction;
  content: string;
  otherwise: string;
  /** Each option: the text typed for each option so far. */
  cases: RuleCase[];
  /** Whether the Choice field prints its pick. Null means the window's default. */
  printPick: boolean | null;
}

const EMPTY_DRAFT: RuleDraft = {
  field: '',
  operator: null,
  value: '',
  action: 'show',
  content: '',
  otherwise: '',
  cases: [],
  printPick: null,
};

function draftOf(rule: ConditionRule | null): RuleDraft {
  return rule ? { ...rule, cases: rule.cases ?? [], printPick: null } : EMPTY_DRAFT;
}

const ACTION_OPTIONS: readonly { value: RuleAction; label: string }[] = [
  { value: 'show', label: 'Show it' },
  { value: 'hide', label: 'Hide it' },
];

const RULE_NOUN = { one: 'rule', many: 'rules' };

const STEP = 'mb-1.5 block text-xs font-medium text-ink';
const TEXTAREA =
  'w-full resize-y rounded-[10px] border border-line bg-card px-3 py-2 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
const INVALID = 'border-danger focus:border-danger focus:ring-danger/20';

const PART_CLASS: Record<RuleSummaryPart['kind'], string> = {
  keyword: 'inline-block rounded-[4px] bg-primary px-1 text-[10px] font-semibold leading-4 text-white',
  field: 'break-words rounded-[4px] bg-bg-alt px-1 font-mono text-[11px] text-ink',
  value: 'break-words font-mono text-[11px] font-semibold text-primary',
  text: 'text-ink-muted',
};

/**
 * A rule as one sentence, `If PLAN is "annual", show "…" Otherwise nothing`,
 * with If and Otherwise as tags so the two halves read at a glance. Used by
 * the window and by the editor's sidebar, so a rule reads the same in both.
 */
export function RuleSummary({
  parts,
  className,
}: {
  parts: readonly RuleSummaryPart[];
  className?: string;
}) {
  return (
    <p className={cn('text-xs leading-relaxed', className)}>
      {/* Read as one sentence; the tags are drawn for the eye only. */}
      <span className="sr-only">{summaryText(parts)}</span>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && !joinsTight(part.text) && ' '}
          <span aria-hidden className={PART_CLASS[part.kind]}>
            {part.text}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

const CONDITION_NOUN = { one: 'condition', many: 'conditions' };

/**
 * Every condition in the body, as the Condition section of the editor's panel
 * lists them. A rule the Show or hide window builds opens there to be changed;
 * a condition typed by hand in another shape is changed in its row.
 */
export function ConditionList({
  body,
  onReplace,
  onEditRule,
}: {
  body: string;
  onReplace: (start: number, end: number, text: string) => void;
  onEditRule: (entry: RuleInBody) => void;
}) {
  const items = useMemo<BodyListItem[]>(
    () =>
      rulesInBody(body).map((entry) => {
        const parts = summarizeEntry(entry);
        return {
          key: entry.start,
          removeStart: entry.start,
          removeEnd: entry.end,
          description: summaryText(parts),
          content: <RuleSummary parts={parts} className="text-[11px]" />,
          ...(entry.rule ? { onEdit: () => onEditRule(entry) } : { inlineEdit: conditionEdit(entry) }),
        };
      }),
    [body, onEditRule],
  );
  return <BodyListSection body={body} onReplace={onReplace} items={items} noun={CONDITION_NOUN} />;
}

interface FormConditionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The body being edited: its fields fill the picker, its rules fill the list. */
  body: string;
  /** Where a new rule goes. Inside another condition it cannot go at all. */
  caret: number;
  /** The rule the cursor sat in when the window opened, edited in place. */
  initial: RuleInBody | null;
  onInsert: (token: string) => void;
  /** Swaps a range of the body: a removal or an undo from the list. */
  onReplace: (start: number, end: number, text: string) => void;
  /** Puts an edited rule back, where the editor can offer to undo it. Defaults to `onReplace`. */
  onSave?: (start: number, end: number, text: string) => void;
}

/**
 * Builds a show or hide rule in three plain steps: the answer to check, the
 * text to show or hide, and what prints otherwise. Every rule already in the
 * snippet is listed above the form as a sentence, each with Edit and Remove.
 *
 * The rule is an ordinary `{if:}` block (`@/lib/conditionRule`), which every
 * expansion surface already resolves.
 */
export function FormConditionDialog({
  open,
  onOpenChange,
  body,
  caret,
  initial,
  onInsert,
  onReplace,
  onSave = onReplace,
}: FormConditionDialogProps) {
  const [engineReady, setEngineReady] = useState(() => fillFormApi() !== null);
  const [fieldsFailed, setFieldsFailed] = useState(false);
  const [fields, setFields] = useState<RuleField[]>([]);
  // The rule being changed, or null while a new one is built.
  const [editing, setEditing] = useState<RuleInBody | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);

  // Every opening starts clean, or on the rule the cursor sat in: a half-built
  // rule carried over from a cancelled insert would ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    setFieldsFailed(false);
    const start = initial?.rule ? initial : null;
    setEditing(start);
    setDraft(draftOf(start?.rule ?? null));
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    if (fillFormApi()) {
      setEngineReady(true);
      return;
    }
    let alive = true;
    loadFillFormEngine()
      .then(() => {
        if (alive) setEngineReady(true);
      })
      .catch(() => {
        if (alive) setFieldsFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // The fields the body has, read by the same decider every fill surface uses,
  // so the picker offers exactly the boxes the fill form will ask for.
  useEffect(() => {
    if (!open || !engineReady) return;
    const api = fillFormApi();
    if (!api) return;
    const next: RuleField[] = [];
    for (const f of api.fillForm(body, {}, {}).fields) {
      const kind = ruleFieldKind(f.type);
      if (kind) next.push({ key: f.key, label: f.label, kind, options: f.options, multiple: f.multiple });
    }
    setFields(next);
  }, [open, engineReady, body]);

  // ── The IF ──
  const fieldSel = draft.field !== '' ? draft.field : (fields[0]?.key ?? '');
  const fieldInfo = fields.find((f) => f.key === fieldSel) ?? null;
  // A rule being edited can name a field the body no longer has.
  const fieldMissing = fieldSel !== '' && fieldInfo === null;
  const kind: RuleFieldKind = fieldInfo?.kind ?? 'text';
  const multiple = fieldInfo?.multiple ?? false;
  const offered = operatorsFor(kind, multiple);
  // A chain read back from the body keeps its check, whatever its field is now,
  // so opening it never turns several texts into one.
  const allowed =
    draft.operator === 'eachOption' && !offered.some((op) => op.id === 'eachOption')
      ? [getRuleOperator('eachOption'), ...offered]
      : offered;
  const operator =
    draft.operator && allowed.some((op) => op.id === draft.operator)
      ? draft.operator
      : defaultOperator(kind, multiple);
  const spec = getRuleOperator(operator);
  const eachOption = operator === 'eachOption';

  // Each option: a box per option of the field, then any option a rule read
  // back from the body still names, so opening it never drops a text.
  const caseRows = useMemo(() => {
    if (!eachOption) return [];
    const opts = fieldInfo?.options ?? [];
    const gone = draft.cases.map((c) => c.value).filter((v) => !opts.includes(v));
    return [...opts, ...gone];
  }, [eachOption, fieldInfo, draft.cases]);
  const caseText = (option: string) => draft.cases.find((c) => c.value === option)?.content ?? '';

  function updateCase(option: string, content: string) {
    setDraft((prev) => ({
      ...prev,
      cases: prev.cases.some((c) => c.value === option)
        ? prev.cases.map((c) => (c.value === option ? { ...c, content } : c))
        : [...prev.cases, { value: option, content }],
    }));
  }

  // A choice compares against one of its own options, picked rather than typed.
  // A stored value no longer among them stays listed, so opening a rule never
  // quietly changes what it checks.
  const choiceValues = useMemo(() => {
    if (kind !== 'choice' || !fieldInfo) return [];
    const opts = fieldInfo.options;
    return draft.value === '' || opts.includes(draft.value) ? opts : [draft.value, ...opts];
  }, [kind, fieldInfo, draft.value]);
  const pickValue = kind === 'choice' && choiceValues.length > 0;
  const value = pickValue
    ? (choiceValues.includes(draft.value) ? draft.value : (choiceValues[0] ?? ''))
    : draft.value;

  const rule: ConditionRule = eachOption
    ? {
        field: fieldSel,
        operator,
        value: '',
        action: 'show',
        content: '',
        otherwise: '',
        cases: caseRows.map((option) => ({ value: option, content: caseText(option) })),
      }
    : {
        field: fieldSel,
        operator,
        value,
        action: draft.action,
        content: draft.content,
        otherwise: draft.action === 'show' ? draft.otherwise : '',
      };

  // The rule being changed, where it sits now: removing another rule while the
  // window is open moves it.
  const target = editing ? relocateRule(body, editing) : null;

  // The Choice field's own tokens, so the window can switch whether it prints.
  // One sitting inside the rule being changed is part of that rule's text.
  const menuTokens = useMemo(() => {
    const api = fillFormApi();
    if (!open || !engineReady || !api || kind !== 'choice' || fieldSel === '') return [];
    return menuTokensIn(body).filter(
      (t) =>
        api.fillForm(t.raw, {}, {}).fields[0]?.key === fieldSel &&
        !(target && t.start >= target.start && t.end <= target.end),
    );
  }, [open, engineReady, kind, fieldSel, body, target]);
  const tokenPrints = (raw: string) => parseFormMenuToken(raw)?.print !== false;
  const fieldPrints = menuTokens.some((t) => tokenPrints(t.raw));
  // A new Each option rule starts with the picked option switched off: its texts
  // already say what was picked. Anything else starts as the field is.
  const printPick = draft.printPick ?? (editing === null && eachOption ? false : fieldPrints);
  const printEdits: BodyEdit[] = menuTokens
    .filter((t) => tokenPrints(t.raw) !== printPick)
    .map((t) => ({ start: t.start, end: t.end, text: setMenuPrint(t.raw, printPick) }));

  const valueError = spec.needsValue && value.trim() !== '' ? ruleValueError(operator, value, kind) : '';
  const contentError = ruleTextError(draft.content, false);
  const otherwiseError = draft.action === 'show' ? ruleTextError(draft.otherwise, false) : '';

  // A new block cannot open inside another: the engine would close the outer
  // one at the new block's {endif} and print the rest unconditionally.
  const insideOther = useMemo(
    () => editing === null && insideCondition(body.slice(0, caret)),
    [editing, body, caret],
  );

  const valid =
    engineReady && !fieldsFailed && fieldInfo !== null && !insideOther && isValidRule(rule, kind);
  const token = valid ? buildRuleToken(rule, kind) : '';

  const note = valid
    ? ''
    : fieldsFailed
      ? 'Could not read the fields in this snippet.'
      : !engineReady
        ? ''
        : fields.length === 0 && !fieldMissing
          ? 'Add a field to the snippet first.'
          : fieldMissing
            ? `${fieldSel} is no longer in this snippet. Pick another field.`
            : insideOther
              ? 'The cursor is inside another condition. Move it outside, then build the rule.'
              : eachOption
                ? eachOptionError(rule)
              : spec.needsValue && value.trim() === ''
                ? 'Type the answer to match in step 1.'
                : valueError !== ''
                  ? 'Check the answer in step 1.'
                  : draft.content.trim() === ''
                    ? 'Type the text in step 2.'
                    : 'Check the text marked in red.';

  // The plain-words line, readable before the rule is finished: a blank shows
  // as an ellipsis rather than hiding the sentence until the end.
  const firstCase: RuleCase = { value: caseRows[0] ?? '…', content: '…' };
  const preview = fieldSel === ''
    ? null
    : eachOption
      ? summarizeRule({
          ...rule,
          cases: rule.cases?.some((c) => c.content.trim() !== '') ? rule.cases : [firstCase],
        })
      : summarizeRule({
          ...rule,
          value: rule.value.trim() === '' ? '…' : rule.value,
          content: rule.content.trim() === '' ? '…' : rule.content,
        });

  // ── The rules already there ──
  const entries = useMemo(() => rulesInBody(body), [body]);
  const items: BodyListItem[] = entries.map((entry) => {
    const parts = summarizeEntry(entry);
    const isEditing =
      editing !== null && entry.start === editing.start && entry.raw === editing.raw;
    return {
      key: entry.start,
      removeStart: entry.start,
      removeEnd: entry.end,
      description: summaryText(parts),
      content: (
        <RuleSummary parts={parts} className={cn(isEditing && 'rounded-[4px] bg-primary-light px-1')} />
      ),
      onEdit: entry.rule ? () => startEditing(entry) : undefined,
      // A condition typed by hand, in a shape the window does not build, is
      // changed in its row: the check between `{if:` and its brace.
      ...(entry.rule ? {} : { inlineEdit: conditionEdit(entry) }),
    };
  });

  function startEditing(entry: RuleInBody) {
    setEditing(entry);
    setDraft(draftOf(entry.rule));
  }

  function startNew() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
  }

  function update(patch: Partial<RuleDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit() {
    if (!valid) return;
    // An edited rule goes back where it sits now. Gone altogether, the edit goes
    // in as a new rule.
    if (printEdits.length === 0) {
      if (target) onSave(target.start, target.end, token);
      else onInsert(token);
      onOpenChange(false);
      return;
    }
    // The rule and the field's print switch as one change. A new rule never
    // lands inside the field's own token.
    const inside = menuTokens.find((t) => caret > t.start && caret < t.end);
    const at = inside ? inside.end : caret;
    const ruleEdit: BodyEdit = target
      ? { start: target.start, end: target.end, text: token }
      : { start: at, end: at, text: token };
    const merged = mergeEdits(body, [ruleEdit, ...printEdits]);
    // Never null here: a token inside the rule is left out of menuTokens, and
    // a new rule is moved out of the token it would have split.
    if (!merged) return;
    if (target) onSave(merged.start, merged.end, merged.text);
    else onReplace(merged.start, merged.end, merged.text);
    onOpenChange(false);
  }

  function submitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <FormulaDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Show or hide"
      description="Print a piece of text only when an answer calls for it."
      body={body}
      onReplace={onReplace}
      list={
        <BodyListSection
          body={body}
          onReplace={onReplace}
          items={items}
          noun={RULE_NOUN}
          defaultExpanded
        />
      }
      note={note}
      canInsert={valid}
      onInsert={handleSubmit}
      insertLabel={editing ? 'Save rule' : 'Insert'}
    >
      {fieldsFailed ? (
        <p className={ERROR}>Could not read the fields in this snippet. Reload the page and try again.</p>
      ) : !engineReady ? (
        <p className={HINT}>Loading…</p>
      ) : fields.length === 0 && !fieldMissing ? (
        <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
          <p className="text-xs font-medium text-ink">No field to check yet</p>
          <p className={HINT}>
            A rule checks an answer, so the snippet needs a Text, Number or Choice field first.
            Add one from Fields, then come back.
          </p>
        </div>
      ) : (
        <>
          {editing && (
            <EditingBanner onNew={startNew} newLabel="New rule instead">
              Editing a rule. Save puts it back where it was.
            </EditingBanner>
          )}

          <div className="flex flex-col gap-4">
            {/* One row that reads as a sentence: the field, the check, the
                answer. Each box keeps a label for screen readers only. */}
            <section aria-label="Step 1">
              <p className={STEP}>1. When this answer</p>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor="rule-field" className="sr-only">
                    Field
                  </label>
                  <select
                    id="rule-field"
                    value={fieldSel}
                    onChange={(e) =>
                      update({ field: e.target.value, operator: null, value: '', cases: [], printPick: null })
                    }
                    className={cn(SELECT, fieldMissing && INVALID)}
                  >
                    {fieldMissing && <option value={fieldSel}>{fieldSel} (not in the snippet)</option>}
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label !== '' && f.label !== f.key ? `${f.key} · ${f.label}` : f.key}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={cn('min-w-0', spec.needsValue ? 'flex-1' : 'flex-[1.4]')}>
                  <label htmlFor="rule-check" className="sr-only">
                    Check
                  </label>
                  <select
                    id="rule-check"
                    value={operator}
                    onChange={(e) => update({ operator: e.target.value as RuleOperator })}
                    className={cn(SELECT, 'font-sans')}
                  >
                    {allowed.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>
                {spec.needsValue && (
                  <div className="min-w-0 flex-1">
                    <label htmlFor="rule-value" className="sr-only">
                      Answer to match
                    </label>
                    {pickValue ? (
                      <select
                        id="rule-value"
                        value={value}
                        onChange={(e) => update({ value: e.target.value })}
                        className={SELECT}
                      >
                        {choiceValues.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id="rule-value"
                        value={value}
                        inputMode={spec.numeric || kind === 'number' ? 'decimal' : 'text'}
                        placeholder={spec.numeric || kind === 'number' ? '10' : 'The answer'}
                        onChange={(e) => update({ value: e.target.value })}
                        onKeyDown={submitOnEnter}
                        aria-invalid={valueError !== ''}
                        className={cn('h-10 rounded-[10px] font-mono', valueError !== '' && INVALID)}
                      />
                    )}
                  </div>
                )}
              </div>
              {valueError !== '' ? (
                <p className={ERROR}>{valueError}</p>
              ) : spec.needsValue && !pickValue && !spec.numeric && kind !== 'number' ? (
                <p className={HINT}>Capitals don&apos;t matter: annual matches Annual.</p>
              ) : spec.needsValue && (spec.numeric || kind === 'number') ? (
                <p className={HINT}>An empty box counts as 0.</p>
              ) : null}

              {menuTokens.length > 0 && (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="rule-print" className="text-xs font-medium text-ink-muted">
                      Print the picked option
                    </label>
                    <Switch
                      id="rule-print"
                      checked={printPick}
                      onChange={(next) => update({ printPick: next })}
                    />
                  </div>
                  <p className={HINT}>
                    {printPick
                      ? `The option picked prints where ${fieldSel} sits, as well as the rule's text.`
                      : `${fieldSel} only decides what prints. The option picked does not print.`}
                    {printEdits.length > 0 && ` ${editing ? 'Save rule' : 'Insert'} changes the field too.`}
                  </p>
                </div>
              )}
            </section>

            {eachOption ? (
              <section aria-label="Step 2">
                <p className={STEP}>2. The text for each option</p>
                <div className="flex flex-col gap-2.5">
                  {caseRows.map((option, i) => {
                    const text = caseText(option);
                    const error = ruleTextError(text, false);
                    const gone = !(fieldInfo?.options ?? []).includes(option);
                    return (
                      <div key={option}>
                        <label htmlFor={`rule-case-${i}`} className={SECTION_LABEL}>
                          <span className="font-mono text-ink">{option}</span>
                          {gone && <span className="font-normal text-ink-subtle"> (no longer an option)</span>}
                        </label>
                        <textarea
                          id={`rule-case-${i}`}
                          rows={2}
                          value={text}
                          onChange={(e) => updateCase(option, e.target.value)}
                          placeholder="Fields work here too, like {NAME}."
                          aria-invalid={error !== ''}
                          className={cn(TEXTAREA, error !== '' && INVALID)}
                        />
                        {error !== '' && <p className={ERROR}>{error}</p>}
                      </div>
                    );
                  })}
                </div>
                <p className={HINT}>An option left empty prints nothing.</p>
              </section>
            ) : (
              <section aria-label="Step 2">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-ink">2. This text</p>
                  <Segmented
                    options={ACTION_OPTIONS}
                    value={draft.action}
                    onChange={(next) => update({ action: next })}
                    ariaLabel="Show or hide the text"
                    className="[&>button]:h-7 [&>button]:px-2.5 [&>button]:text-[11px]"
                  />
                </div>
                <label htmlFor="rule-content" className="sr-only">
                  The text to {draft.action}
                </label>
                <textarea
                  id="rule-content"
                  rows={3}
                  value={draft.content}
                  onChange={(e) => update({ content: e.target.value })}
                  placeholder="Fields work here too, like {NAME}."
                  aria-invalid={contentError !== ''}
                  className={cn(TEXTAREA, contentError !== '' && INVALID)}
                />
                {contentError !== '' && <p className={ERROR}>{contentError}</p>}
              </section>
            )}

            {/* A hidden text shows otherwise, and each option's text already
                says what prints: only a shown text can print something else. */}
            {!eachOption && draft.action === 'show' && (
              <section aria-label="Step 3">
                <label htmlFor="rule-otherwise" className={STEP}>
                  3. Otherwise print <span className="font-normal text-ink-subtle">(optional)</span>
                </label>
                <textarea
                  id="rule-otherwise"
                  rows={2}
                  value={draft.otherwise}
                  onChange={(e) => update({ otherwise: e.target.value })}
                  placeholder="Leave empty to print nothing."
                  aria-invalid={otherwiseError !== ''}
                  className={cn(TEXTAREA, otherwiseError !== '' && INVALID)}
                />
                {otherwiseError !== '' && <p className={ERROR}>{otherwiseError}</p>}
              </section>
            )}
          </div>

          {preview && (
            <div className="rounded-[10px] border border-primary/25 bg-primary-light px-3 py-2.5">
              <RuleSummary parts={preview} />
            </div>
          )}

          {valid && <InsertsBox token={token} />}
        </>
      )}
    </FormulaDialogFrame>
  );
}
