import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { isValidFieldName } from '@/lib/formNumberToken';
import { bodyItems, itemDetail, itemTitle, readersOf, type BodyItem, type BodyItemKind } from '@/lib/bodyItems';
import {
  editTextError,
  formulasInBody,
  formulaTextError,
  hasDuplicateNames,
  lineContext,
  savedValuesInBody,
  type FormulaDecimals,
} from '@/lib/formulaToken';

// The pieces the formula windows (Price line, Calculator, the two interest
// windows, Show or hide) share, so they look and behave as one: same frame,
// same list of what the snippet already holds, same choice cards, same name
// fields.

export const HINT = 'text-[11px] text-ink-subtle mt-1.5';
export const ERROR = 'mt-1.5 text-[11px] text-danger';
export const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';
export const SELECT =
  'h-10 w-full rounded-[10px] border border-line bg-card px-3 font-mono text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

/** The picker's last choice: a box that does not exist yet, added with the formula. */
export const NEW_BOX = '__new_box__';

const DECIMAL_OPTIONS: readonly { value: `${FormulaDecimals}`; label: string }[] = [
  { value: '0', label: 'Whole number' },
  { value: '1', label: '1 decimal' },
  { value: '2', label: '2 decimals' },
];

/** "100", "100 and 25", "100, 25 and 5". */
export function listAnd(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A group of choices where exactly one is picked, each with a line saying what it does. */
export function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  columns,
}: {
  options: readonly { id: T; label: string; detail: string }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  columns: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('grid gap-2', columns)}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2 text-left transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active ? 'border-primary bg-primary-light' : 'border-line bg-card hover:bg-bg-alt',
            )}
          >
            <span className={cn('text-xs font-semibold', active ? 'text-primary' : 'text-ink')}>
              {opt.label}
            </span>
            <span className="text-[11px] leading-tight text-ink-subtle">{opt.detail}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RoundingControl({
  value,
  onChange,
}: {
  value: FormulaDecimals;
  onChange: (next: FormulaDecimals) => void;
}) {
  return (
    <div>
      <span className={SECTION_LABEL}>Rounding</span>
      <Segmented
        options={DECIMAL_OPTIONS}
        value={`${value}`}
        onChange={(v) => onChange(Number(v) as FormulaDecimals)}
        ariaLabel="Answer rounding"
        className="w-full [&>button]:flex-1"
      />
      <p className={HINT}>How many decimals the answer keeps. Numbers you type in print as typed.</p>
    </div>
  );
}

/** A name a box or a rate is called: letters, digits and underscore, and not one already taken. */
export function NameInput({
  id,
  ariaLabel,
  value,
  onChange,
  onEnter,
  taken,
  hint,
  example,
}: {
  id?: string;
  ariaLabel: string;
  value: string;
  /** Called with the name as typed, already stripped of anything a name cannot hold. */
  onChange: (next: string) => void;
  onEnter: () => void;
  taken: boolean;
  hint: ReactNode;
  example: string;
}) {
  const valid = isValidFieldName(value);
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    }
  }
  return (
    <div>
      <Input
        id={id}
        aria-label={ariaLabel}
        value={value}
        // Stripped as typed, not rejected after: a space failing validation with
        // no visible cause is worse than a space that does not appear.
        onChange={(e) => onChange(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
        onKeyDown={onKeyDown}
        className={cn(
          'h-10 rounded-[10px] font-mono',
          (!valid || taken) && 'border-danger focus:border-danger focus:ring-danger/20',
        )}
      />
      {taken ? (
        <p className={ERROR}>This snippet already uses that name. Pick another one.</p>
      ) : !valid ? (
        <p className={ERROR}>
          Letters, numbers and underscore, starting with a letter. For example {example}.
        </p>
      ) : (
        <p className={HINT}>{hint}</p>
      )}
    </div>
  );
}

/** What the line prints for sample numbers. `children` is the sentence. */
export function ExampleBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-primary/25 bg-primary-light px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
        Example
      </p>
      <p className="mt-1 text-xs text-ink">{children}</p>
    </div>
  );
}

/** The printed answer inside an `ExampleBox` sentence. */
export function ExampleResult({ children }: { children: ReactNode }) {
  return <span className="font-mono font-semibold text-primary">{children}</span>;
}

/** Exactly what lands in the body. */
export function InsertsBox({ token }: { token: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
        Inserts
      </p>
      <code className="block break-all font-mono text-[11px] leading-relaxed text-ink-muted">
        {token}
      </code>
    </div>
  );
}

