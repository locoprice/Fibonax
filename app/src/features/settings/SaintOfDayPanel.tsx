import { Church } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useUiStore } from '@/stores/uiStore';

/**
 * "Santo del Giorno" card: the one switch for the saint line in the footer.
 *
 * On until turned off, and kept on this device only (like the folder rail and
 * the sidebar), so it is not part of the account. The popup has its own switch.
 * The countdown beside the saint in the footer is not here on purpose: it is
 * always shown.
 *
 * Applies at once: the footer under this page follows the switch.
 */
export function SaintOfDayPanel() {
  const enabled = useUiStore((s) => s.saintOfDayEnabled);
  const setEnabled = useUiStore((s) => s.setSaintOfDayEnabled);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Church className="h-4 w-4 text-primary" aria-hidden />
          Santo del Giorno
        </CardTitle>
        <CardDescription>
          Shows the saint of the day in the footer, read from Vatican News. This applies to this
          device only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="saint-of-day" className="text-xs font-medium text-ink-muted">
            Show the saint of the day in the footer
          </label>
          <Switch id="saint-of-day" checked={enabled} onChange={setEnabled} />
        </div>
      </CardContent>
    </Card>
  );
}
