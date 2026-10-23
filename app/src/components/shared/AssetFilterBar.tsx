import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, X } from 'lucide-react';
import type { SortDir } from '@/lib/sortToggle';
import { cn } from '@/lib/utils';

// The filter bar under the page header on Snippets, Prompts and Brains.
//
// One shell and one set of controls, so the three pages read as one product:
// what can be filtered differs, how the bar looks and behaves does not. A page
// fills the slots it has something for and leaves the rest out; it never
// restyles a piece.
//
//   [ scope chips ] [ filter menus ] [ Clear ]                    [ Sort ] [ extras ]
//
// The left side wraps onto a second line when it runs out of room; the right
// side stays on the first line, so Sort never drops to a row of its own and
// never moves when a filter is applied.
//
// This module stays free of stores so a pure-logic test can import a page's
// filters without dragging in uiStore's localStorage bootstrap.

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

interface AssetFilterBarProps {
  /** Left side: scope chips, filter menus, then Clear. */
  children: ReactNode;
  /** Right side: Sort and anything only this page has. */
  end?: ReactNode;
}

export function AssetFilterBar({ children, end }: AssetFilterBarProps) {
  return (
    <div
      role="group"
      aria-label="Filter and sort"
      className={cn(
        'grid items-start gap-x-4 gap-y-2 rounded-[10px] border border-line bg-card px-3 py-2',
        end ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {/* h-8 is the height of a chip, so the right side lines up with the first row. */}
      {end ? <div className="flex h-8 shrink-0 items-center gap-2">{end}</div> : null}
    </div>
  );
}

/** A thin rule between groups of controls. */
export function FilterDivider() {
  return <span className="h-5 w-px shrink-0 bg-line" aria-hidden="true" />;
}

interface FilterButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** A filter is applied: the button takes the accent. */
  active?: boolean;
}

/** The look every menu trigger and quiet action in the bar shares. */
export const FilterButton = forwardRef<HTMLButtonElement, FilterButtonProps>(
  ({ active = false, className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium transition-colors',
        FOCUS_RING,
        active
          ? 'border-primary/30 bg-primary-light text-primary'
          : 'border-line bg-card text-ink-muted hover:border-primary/20 hover:text-ink',
        className,
      )}
      {...props}
    />
  ),
);
FilterButton.displayName = 'FilterButton';

interface FilterChipProps {
  label: string;
  /** Left out while it is not known yet, so a count never reads as an answer. */
  count?: number;
  icon?: ReactNode;
  badge?: ReactNode;
  active?: boolean;
  /** Without it the chip is a label: it shows a scope that cannot be changed. */
  onClick?: () => void;
}

const CHIP_BASE =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium';

export function FilterChip({
  label,
  count,
  icon,
  badge,
  active = false,
  onClick,
}: FilterChipProps) {
  const tone = active
    ? 'border-primary/30 bg-primary-light text-primary'
    : 'border-line bg-card text-ink-muted';
  const content = (
    <>
      {icon}
      <span className="max-w-[160px] truncate">{label}</span>
      {badge}
      {count === undefined ? null : (
        <span
          className={cn(
            'rounded-full px-1.5 text-[11px] font-semibold leading-5 tabular-nums',
            active ? 'bg-primary/10 text-primary' : 'bg-bg-alt text-ink-subtle',
          )}
        >
          {count}
        </span>
      )}
    </>
  );

  if (!onClick) return <span className={cn(CHIP_BASE, tone)}>{content}</span>;

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        CHIP_BASE,
        FOCUS_RING,
        'transition-colors',
        tone,
        !active && 'hover:border-primary/20 hover:text-ink',
      )}
    >
      {content}
    </button>
  );
}

/** Chips that wrap onto a second line instead of pushing the bar wider. */
export function FilterChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap items-center gap-1.5">
      {children}
    </div>
  );
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

/** Options whose label is the value itself, like Strategy. */
export function plainOptions<T extends string>(values: readonly T[]): Array<FilterOption<T>> {
  return values.map((value) => ({ value, label: value }));
}

interface FilterDropdownProps<T extends string> {
  label: string;
  /** Sits before the label, so every menu in the bar carries one. */
  icon?: ReactNode;
  value: T | null;
  options: ReadonlyArray<FilterOption<T>>;
  onSelect: (value: T | null) => void;
}

/**
 * A pick-one menu. Choosing the chosen option again clears it, and the button
 * names both the filter and its value ("Strategy: CoT"), so a lit button never
 * leaves anyone wondering what it is filtering. The arrow keys walk the options.
 */
export function FilterDropdown<T extends string>({
  label,
  icon,
  value,
  options,
  onSelect,
}: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const chosen = options.find((option) => option.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // The chosen row, or the first, takes focus: the arrow keys start from where
  // the value is. Only when the menu opens; picking a row closes it.
  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, options.findIndex((option) => option.value === value));
    itemRefs.current[index]?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function pick(option: FilterOption<T>) {
    onSelect(option.value === value ? null : option.value);
    close(true);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!open) {
      if (event.target === triggerRef.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    const items = itemRefs.current;
    const current = items.findIndex((el) => el === document.activeElement);
    const last = options.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = current < last ? current + 1 : 0;
    else if (event.key === 'ArrowUp') next = current > 0 ? current - 1 : last;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // The key stops here, so a panel open on the page is not closed by it too.
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  }

  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
      <FilterButton
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        active={chosen !== null}
        className={cn(open && chosen === null && 'border-primary/30 text-ink')}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span>{chosen ? `${label}:` : label}</span>
        {chosen ? <span className="font-semibold">{chosen.label}</span> : null}
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </FilterButton>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute left-0 top-full z-40 mt-2 min-w-[11rem] animate-fade-in rounded-[12px] border border-line bg-card p-1.5 shadow-md"
        >
          {options.map((option, index) => {
            const on = option.value === value;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                role="menuitemradio"
                aria-checked={on}
                type="button"
                tabIndex={-1}
                onClick={() => pick(option)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-[8px] px-3 py-2 text-xs font-medium hover:bg-bg-alt focus:bg-bg-alt',
                  FOCUS_RING,
                  on ? 'text-primary' : 'text-ink',
                )}
              >
                {option.label}
                {on && <Check className="h-3.5 w-3.5" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ClearFiltersButtonProps {
  count: number;
  onClear: () => void;
}

/** Shown only while something is narrowing the list. */
export function ClearFiltersButton({ count, onClear }: ClearFiltersButtonProps) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClear}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-[6px] px-1 text-xs text-ink-muted hover:text-danger',
        FOCUS_RING,
      )}
    >
      <X className="h-3.5 w-3.5" aria-hidden />
      Clear {count} filter{count > 1 ? 's' : ''}
    </button>
  );
}

interface SortControlProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  sortBy: T;
  sortDir: SortDir;
  onSort: (column: T) => void;
}

/** Sort buttons. The active one shows its direction; clicking it again flips it. */
export function SortControl<T extends string>({
  options,
  sortBy,
  sortDir,
  onSort,
}: SortControlProps<T>) {
  return (
    <div role="group" aria-label="Sort by" className="flex items-center gap-0.5">
      <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        Sort
      </span>
      {options.map((option) => {
        const active = sortBy === option.value;
        const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={
              active
                ? `Sort by ${option.label}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`
                : `Sort by ${option.label}`
            }
            onClick={() => onSort(option.value)}
            className={cn(
              'flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs transition-colors',
              FOCUS_RING,
              active ? 'bg-primary-light font-medium text-primary' : 'text-ink-muted hover:bg-bg-alt',
            )}
          >
            {option.label}
            <Icon className="h-3 w-3" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
