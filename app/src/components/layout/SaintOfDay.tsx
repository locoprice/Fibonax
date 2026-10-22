import { saintLabel } from '@/lib/saintOfDay';
import { useSaintOfDay } from '@/lib/useSaintOfDay';
import { useUiStore } from '@/stores/uiStore';

/**
 * "Santo del Giorno · <name>" in the footer. Plain text, no tooltip, no click.
 * Draws nothing until there is a saint to show: switched off in Settings,
 * offline, or a day the source could not be read. The popup footer carries the
 * same line (extension/popup/popup.js, renderSaint).
 */
export function SaintOfDay() {
  const enabled = useUiStore((s) => s.saintOfDayEnabled);
  const name = useSaintOfDay(enabled);
  if (!name) return null;
  return (
    <>
      <span lang="it" className="min-w-0 truncate text-[10px] text-ink-subtle">
        {saintLabel(name)}
      </span>
      {/* Divides the saint from the Christmas line; there only while the saint is. */}
      <span aria-hidden className="h-3 w-px shrink-0 bg-line" />
    </>
  );
}
