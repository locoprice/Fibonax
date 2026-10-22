import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
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
//   [ scope chips ] | [ filter menus ]                 [ Clear ] [ Sort ] [ extras ]
//
// This module stays free of stores so a pure-logic test can import a page's
// filters without dragging in uiStore's localStorage bootstrap.

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

interface AssetFilterBarProps {
  /** Left side: scope chips, then filter menus. */
  children: ReactNode;
  /** Right side: Clear, Sort and anything only this page has. */
  end?: ReactNode;
}

export function AssetFilterBar({ children, end }: AssetFilterBarProps) {
  return (
    <div
      role="group"
      aria-label="Filter and sort"
      className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-card px-3 py-2"
    >
      {children}
      {end ? <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div> : null}
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
export function FilterButton({
  active = false,
  className,
  type = 'button',
  ...props
}: FilterButtonProps) {
  return (
    <button
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
  );
}

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
            'text-[11px] font-semibold tabular-nums',
            active ? 'text-primary/70' : 'text-ink-subtle',
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

interface FilterDropdownProps<T extends string> {
  label: string;
  value: T | null;
  options: readonly T[];
  onSelect: (value: T | null) => void;
}

/** A pick-one menu. Choosing the chosen option again clears it. */
export function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onSelect,
}: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(option: T) {
    onSelect(option === value ? null : option);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <FilterButton
        aria-haspopup="menu"
        aria-expanded={open}
        active={value !== null}
        onClick={() => setOpen((v) => !v)}
      >
        {value ?? label}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </FilterButton>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-2 w-44 animate-fade-in rounded-[12px] border border-line bg-card p-1.5 shadow-md"
        >
          {options.map((option) => {
            const on = option === value;
            return (
              <button
                key={option}
                role="menuitemradio"
                aria-checked={on}
                type="button"
                onClick={() => pick(option)}
                className={cn(
                  'flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-xs font-medium hover:bg-bg-alt',
                  FOCUS_RING,
                  on ? 'text-primary' : 'text-ink',
                )}
              >
                {option}
                {on && <Check className="h-3.5 w-3.5" />}
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