/**
 * The names of the boxes a window adds, one row each, under More options. Only
 * needed when a formula typed by hand reads one of them.
 */
export function BoxNames({
  labels,
  names,
  onChange,
  onEnter,
  labelWidth = 'w-16',
}: {
  /** What each box is, beside its name. */
  labels: readonly string[];
  names: readonly string[];
  onChange: (index: number, next: string) => void;
  onEnter: () => void;
  labelWidth?: string;
}) {
  const duplicate = hasDuplicateNames([...names]);
  const namesValid = names.every(isValidFieldName);
  return (
    <div>
      <span className={SECTION_LABEL}>Box names</span>
      <div className="flex flex-col gap-2">
        {names.map((name, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className={cn(labelWidth, 'shrink-0 text-xs text-ink-subtle')}>{labels[i]}</span>
            <Input
              value={name}
              aria-label={`${labels[i]} box name`}
              // Stripped as typed, not rejected after: a space failing
              // validation with no visible cause is worse.
              onChange={(e) => onChange(i, e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onEnter();
                }
              }}
              className={cn(
                'h-10 rounded-[10px] font-mono',
                !isValidFieldName(name) && 'border-danger focus:border-danger focus:ring-danger/20',
              )}
            />
          </div>
        ))}
      </div>
      {duplicate ? (
        <p className={ERROR}>Each box needs its own name, or two boxes fill as one.</p>
      ) : !namesValid ? (
        <p className={ERROR}>
          Letters, numbers and underscore, starting with a letter. For example NUM_1.
        </p>
      ) : (
        <p className={HINT}>
          Only needed if a formula you type by hand reads these boxes. A box left empty counts as 0.
        </p>
      )}
    </div>
  );
}

