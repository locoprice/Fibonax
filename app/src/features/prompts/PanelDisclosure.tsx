import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PanelDisclosureProps {
  /** Id of the part that opens, for aria-controls. */
  id: string;
  icon: LucideIcon;
  title: ReactNode;
  /** One line under the title: what is inside, or how it stands. */
  summary: ReactNode;
  children: ReactNode;
}

/**
 * A closed row in the prompt editor that opens to show more: the Quality score
 * and More options. Closed by default, so the panel shows what most people need
 * and keeps the rest one click away. It remembers being open while the editor
 * stays on the page.
 */
export function PanelDisclosure({ id, icon: Icon, title, summary, children }: PanelDisclosureProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-bg-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        <Icon className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">{title}</span>
          <span className="block text-xs text-ink-muted">{summary}</span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-150', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {/* Always in the page, so aria-controls always has a target. */}
      <div id={id} hidden={!open} className="px-5 pb-5 pt-1">
        {children}
      </div>
    </section>
  );
}
