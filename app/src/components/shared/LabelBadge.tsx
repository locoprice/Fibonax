import { X } from 'lucide-react';
import { labelSwatch } from '@/lib/labelColors';
import { labelPath } from '@/lib/labelTree';
import { cn } from '@/lib/utils';
import type { Label } from '@/types/database';

interface LabelBadgeProps {
  label: Label;
  className?: string;
  /** Details shows the full path and a visible, keyboard-accessible remove button. */
  variant?: 'compact' | 'detail';
  disabled?: boolean;
  /**
   * Reveals a hover-expand × that removes this label. Used on snippet rows and
   * prompt cards. Omit it wherever the badge sits inside another interactive
   * element, such as the label picker's trigger button: a button nested inside a
   * button is invalid HTML and the inner control is not reliably reachable.
   * Excluded from tab order (`tabIndex={-1}`): it's a pointer shortcut for
   * something already reachable via the picker's dropdown checkbox, not a new
   * capability that needs its own keyboard path.
   */
  onRemove?: () => void;
  /**
   * Full "Parent / Child" path for the tooltip. The chip itself always shows
   * the bare name — a table row has no space for a path, and the parent is
   * usually obvious in context — so hovering is how you disambiguate two
   * sub-labels that happen to read alike.
   */
  path?: string;
}

/**
 * A label as it appears on a snippet row or a prompt card. Colour comes from
 * the closed palette in lib/labelColors.ts — the row stores a key, never a hex.
 */
export function LabelBadge({ label, className, onRemove, path, variant = 'compact', disabled }: LabelBadgeProps) {
  const swatch = labelSwatch(label.color);
  const detail = variant === 'detail';
  return (
    <span
      title={path ?? label.name}
      className={cn(
        detail
          ? 'inline-flex max-w-full items-center gap-1 rounded-md bg-bg-alt pl-2 text-xs leading-relaxed'
          : 'group/badge inline-flex max-w-[140px] items-center rounded-full border py-px text-[10px] font-semibold leading-4',
        detail ? (onRemove ? '' : 'py-1 pr-2') : onRemove ? 'pl-2 pr-1' : 'px-2',
        !detail && swatch.chip,
        className,
      )}
    >
      <span className={detail ? 'min-w-0 whitespace-normal break-words' : 'truncate'}>{detail ? path ?? label.name : label.name}</span>
      {onRemove && (
        <button
          type="button"
          tabIndex={detail ? undefined : -1}
          disabled={disabled}
          aria-label={`Remove ${path ?? label.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={detail
            ? 'flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-bg hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-50'
            : 'ml-0.5 flex w-0 shrink-0 items-center justify-center overflow-hidden rounded-full opacity-0 transition-all duration-150 hover:opacity-70 group-hover/badge:w-3 group-hover/badge:opacity-100'}
        >
          <X className={detail ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

interface LabelBadgeListProps {
  labels: Label[];
  /** Show at most this many; the rest collapse into a "+N" chip. */
  max?: number;
  className?: string;
  /** Reveals a hover-expand × on every shown chip, wired to that label's id. */
  onRemove?: (labelId: string) => void;
  /**
   * The full vocabulary. Supplied only so a sub-label's tooltip can name its
   * parent; omit it and every chip falls back to its bare name.
   */
  catalog?: readonly Label[];
}

/** Badge row with an overflow chip, so a heavily labelled asset can't wrap forever. */
export function LabelBadgeList({
  labels,
  max = 3,
  className,
  onRemove,
  catalog,
}: LabelBadgeListProps) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const hidden = labels.slice(max);
  const pathOf = (label: Label) => (catalog ? labelPath(catalog, label.id) : label.name);

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {shown.map((label) => (
        <LabelBadge
          key={label.id}
          label={label}
          path={pathOf(label)}
          onRemove={onRemove ? () => onRemove(label.id) : undefined}
        />
      ))}
      {hidden.length > 0 && (
        <span
          title={hidden.map(pathOf).join(', ')}
          className="inline-flex items-center rounded-full bg-bg-alt px-1.5 py-px text-[10px] font-semibold leading-4 text-ink-subtle"
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
}