/** Settings most people never need, out of the way until asked for. */
export function MoreOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        More options
      </button>
      {open && <div className="mt-3 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

/** One row of `BodyListSection`: something the snippet already holds. */
export interface BodyListItem {
  key: string | number;
  /** The text Remove takes out of the body. */
  removeStart: number;
  removeEnd: number;
  /** The item in one line, for screen readers and the Undo note. */
  description: string;
  /** What the row shows. */
  content: ReactNode;
  /** Present when the item can be loaded back into the window. */
  onEdit?: () => void;
  /**
   * Present when the item's text can be changed right in its row: the range
   * Save swaps for the new text, the text the box opens on, the words above
   * the box, and why a text cannot be saved ('' when it can).
   */
  inlineEdit?: {
    start: number;
    end: number;
    text: string;
    label: string;
    error: (text: string) => string;
  };
  /**
   * Present when something else in the snippet still reads the item: what
   * removing it would break. Remove then asks before it removes.
   */
  removeWarning?: string;
  /** The item the window is changing right now, marked so it can be found. */
  active?: boolean;
}

const ROW_ACTION =
  'flex shrink-0 items-center gap-1 rounded-[6px] border border-line bg-card px-2 py-1 text-[11px] font-medium text-ink-subtle transition-colors';

/** A `BodyListSection` row while its text is changed in place. */
function InlineEditRow({
  item,
  draft,
  onDraft,
  onSave,
  onCancel,
}: {
  item: BodyListItem;
  draft: string;
  onDraft: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const errorId = useId();
  const error = item.inlineEdit?.error(draft) ?? '';
  const label = item.inlineEdit?.label ?? '';
  return (
    <li className="px-3 py-2">
      {label !== '' && <p className="truncate text-[11px] text-ink-subtle">{label}</p>}
      {/* Wraps where it is narrow, as in the editor's side panel: the box
          keeps a usable width and the buttons move under it. */}
      <div className={cn('flex flex-wrap items-center gap-2', label !== '' && 'mt-1')}>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSave();
            }
          }}
          aria-label={`Change ${item.description}`}
          aria-invalid={error !== ''}
          aria-describedby={error !== '' ? errorId : undefined}
          spellCheck={false}
          className={cn(
            'h-8 min-w-[8rem] flex-1 rounded-[10px] px-2.5 font-mono text-xs',
            error !== '' && 'border-danger focus:border-danger focus:ring-danger/20',
          )}
        />
        <button
          type="button"
          onClick={onSave}
          disabled={error !== ''}
          className={cn(
            ROW_ACTION,
            'border-primary bg-primary text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Check className="h-3 w-3" aria-hidden />
          Save
        </button>
        <button type="button" onClick={onCancel} className={cn(ROW_ACTION, 'hover:bg-bg-alt hover:text-ink')}>
          Cancel
        </button>
      </div>
      {error !== '' && (
        <p id={errorId} className={ERROR}>
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * What the snippet already holds, one line by default (how many there are) and
 * the list behind Manage. Each can be removed, and the last removal or change
 * undone; an item the window can load back, or change in its row, also carries
 * Edit.
 *
 * It sits above the scrolling form in every window, never inside it: in there
 * it scrolled out of sight and could not be found.
 */
export function BodyListSection({
  body,
  onReplace,
  items,
  noun,
  defaultExpanded = false,
}: {
  body: string;
  onReplace: (start: number, end: number, text: string) => void;
  items: readonly BodyListItem[];
  /** Singular and plural, as the count line reads them. */
  noun: { one: string; many: string };
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // What the last Remove or Save took out, where, and how much it put there
  // instead (0 for a removal), so Undo can put the old text back.
  const [lastChange, setLastChange] = useState<{
    start: number;
    length: number;
    text: string;
    note: string;
  } | null>(null);
  // The row being changed in place. It holds only for the body it was opened
  // on: once the body moves, its range may point at another item's text.
  const [editing, setEditing] = useState<{
    key: string | number;
    body: string;
    draft: string;
  } | null>(null);
  // The row whose Remove is waiting for a yes, for the same body only.
  const [confirming, setConfirming] = useState<{ key: string | number; body: string } | null>(null);
  const count = items.length;
  const editingKey = editing !== null && editing.body === body ? editing.key : null;
  const confirmingKey = confirming !== null && confirming.body === body ? confirming.key : null;

  function remove(item: BodyListItem) {
    setConfirming(null);
    setLastChange({
      start: item.removeStart,
      length: 0,
      text: body.slice(item.removeStart, item.removeEnd),
      note: `Removed ${item.description}.`,
    });
    onReplace(item.removeStart, item.removeEnd, '');
  }

  function saveEdit(item: BodyListItem, draft: string) {
    const edit = item.inlineEdit;
    if (!edit || edit.error(draft) !== '') return;
    const next = draft.trim();
    setEditing(null);
    if (next === edit.text) return;
    setLastChange({
      start: edit.start,
      length: next.length,
      text: body.slice(edit.start, edit.end),
      note: `Changed ${item.description}.`,
    });
    onReplace(edit.start, edit.end, next);
  }

  return (
    <div className="rounded-[10px] border border-line bg-bg-alt">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="text-xs text-ink-muted">
          {count === 0
            ? `No ${noun.many} in this snippet yet.`
            : `${count} ${count === 1 ? noun.one : noun.many} in this snippet.`}
        </p>
        {count > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="text-xs font-medium text-primary hover:underline"
          >
            {expanded ? 'Hide' : 'Manage'}
          </button>
        )}
      </div>

      {expanded && count > 0 && (
        <ul className="max-h-[140px] divide-y divide-line overflow-y-auto border-t border-line bg-card">
          {items.map((item) =>
            item.inlineEdit && editing !== null && item.key === editingKey ? (
              <InlineEditRow
                key={item.key}
                item={item}
                draft={editing.draft}
                onDraft={(draft) => setEditing({ ...editing, draft })}
                onSave={() => saveEdit(item, editing.draft)}
                onCancel={() => setEditing(null)}
              />
            ) : item.key === confirmingKey ? (
              <li key={item.key} className="px-3 py-2">
                <div className="min-w-0">{item.content}</div>
                <p role="alert" className="mt-1 text-[11px] leading-tight text-danger">
                  {item.removeWarning}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => remove(item)}
                    className={cn(ROW_ACTION, 'border-danger bg-danger text-white hover:bg-danger/90')}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    Remove anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className={cn(ROW_ACTION, 'hover:bg-bg-alt hover:text-ink')}
                  >
                    Keep it
                  </button>
                </div>
              </li>
            ) : (
              // Wraps where it is narrow, as in the editor's side panel: the
              // words keep a readable width and the buttons move under them.
              <li
                key={item.key}
                className={cn('flex flex-wrap items-center gap-2 px-3 py-2', item.active && 'bg-primary-light')}
              >
                <div className="min-w-[8rem] flex-1">{item.content}</div>
                {(item.onEdit || item.inlineEdit) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (item.onEdit) item.onEdit();
                      else if (item.inlineEdit) setEditing({ key: item.key, body, draft: item.inlineEdit.text });
                    }}
                    aria-label={`Edit ${item.description}`}
                    className={cn(ROW_ACTION, 'hover:border-primary/30 hover:bg-primary-light hover:text-primary')}
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (item.removeWarning) setConfirming({ key: item.key, body });
                    else remove(item);
                  }}
                  aria-label={`Remove ${item.description}`}
                  className={cn(ROW_ACTION, 'hover:border-danger/30 hover:bg-danger/5 hover:text-danger')}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  Remove
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {lastChange && (
        <p className="border-t border-line px-3 py-2 text-[11px] text-ink-subtle">
          {lastChange.note}{' '}
          <button
            type="button"
            onClick={() => {
              onReplace(lastChange.start, lastChange.start + lastChange.length, lastChange.text);
              setLastChange(null);
            }}
            className="font-medium text-primary hover:underline"
          >
            Undo
          </button>
        </p>
      )}
    </div>
  );
}

const FORMULA_NOUN = { one: 'formula', many: 'formulas' };

/** A row's two lines: the words around it, then what it is. */
function RowContent({ context, main }: { context: string; main: string }) {
  return (
    <>
      {context !== '' && <p className="truncate text-[11px] text-ink-subtle">{context}</p>}
      <p className="truncate font-mono text-xs text-ink" title={main}>
        {main}
      </p>
    </>
  );
}

/** What Remove warns about when other parts of the snippet read `name`. */
export function readersWarning(name: string, readers: number): string | undefined {
  if (readers === 0) return undefined;
  return `${readers === 1 ? 'Another part' : `${readers} other parts`} of this snippet ${readers === 1 ? 'reads' : 'read'} ${name}. Without it, ${readers === 1 ? 'it prints' : 'they print'} nothing.`;
}

/**
 * The formulas already in the snippet, as every formula window lists them,
 * with the values the snippet saves for its formulas ({var:}) among them.
 * `only` keeps the formulas one window is about, such as a date range's counts.
 */
export function FormulaListSection({
  body,
  onReplace,
  only,
  noun = FORMULA_NOUN,
}: {
  body: string;
  onReplace: (start: number, end: number, text: string) => void;
  only?: (expression: string) => boolean;
  noun?: { one: string; many: string };
}) {
  const items = useMemo<BodyListItem[]>(() => {
    const formulas = formulasInBody(body)
      .filter((f) => !only || only(f.expression?.text ?? ''))
      .map((f) => ({
        at: f.at,
        item: {
          key: f.at,
          removeStart: f.removeStart,
          removeEnd: f.removeEnd,
          description: f.description,
          content: <RowContent context={f.context} main={f.description} />,
          ...(f.expression ? { inlineEdit: { ...f.expression, label: f.context, error: formulaTextError } } : {}),
        } satisfies BodyListItem,
      }));
    const saved = only
      ? []
      : savedValuesInBody(body).map((v) => {
          const context = lineContext(body, v.start, v.end);
          const main = `${v.name} = ${v.expression.text}`;
          return {
            at: v.start,
            item: {
              key: `var-${v.start}`,
              removeStart: v.start,
              removeEnd: v.end,
              description: `the saved value ${v.name}`,
              content: <RowContent context={context} main={main} />,
              inlineEdit: {
                ...v.expression,
                label: `${v.name} =`,
                error: (text: string) => editTextError(text, 'Type a value, or use Remove to take it out.'),
              },
              removeWarning: readersWarning(v.name, readersOf(body, v.name, v.start, v.end)),
            } satisfies BodyListItem,
          };
        });
    return [...formulas, ...saved].sort((a, b) => a.at - b.at).map((r) => r.item);
  }, [body, only]);
  return <BodyListSection body={body} onReplace={onReplace} items={items} noun={noun} />;
}

/**
 * The fields, buttons, automatic dates or greetings already in the snippet, as
 * the window that builds them lists them. Edit loads one into the window (or,
 * for a greeting, changes it in its row); Remove asks first when something
 * else reads it.
 */
export function ItemListSection({
  body,
  onReplace,
  kinds,
  noun,
  onEdit,
  editing,
}: {
  body: string;
  onReplace: (start: number, end: number, text: string) => void;
  kinds: readonly BodyItemKind[];
  noun: { one: string; many: string };
  /** Loads an item into its window. Absent where the window has no form for it. */
  onEdit?: (item: BodyItem) => void;
  /** The item being changed now, to mark its row. */
  editing?: BodyItem | null;
}) {
  const items = useMemo<BodyListItem[]>(
    () =>
      bodyItems(body)
        .filter((i) => kinds.includes(i.kind))
        .map((i) => {
          const title = itemTitle(i);
          const detail = itemDetail(i);
          return {
            key: i.start,
            removeStart: i.start,
            removeEnd: i.end,
            description: title,
            content: (
              <>
                <p className="truncate font-mono text-xs text-ink" title={title}>
                  {title}
                </p>
                <p className="truncate text-[11px] text-ink-subtle" title={detail}>
                  {detail}
                </p>
              </>
            ),
            ...(i.kind === 'greeting'
              ? {
                  inlineEdit: {
                    start: i.start + 1,
                    end: i.end - 1,
                    text: i.raw.slice(1, -1),
                    label: 'Greeting',
                    error: greetingTextError,
                  },
                }
              : i.cfg && onEdit
                ? { onEdit: () => onEdit(i) }
                : {}),
            removeWarning: readersWarning(i.name, readersOf(body, i.name, i.start, i.end)),
            active: editing != null && editing.start === i.start && editing.raw === i.raw,
          } satisfies BodyListItem;
        }),
    [body, kinds, onEdit, editing],
  );
  return <BodyListSection body={body} onReplace={onReplace} items={items} noun={noun} />;
}

/** A greeting changed in its row must stay a greeting. */
function greetingTextError(text: string): string {
  const error = editTextError(text, 'Type the greeting, or use Remove to take it out.');
  if (error !== '') return error;
  return /^greeting\s*(?::|$)/i.test(text.trim()) ? '' : 'Start with greeting, for example greeting: lang=ES.';
}

/** Under a renamed field's name: the parts that read it follow the new name. */
export function RenameNote({ from, to, readers }: { from: string; to: string; readers: number }) {
  if (from === to || readers === 0) return null;
  const one = readers === 1;
  return (
    <p className={HINT}>
      {one ? 'Another part' : `${readers} other parts`} of this snippet {one ? 'reads' : 'read'}{' '}
      <span className="font-mono">{from}</span>. Save changes {one ? 'it' : 'them'} to read{' '}
      <span className="font-mono">{to}</span>.
    </p>
  );
}

/**
 * Shown above a window's form while it changes something already in the
 * snippet, so Save is never mistaken for adding a second one.
 */
export function EditingBanner({
  children,
  onNew,
  newLabel,
}: {
  children: ReactNode;
  onNew: () => void;
  newLabel: string;
}) {
  return (
    <p className="flex items-center justify-between gap-2 rounded-[10px] border border-primary/25 bg-primary-light px-3 py-2 text-xs text-ink">
      {children}
      <button type="button" onClick={onNew} className="shrink-0 font-medium text-primary hover:underline">
        {newLabel}
      </button>
    </p>
  );
}

/**
 * The window every builder sits in: a title, the list of what the snippet
 * already holds (its formulas, unless `list` says otherwise), the form, and the
 * Cancel and Insert buttons. Never taller than the screen; the title, the list
 * and the buttons stay put and only the form scrolls.
 */
export function FormulaDialogFrame({
  open,
  onOpenChange,
  title,
  description,
  body,
  onReplace,
  list,
  note,
  canInsert,
  onInsert,
  insertLabel = 'Insert',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  body: string;
  onReplace: (start: number, end: number, text: string) => void;
  /** Replaces the formula list, for a window that lists something else. */
  list?: ReactNode;
  /** Why Insert is not available yet, in the footer beside the buttons. */
  note: string;
  canInsert: boolean;
  onInsert: () => void;
  /** The confirm button's wording, for a window that also edits. */
  insertLabel?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-[480px] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* min-w-0: a long formula is cut short with an ellipsis, rather than
            its row widening the window past its edge. */}
        <div className="min-w-0 px-6 pb-3">
          {list ?? <FormulaListSection body={body} onReplace={onReplace} />}
        </div>

        {/* shrink-0 on every section: in a scrolling column, a section that
            clips its own overflow would otherwise be squeezed to nothing
            instead of the column scrolling. */}
        <div className="min-h-0 overflow-y-auto px-6 pb-2 flex flex-col gap-5 [&>*]:shrink-0">
          {children}
        </div>

        <div className="mt-2 flex items-center gap-3 border-t border-line px-6 py-4">
          <p className="mr-auto text-[11px] leading-tight text-ink-subtle">{note}</p>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={onInsert} disabled={!canInsert}>
            {insertLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
