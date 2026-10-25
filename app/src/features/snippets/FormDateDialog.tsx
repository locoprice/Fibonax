import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { RenameNote } from '@/features/snippets/formulaDialogParts';
import { cn } from '@/lib/utils';
import {
  buildFormDateToken,
  dateFormatOptions,
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  isValidFieldName,
  TIME_FORMAT_OPTIONS,
  type DateFieldKind,
  type FormDateConfig,
} from '@/lib/formDateToken';

const HINT = 'text-[11px] text-ink-subtle mt-1.5';
const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';
const SELECT =
  'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

const KIND_OPTIONS: readonly { value: DateFieldKind; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
];

interface FormDateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The date or time field being changed. Must stay the same object while
   * open: the window reloads whenever it changes.
   */
  initial: FormDateConfig | null;
  /** The snippet's language, or '' for a Multi body, for Written out's sample. */
  lang?: string;
  /** The date and time fields already in the snippet, listed above the form. */
  list?: ReactNode;
  /** How many other parts read the field being changed, for the rename note. */
  readers?: number;
  onSave: (token: string) => void;
}

/**
 * Changes a date or time field already in the snippet: its name, whether it
 * opens a calendar or a clock, and how it prints. New ones are inserted
 * straight from the side panel, where the format sits beside the button; this
 * is the window their Edit opens. Where on a pasted page the field reads its
 * value is set in the Fill from a web page window, and kept here as it was.
 *
 * The token is written by `@/lib/formDateToken`, the writer the panel uses,
 * so a field changed here reads exactly like one inserted there.
 */
export function FormDateDialog({
  open,
  onOpenChange,
  initial,
  lang = '',
  list,
  readers = 0,
  onSave,
}: FormDateDialogProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DateFieldKind>('date');
  const [format, setFormat] = useState<string>(DEFAULT_DATE_FORMAT);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !initial) return;
    setName(initial.name);
    setKind(initial.kind);
    setFormat(initial.format !== '' ? initial.format : initial.kind === 'time' ? DEFAULT_TIME_FORMAT : DEFAULT_DATE_FORMAT);
  }, [open, initial]);

  const nameValid = isValidFieldName(name);
  const options = kind === 'time' ? TIME_FORMAT_OPTIONS : dateFormatOptions(lang);

  const token = useMemo(
    () => buildFormDateToken({ name, kind, format, link: initial?.link ?? '', after: initial?.after ?? '' }),
    [name, kind, format, initial],
  );

  function changeKind(next: DateFieldKind) {
    setKind(next);
    // A date format means nothing to a clock, and the other way round.
    setFormat(next === 'time' ? DEFAULT_TIME_FORMAT : DEFAULT_DATE_FORMAT);
  }

  function handleSubmit() {
    if (!nameValid || !initial) return;
    onSave(token);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[440px] gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{kind === 'time' ? 'Edit time field' : 'Edit date field'}</DialogTitle>
          <DialogDescription>Picked in the fill form, printed in the format you choose.</DialogDescription>
        </DialogHeader>

        {list && <div className="min-w-0 px-6 pb-3">{list}</div>}

        <div className="max-h-[60vh] overflow-y-auto px-6 pb-2 flex flex-col gap-4">
          {/* ── Kind ── */}
          <div>
            <span className={SECTION_LABEL}>Opens</span>
            <Segmented
              options={KIND_OPTIONS}
              value={kind}
              onChange={changeKind}
              ariaLabel="Date or time"
              className="w-full [&>button]:flex-1"
            />
            <p className={HINT}>A date opens a calendar, a time opens a clock.</p>
          </div>

          {/* ── Name ── */}
          <div>
            <label htmlFor="form-date-name" className={SECTION_LABEL}>
              Name
            </label>
            <Input
              id="form-date-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className={cn(
                'h-10 rounded-[10px] font-mono',
                !nameValid && 'border-danger focus:border-danger focus:ring-danger/20',
              )}
            />
            {nameValid ? (
              initial && <RenameNote from={initial.name} to={name} readers={readers} />
            ) : (
              <p className="mt-1.5 text-[11px] text-danger">
                A date field needs a name, or it expands to nothing. Letters, numbers and
                underscore, starting with a letter. For example DATE_1.
              </p>
            )}
          </div>

          {/* ── Format ── */}
          <div>
            <label htmlFor="form-date-format" className={SECTION_LABEL}>
              Format
            </label>
            <select
              id="form-date-format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className={SELECT}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} · {o.sample}
                </option>
              ))}
            </select>
          </div>

          {nameValid && (
            <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-1">
                Saves as
              </p>
              <code className="block font-mono text-[11px] leading-relaxed text-ink-muted break-all">
                {token}
              </code>
            </div>
          )}
        </div>

        <div className="px-6 py-4 mt-2 border-t border-line flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={!nameValid || !initial}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
