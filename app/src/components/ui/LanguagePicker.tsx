import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Globe, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SOURCE_LANGUAGE, setPageLanguage, usePageTranslate } from '@/lib/pageTranslate';
import {
  findPageLanguage,
  searchPageLanguages,
  suggestedPageLanguages,
  type PageLanguage,
} from '@/lib/pageTranslateLanguages';
import { cn } from '@/lib/utils';

/**
 * The language choice for the dashboard: a globe that opens a searchable list
 * of every language Google's page translator offers.
 *
 * English is the dashboard's own language and sits first. The languages this
 * browser asks for come next, so most people find theirs without typing.
 * Names are shown in their own language and never translated, so the list
 * reads the same whatever the page is showing.
 */

const ENGLISH: PageLanguage = { code: SOURCE_LANGUAGE, name: 'English', native: 'English' };

const PAD = 8;
const MENU_WIDTH = 288;
const MENU_MAX_HEIGHT = 420;
const MENU_MIN_HEIGHT = 220;

interface LanguagePickerProps {
  /** `compact` shows the globe and a two-letter code; `named` shows the language's name. */
  variant?: 'compact' | 'named';
}

function shortCode(code: string): string {
  return (code.split('-')[0] ?? code).toUpperCase();
}

function matchesEnglish(query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === '' || 'english'.includes(needle) || needle === SOURCE_LANGUAGE;
}

export function LanguagePicker({ variant = 'compact' }: LanguagePickerProps) {
  const { language, status } = usePageTranslate();
  const current = findPageLanguage(language) ?? ENGLISH;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [box, setBox] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  const suggested = useMemo(
    () => suggestedPageLanguages(typeof navigator === 'undefined' ? [] : navigator.languages),
    [],
  );
  const searching = query.trim() !== '';
  const results = useMemo(() => searchPageLanguages(query), [query]);
  const showEnglish = matchesEnglish(query);
  const showSuggested = !searching && suggested.length > 0;

  function close(returnFocus: boolean) {
    setOpen(false);
    setQuery('');
    if (returnFocus) triggerRef.current?.focus();
  }

  function pick(code: string) {
    close(true);
    setPageLanguage(code);
  }

  // Under the trigger and right-aligned with it, kept inside the window; above
  // it when the room below is too short for a usable list.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(PAD, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - PAD));
    const below = window.innerHeight - rect.bottom - 4 - PAD;
    const above = rect.top - 4 - PAD;
    if (below >= MENU_MIN_HEIGHT || below >= above) {
      setBox({ left, top: rect.bottom + 4, maxHeight: Math.min(MENU_MAX_HEIGHT, below) });
    } else {
      const maxHeight = Math.min(MENU_MAX_HEIGHT, above);
      setBox({ left, top: rect.top - 4 - maxHeight, maxHeight });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    function onReflow(e: Event) {
      // The list scrolls inside the menu; only the page moving closes it.
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      close(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  function options(): HTMLButtonElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const all = options();
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    // Home and End keep their usual meaning while typing in the search box.
    if (at === -1 && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? all.length - 1
      : e.key === 'ArrowDown' ? Math.min(at + 1, all.length - 1)
      : at - 1;
    if (next < 0) {
      menuRef.current?.querySelector('input')?.focus();
      return;
    }
    all[next]?.focus();
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Enter takes the first match, so "ital" then Enter is enough.
    if (e.key !== 'Enter' || !searching) return;
    const first = options()[0];
    if (first) {
      e.preventDefault();
      first.click();
    }
  }

  function row(item: PageLanguage, note?: string) {
    const selected = item.code === language;
    const aside = note ?? (item.native === item.name ? '' : item.name);
    return (
      <button
        key={item.code}
        type="button"
        role="option"
        aria-selected={selected}
        onClick={() => pick(item.code)}
        className={cn(
          'flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          selected ? 'bg-primary-light text-primary' : 'text-ink hover:bg-bg-alt',
        )}
      >
        <span className="min-w-0 flex-1 truncate" lang={item.code}>
          {item.native}
        </span>
        {aside !== '' && (
          <span className={cn('shrink-0 text-xs', selected ? 'text-primary' : 'text-ink-subtle')}>
            {aside}
          </span>
        )}
        {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      </button>
    );
  }

  const busy = status === 'loading';
  const Icon = busy ? Loader2 : Globe;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Language: ${current.native}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Language"
        onClick={() => (open ? close(false) : setOpen(true))}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-line bg-bg-alt px-2.5',
          'text-xs font-semibold transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          language === SOURCE_LANGUAGE ? 'text-ink-muted hover:text-ink' : 'text-primary',
          open && 'text-ink',
        )}
      >
        <Icon className={cn('h-3.5 w-3.5', busy && 'animate-spin')} aria-hidden="true" />
        <span translate="no" lang={variant === 'named' ? current.code : undefined}>
          {variant === 'named' ? current.native : shortCode(current.code)}
        </span>
      </button>

      {open &&
        box !== null &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="Language"
            onKeyDown={onMenuKeyDown}
            className="fixed z-[60] flex flex-col overflow-hidden rounded-[12px] border border-line bg-card shadow-lg"
            style={{ left: box.left, top: box.top, width: MENU_WIDTH, maxHeight: box.maxHeight }}
          >
            <div className="relative shrink-0 border-b border-line p-2">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search languages"
                aria-label="Search languages"
                className="h-9 pl-9"
              />
            </div>

            <div
              ref={listRef}
              role="listbox"
              aria-label="Languages"
              translate="no"
              className="min-h-0 flex-1 overflow-y-auto p-1.5"
            >
              {showEnglish && row(ENGLISH, 'Original')}
              {showSuggested && suggested.map((item) => row(item))}
              {(showEnglish || showSuggested) && results.length > 0 && (
                <div className="my-1 h-px bg-line" aria-hidden="true" />
              )}
              {results
                .filter((item) => !showSuggested || !suggested.includes(item))
                .map((item) => row(item))}
              {!showEnglish && results.length === 0 && (
                <p className="px-2.5 py-3 text-[13px] text-ink-muted" translate="yes">
                  No language matches that. Try its English name.
                </p>
              )}
            </div>

            {status === 'failed' && (
              <p role="status" className="shrink-0 border-t border-line px-3 py-2 text-xs text-danger">
                The translation could not load. Check your connection, then pick the language again.
              </p>
            )}
            <p className="shrink-0 border-t border-line px-3 py-2 text-[11px] leading-snug text-ink-subtle">
              Translated by Google. Your snippets, prompts and Brains stay as you wrote them.
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
