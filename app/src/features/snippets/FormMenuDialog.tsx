import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GripVertical, MinusCircle, PlusCircle } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { EditingBanner, RenameNote } from '@/features/snippets/formulaDialogParts';
import { LinkRuleFields } from '@/features/snippets/LinkRuleFields';
import { cn } from '@/lib/utils';
import {
  buildFormMenuToken,
  isValidMenuName,
  MENU_OTHER_LABEL,
  sanitizeMenuOption,
  type FormMenuConfig,
} from '@/lib/formMenuToken';
import { MENU_PRESETS, menuPresetOptions } from '@/lib/menuPresets';
import {
  emptyLinkDraft,
  LABEL_LINK_MODES,
  linkDraftFrom,
  linkFromDraft,
  type LinkRuleDraft,
} from '@/lib/linkRule';

interface MenuRow {
  /** Stable across label edits, so the preselection survives retyping. */
  id: number;
  label: string;
}

const STARTING_ROWS = 3;

const HINT = 'text-[11px] text-ink-subtle mt-1.5';
const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';
const SELECT =
  'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

/** The Predefined options dropdown's resting answer: the values are the author's own. */
const NO_PRESET = 'none';

interface FormMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled field name — the next free MENU_n for the body being edited. */
  suggestedName: string;
  /**
   * The menu being edited, or null to build a new one. Must be referentially
   * stable while open: the dialog reseeds whenever it changes, so a value
   * rebuilt on every render would wipe the edit in progress.
   */
  initial?: FormMenuConfig | null;
  /**
   * The Fill from a pasted link rule a new menu starts with, as `after:Plan`,
   * when it is added from the Fill from a pasted link toggle. '' or left out otherwise.
   */
  newLink?: string;
  /**
   * The name a new menu starts with, when the Fill from a pasted link entry
   * named it after the word it reads. '' or left out for a menu that starts
   * unnamed, as one built from the Choice toggle does.
   */
  newName?: string;
  /**
   * The snippet's language (EN, IT, ES, FR or MULTI). A ready-made list prints
   * in the message, so it is written in that language; Multi gets English.
   */
  language: string;
  /** The choice fields already in the snippet, listed above the form. */
  list?: ReactNode;
  /** How many other parts read the menu being changed, for the rename note. */
  readers?: number;
  /** Leaves the menu being changed as it is and starts a new one. */
  onNew?: () => void;
  onSubmit: (token: string) => void;
}

/**
 * Builds a `{formmenu:}` token for the snippet body: a menu of choices the
 * person expanding the snippet picks from.
 *
 * The token grammar is written by `@/lib/formMenuToken` and parsed back by the
 * formula engine, so what this dialog previews is exactly what expands. Passing
 * `initial` loads an existing menu for editing instead of starting blank.
 */
