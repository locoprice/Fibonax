import { cn } from '@/lib/utils';
import type { SbFillProgress } from '@/lib/fillFormEngine';

/**
 * The line above a long fill form that says how far along it is: a thin
 * track, the filled share, and "3 of 8 filled in" beside it.
 *
 * What it counts and when it shows come from `fillForm(...).progress`, the
 * same answer the in-page overlay, the popup and the phone draw through
 * `extension/shared/fill-form-ui.js`. This only draws it the way the
 * dashboard draws things. Nothing under the threshold: the component then
 * renders nothing at all.
 */
export function FillProgress({ progress }: { progress: SbFillProgress | undefined }) {
  if (!progress?.show) return null;
  const complete = progress.total > 0 && progress.done === progress.total;
  return (
    <div className="flex shrink-0 items-center gap-3 px-4 pb-3">
      <div
        role="progressbar"
        aria-label="Form progress"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-valuetext={progress.label}
        className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      {/* The same words the bar carries as its value, so a screen reader
          hears them once. */}
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 text-[11px] font-medium leading-relaxed tabular-nums',
          complete ? 'text-primary' : 'text-ink-muted',
        )}
      >
        {progress.label}
      </span>
    </div>
  );
}
