import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { placeMenu } from '@/lib/menuPlacement';
import { TEXT_COLORS, TEXT_COLOR_KEYS, type TextColor } from '@/lib/textColors';
import { cn } from '@/lib/utils';

/**
 * The formatting bar's Text colour button and its menu, as Notion has them:
 * Default and nine colours, each row an "A" in its colour beside its name, so
 * a colour is never told by its shade alone. The button's bar shows the
 * colour at the selection, and its name says it.
 */
interface TextColorButtonProps {
  /** The colour at the selection, null for the default. */
  value: TextColor | null;
  disabled?: boolean;
  onPick: (color: TextColor | null) => void;
}

const OPTIONS: readonly (TextColor | null)[] = [null, ...TEXT_COLOR_KEYS];
const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

function colorName(color: TextColor | null): string {
  return color ? TEXT_COLORS[color].name : 'Default';
}

export function TextColorButton({ value, disabled, onPick }: TextColorButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Opened from the keyboard, the menu takes focus; from the mouse, the body
  // box keeps it, and the selection stays in sight.
  const fromKeyboard = useRef(false);
  const [open, setOpen] = useState(false);

  // The menu sits under its button, or over it when there is no room below.
  // It is drawn inside the editor window, whose transform makes the window
  // the frame a `fixed` box is measured from: the menu's own place at 0,0
  // says where that frame starts on the screen.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.maxHeight = '';
    const origin = menu.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    const frame = trigger.closest('[role="dialog"]')?.getBoundingClientRect();
    const frameTop = frame?.top ?? 0;
    const place = placeMenu({
      triggerTop: rect.top - frameTop,
      triggerBottom: rect.bottom - frameTop,
      contentHeight: menu.scrollHeight,
      viewportHeight: frame?.height ?? window.innerHeight,
      maxHeight: 400,
    });
    menu.style.left = `${rect.left - origin.left}px`;
    menu.style.top = `${place.top + frameTop - origin.top}px`;
    menu.style.maxHeight = `${place.maxHeight}px`;
  }, [open]);

  // The chosen row takes focus, so the arrow keys start from the colour in use.
  useEffect(() => {
    if (!open || !fromKeyboard.current) return;
    itemRefs.current[Math.max(0, OPTIONS.indexOf(value))]?.focus({ preventScroll: true });
    // Only when the menu opens: picking closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A click elsewhere, Escape, or the page moving under it closes the menu.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Heard before the editor window, which would close itself on Escape:
    // the key closes the menu only.
    function onEscape(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      if (menuRef.current?.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true });
    }
    function onScroll(e: Event) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onEscape, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onEscape, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function pick(color: TextColor | null) {
    setOpen(false);
    onPick(color);
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      fromKeyboard.current = true;
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = itemRefs.current;
    const current = items.findIndex((el) => el === document.activeElement);
    const last = OPTIONS.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = current < last ? current + 1 : 0;
    else if (e.key === 'ArrowUp') next = current > 0 ? current - 1 : last;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next !== null) {
      e.preventDefault();
      items[next]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <>
      <Tooltip label="Text colour" placement="top" className="flex">
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Text colour: ${colorName(value)}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            // A click from Enter or Space carries no pointer detail.
            fromKeyboard.current = e.detail === 0;
            setOpen((v) => !v);
          }}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            'flex h-7 items-center gap-0.5 rounded-[6px] pl-1.5 pr-1 text-ink-muted transition-colors hover:bg-bg-alt hover:text-ink',
            FOCUS_RING,
            open && 'bg-bg-alt text-ink',
          )}
        >
          <span aria-hidden className="flex w-3.5 flex-col items-center">
            <span className="text-[13px] font-semibold leading-none">A</span>
            <span className={cn('mt-[3px] h-[3px] w-3.5 rounded-full', value ? TEXT_COLORS[value].fill : 'bg-current')} />
          </span>
          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </Tooltip>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Text colour"
          onKeyDown={onMenuKeyDown}
          className="fixed z-[60] w-[184px] animate-fade-in overflow-y-auto rounded-[12px] border border-line bg-card p-1.5 shadow-md"
        >
          <p aria-hidden className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-ink-subtle">
            Text colour
          </p>
          {OPTIONS.map((key, index) => {
            const on = key === value;
            return (
              <button
                key={key ?? 'default'}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(key)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-ink hover:bg-bg-alt focus:bg-bg-alt',
                  FOCUS_RING,
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-line text-[12px] font-semibold',
                    key ? TEXT_COLORS[key].text : 'text-ink',
                  )}
                >
                  A
                </span>
                <span className="flex-1">{colorName(key)}</span>
                {on && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