export function FormMenuDialog({
  open,
  onOpenChange,
  suggestedName,
  initial = null,
  newLink = '',
  newName = '',
  language,
  list,
  readers = 0,
  onNew,
  onSubmit,
}: FormMenuDialogProps) {
  const nextId = useRef(0);
  const makeRow = (label = ''): MenuRow => ({ id: (nextId.current += 1), label });

  const [rows, setRows] = useState<MenuRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [multiple, setMultiple] = useState(false);
  // No longer editable: `cols` only widened the options box in character units,
  // it never changed the output, and the mobile app ignored it outright. The
  // state stays so a menu written with cols=N keeps it through an edit here
  // rather than losing it the first time someone reopens the builder.
  const [cols, setCols] = useState('');
  const [link, setLink] = useState<LinkRuleDraft>(emptyLinkDraft('after'));
  // Off when the pick only decides what Show or hide rules print.
  const [print, setPrint] = useState(true);
  // Display Other option: one more choice whose typed text is the answer.
  const [otherOn, setOtherOn] = useState(false);
  const [otherLabel, setOtherLabel] = useState(MENU_OTHER_LABEL);
  // Which ready-made list the values came from. Back to None the moment they
  // are edited, because from then on they are the author's own.
  const [preset, setPreset] = useState(NO_PRESET);

  const firstOptionRef = useRef<HTMLInputElement | null>(null);

  // Every opening starts from a clean menu — a half-built one carried over from
  // a cancelled insert would silently ship into the next snippet — unless an
  // existing menu was handed in, in which case it starts from that.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      const seeded = initial.options.map((label, i) => ({ id: i + 1, label }));
      const loaded = seeded.length > 0 ? seeded : [{ id: 1, label: '' }];
      nextId.current = loaded.length;
      setRows(loaded);
      setSelectedIds(loaded.filter((r) => initial.selected.includes(r.label)).map((r) => r.id));
      setName(initial.name);
      setMultiple(initial.multiple);
      setCols(initial.cols === null ? '' : String(initial.cols));
      setLink(linkDraftFrom(initial.link, 'after'));
      setPrint(initial.print !== false);
      setOtherOn(initial.other !== undefined);
      setOtherLabel(initial.other ?? MENU_OTHER_LABEL);
      setPreset(NO_PRESET);
      return;
    }
    nextId.current = STARTING_ROWS;
    setRows(Array.from({ length: STARTING_ROWS }, (_, i) => ({ id: i + 1, label: '' })));
    // The first choice starts ticked, so a new menu is written with an explicit
    // `default=` rather than relying on the engine's fallback. It also shows the
    // author, in the token preview, exactly which option a menu nobody touches
    // will expand to.
    setSelectedIds([1]);
    // Left blank like Text Blaze: `suggestedName` is only the placeholder, so a
    // name is something you opt into rather than something to clear. A menu
    // from the Fill from a pasted link entry arrives named after its word.
    setName(newName);
    setMultiple(false);
    setCols('');
    setLink(linkDraftFrom(newLink, 'after'));
    setPrint(true);
    setOtherOn(false);
    setOtherLabel(MENU_OTHER_LABEL);
    setPreset(NO_PRESET);
  }, [open, suggestedName, initial, newLink, newName]);

  function updateRow(id: number, label: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
    setPreset(NO_PRESET);
  }

  function addRow() {
    setRows((prev) => [...prev, makeRow()]);
    setPreset(NO_PRESET);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
    setSelectedIds((prev) => prev.filter((s) => s !== id));
    setPreset(NO_PRESET);
  }

  // A ready-made list replaces the values, as JotForm's does. A single-choice
  // menu then opens on its first option; a multiple one on nothing ticked.
  function applyPreset(id: string) {
    setPreset(id);
    const options = menuPresetOptions(id, language);
    if (options.length === 0) return;
    const next = options.map((label) => makeRow(label));
    setRows(next);
    setSelectedIds(multiple || !next[0] ? [] : [next[0].id]);
  }

  // Multiple Choice only: each row's box preselects it. A single-choice menu
  // picks its default from the Selected by default dropdown instead.
  function toggleSelected(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  // Turning multiple off collapses the preselection to the first pick, matching
  // what the written token can actually carry. Turning it on keeps the option
  // the dropdown named, ticked.
  function changeMultiple(next: boolean) {
    setMultiple(next);
    if (next) setSelectedIds(singleDefault ? [singleDefault.id] : []);
    else setSelectedIds((prev) => prev.slice(0, 1));
  }

  // Drag to reorder, matching the grip handles on Text Blaze's rows. The order
  // of `rows` is the order the menu offers, so this is a plain array move.
  const dragId = useRef<number | null>(null);

  function moveRow(fromId: number, toId: number) {
    if (fromId === toId) return;
    setRows((prev) => {
      const from = prev.findIndex((r) => r.id === fromId);
      const to = prev.findIndex((r) => r.id === toId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
    setPreset(NO_PRESET);
  }

  const filledRows = rows.filter((r) => sanitizeMenuOption(r.label) !== '');
  // A single-choice menu always opens on one option (the engine's own rule),
  // so the dropdown always names one: the chosen row while it still has a
  // label, else the first option, which is what the menu would open on anyway.
  const singleDefault =
    filledRows.find((r) => r.id === selectedIds[0]) ?? filledRows[0] ?? null;
  const singleLabel = singleDefault?.label ?? null;
  const preselected = useMemo(
    () =>
      multiple
        ? rows.filter((r) => selectedIds.includes(r.id)).map((r) => r.label)
        : singleLabel !== null
          ? [singleLabel]
          : [],
    [multiple, rows, selectedIds, singleLabel],
  );
  // The name is optional, exactly as it is in Text Blaze: blank is fine and the
  // engine keys the menu itself. Only a non-empty *invalid* name blocks Insert.
  const nameValid = name === '' || isValidMenuName(name);

  const token = useMemo(
    () =>
      buildFormMenuToken({
        options: rows.map((r) => r.label),
        selected: preselected,
        name,
        multiple,
        cols: cols.trim() === '' ? null : Number(cols),
        link: linkFromDraft(link),
        print,
        ...(otherOn ? { other: otherLabel } : {}),
      }),
    [rows, preselected, name, multiple, cols, link, print, otherOn, otherLabel],
  );

  const canInsert = filledRows.length > 0 && nameValid;

  function handleSubmit() {
    if (!canInsert) return;
    onSubmit(token);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[440px] gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstOptionRef.current?.focus();
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{initial ? 'Edit dropdown menu field' : 'Insert dropdown menu field'}</DialogTitle>
          <DialogDescription>
            A menu of choices, picked when the snippet expands.
          </DialogDescription>
        </DialogHeader>

        {list && <div className="min-w-0 px-6 pb-3">{list}</div>}

        <div className="max-h-[60vh] overflow-y-auto px-6 pb-2 flex flex-col gap-4">
          {initial && onNew && (
            <EditingBanner onNew={onNew} newLabel="New menu instead">
              Editing {initial.name || 'this menu'}. Save puts it back where it was.
            </EditingBanner>
          )}

          {/* ── Predefined options: a ready-made list fills the values ── */}
          <div>
            <label htmlFor="form-menu-preset" className={SECTION_LABEL}>
              Predefined options
            </label>
            <select
              id="form-menu-preset"
              value={preset}
              onChange={(e) => applyPreset(e.target.value)}
              className={SELECT}
            >
              <option value={NO_PRESET}>None</option>
              {MENU_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className={HINT}>
              Fill the values with a ready-made list, such as days or months. It replaces the
              values below.
            </p>
          </div>

          {/* ── Values: the options ── */}
          <div>
            <span className={SECTION_LABEL}>Values</span>
            <div className="rounded-[12px] border border-line bg-bg-alt p-3 flex flex-col gap-2">
              {rows.map((row, i) => {
                const isSelected = selectedIds.includes(row.id);
                return (
                  <div
                    key={row.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId.current !== null) moveRow(dragId.current, row.id);
                      dragId.current = null;
                    }}
                    className="flex items-center gap-2.5"
                  >
                    <span
                      draggable
                      onDragStart={() => {
                        dragId.current = row.id;
                      }}
                      onDragEnd={() => {
                        dragId.current = null;
                      }}
                      aria-hidden
                      title="Drag to reorder"
                      className="shrink-0 cursor-grab text-ink-subtle active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    {multiple && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(row.id)}
                        aria-label={`Preselect ${row.label || `choice ${i + 1}`}`}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                      />
                    )}
                    <Input
                      ref={i === 0 ? firstOptionRef : undefined}
                      value={row.label}
                      onChange={(e) => updateRow(row.id, e.target.value)}
                      placeholder={`Choice ${String.fromCharCode(65 + i)}`}
                      className="h-9 rounded-[10px]"
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                      aria-label="Remove this choice"
                      title="Remove this choice"
                      className="shrink-0 rounded-full text-ink-subtle transition-colors hover:text-danger disabled:opacity-40 disabled:hover:text-ink-subtle"
                    >
                      <MinusCircle className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                );
              })}

              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={addRow}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-primary/30 bg-primary-light px-3 text-xs font-semibold text-primary transition-colors hover:border-primary/50"
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            </div>
            <p className={HINT}>
              {multiple
                ? 'The options for the menu. Tick the ones to preselect.'
                : 'The options for the menu.'}
            </p>
          </div>

          {/* ── Selected by default (Single Choice) ── */}
          {/* Multiple Choice keeps a box on each row instead: a dropdown holds
              one answer, and a multiple menu may preselect several. */}
          {!multiple && (
            <div>
              <label htmlFor="form-menu-default" className={SECTION_LABEL}>
                Selected by default
              </label>
              <select
                id="form-menu-default"
                value={singleDefault ? String(singleDefault.id) : ''}
                onChange={(e) => setSelectedIds([Number(e.target.value)])}
                disabled={filledRows.length === 0}
                className={cn(SELECT, 'disabled:opacity-50')}
              >
                {filledRows.length === 0 && <option value="">Add an option first</option>}
                {filledRows.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {sanitizeMenuOption(r.label)}
                  </option>
                ))}
              </select>
              <p className={HINT}>Choose an option to be selected by default.</p>
            </div>
          )}

          {/* ── Display Other option ── */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="form-menu-other" className="text-xs font-medium text-ink-muted">
                Display Other option
              </label>
              <Switch id="form-menu-other" checked={otherOn} onChange={setOtherOn} />
            </div>
            {otherOn && (
              <Input
                aria-label="Other text"
                value={otherLabel}
                onChange={(e) => setOtherLabel(e.target.value)}
                onBlur={() => {
                  if (sanitizeMenuOption(otherLabel) === '') setOtherLabel(MENU_OTHER_LABEL);
                }}
                placeholder={MENU_OTHER_LABEL}
                className="mt-2 h-10 rounded-[10px]"
              />
            )}
            <p className={HINT}>
              {otherOn
                ? 'The name of the extra choice. Whoever picks it types their own answer, and that answer prints.'
                : 'Adds one more choice where whoever fills the snippet can type their own answer.'}
            </p>
          </div>

          {/* ── Field name ── */}
          <div>
            <label htmlFor="form-menu-name" className={SECTION_LABEL}>
              Name <span className="font-normal text-ink-subtle">(optional)</span>
            </label>
            <Input
              id="form-menu-name"
              value={name}
              // Disallowed characters (spaces, symbols) are stripped as they're
              // typed rather than rejected after the fact — a space silently
              // failing validation with no visible cause is a worse experience
              // than the character simply not appearing.
              onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              placeholder={suggestedName}
              className={cn(
                'h-10 rounded-[10px] font-mono',
                !nameValid && 'border-danger focus:border-danger focus:ring-danger/20',
              )}
            />
            {!nameValid ? (
              <p className="mt-1.5 text-[11px] text-danger">
                Letters, numbers and underscore only, starting with a letter — e.g. MENU_1.
              </p>
            ) : name === '' ? (
              <p className={HINT}>
                Name of the form field. Only needed if the body refers back to the choice — leave
                it blank and the menu still works.
              </p>
            ) : (
              <p className={HINT}>
                Name of the form field — the body reads it back as{' '}
                <code className="font-mono text-primary/80">{`{${name}}`}</code>.
              </p>
            )}
            {initial && nameValid && initial.name !== '' && name !== '' && (
              <RenameNote from={initial.name} to={name} readers={readers} />
            )}
          </div>

          {/* ── Single vs multiple ── */}
          {/* Both answers deserve a name here: "off" would have to stand for
              single choice, which is a real setting and not an absence. */}
          <div>
            <span className={SECTION_LABEL}>Selection</span>
            <Segmented
              ariaLabel="How many options can be picked"
              value={multiple ? 'multiple' : 'single'}
              options={[
                { value: 'single', label: 'Single Choice' },
                { value: 'multiple', label: 'Multiple Choice' },
              ]}
              onChange={(next) => changeMultiple(next === 'multiple')}
            />
            <p className={HINT}>
              Single Choice fills as radio buttons, Multiple Choice as checkboxes.
            </p>
          </div>

          {/* ── Printed, or only asked ── */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="form-menu-print" className="text-xs font-medium text-ink-muted">
                Print the picked option
              </label>
              <Switch id="form-menu-print" checked={print} onChange={setPrint} />
            </div>
            <p className={HINT}>
              {print
                ? 'The option picked prints where the field sits in the message.'
                : 'The field is still asked, but nothing prints where it sits. Its answer only decides what Show or hide rules print.'}
            </p>
          </div>

          {/* ── From a link ── */}
          {/* The page has to name one of the options above, exactly; anything
              else is left for the operator to pick. */}
          <LinkRuleFields
            id="form-menu-link"
            value={link}
            onChange={setLink}
            modes={LABEL_LINK_MODES}
            onEnter={handleSubmit}
          />

          {/* ── What lands in the body ── */}
          <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-1">
              {initial ? 'Saves as' : 'Inserts'}
            </p>
            <code className="block font-mono text-[11px] leading-relaxed text-ink-muted break-all">
              {token}
            </code>
          </div>
        </div>

        <div className="px-6 py-4 mt-2 border-t border-line flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={!canInsert}>
            {initial ? 'Save' : 'Insert'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
