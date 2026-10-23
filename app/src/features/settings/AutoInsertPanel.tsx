import { useState } from 'react';
import { AlertCircle, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  AUTO_INSERT_DEFAULT_SECONDS,
  AUTO_INSERT_MAX_SECONDS,
  AUTO_INSERT_MIN_SECONDS,
} from '@/lib/triggerUtils';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import type { ProfilePatch } from '@/lib/api/settingsApi';

const SECOND_CHOICES = Array.from(
  { length: AUTO_INSERT_MAX_SECONDS - AUTO_INSERT_MIN_SECONDS + 1 },
  (_, i) => AUTO_INSERT_MIN_SECONDS + i,
);

function secondsLabel(n: number): string {
  return n === 1 ? '1 second' : `${n} seconds`;
}

/**
 * "Insert automatically" card (AUTO-INSERT-001).
 *
 * Off by default. When on, typing the trigger and a few letters that leave only
 * one snippet inserts it after the wait picked here, with the menu open the
 * whole time. Persists to `user_metadata`, which is also where the Chrome
 * extension reads it; the popup has no control of its own because it does not
 * write settings (v2.87.0).
 *
 * Applies at once on every change, like the unused-snippets card: there is
 * nothing to mistype and nothing to undo.
 */
export function AutoInsertPanel() {
  const profile = useSettingsStore((s) => s.profile);
  const editProfile = useSettingsStore((s) => s.editProfile);
  const showToast = useUiStore((s) => s.showToast);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const enabled = profile?.trigger_auto_insert ?? false;
  const seconds = profile?.trigger_auto_insert_seconds ?? AUTO_INSERT_DEFAULT_SECONDS;
  const busy = saving || profile === null;

  async function save(patch: ProfilePatch, message: string) {
    if (saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await editProfile(patch);
      showToast(message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" aria-hidden />
          Insert automatically
        </CardTitle>
        <CardDescription>
          Type your trigger and a few letters. When only one snippet fits, Fibonax can insert it
          for you after a short wait. Turned off, you pick the snippet from the list with Tab or
          Enter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="auto-insert" className="text-xs font-medium text-ink-muted">
            Insert when only one snippet fits
          </label>
          <Switch
            id="auto-insert"
            checked={enabled}
            disabled={busy}
            onChange={(next) =>
              void save(
                { trigger_auto_insert: next },
                next ? 'Automatic insert is on' : 'Automatic insert is off',
              )
            }
          />
        </div>

        {enabled ? (
          <div className="grid gap-2">
            <label className="text-xs font-medium text-ink-muted" htmlFor="auto-insert-seconds">
              Wait before inserting
            </label>
            <select
              id="auto-insert-seconds"
              value={seconds}
              disabled={busy}
              onChange={(e) =>
                void save(
                  { trigger_auto_insert_seconds: Number(e.target.value) },
                  `Now waiting ${secondsLabel(Number(e.target.value))}`,
                )
              }
              className={cn(
                'h-9 w-48 rounded-[10px] border border-line bg-card px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                busy && 'cursor-not-allowed opacity-60',
              )}
            >
              {SECOND_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {secondsLabel(n)}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-subtle">
              The list stays open while you wait. Press Esc to cancel, or Tab to insert right away.
            </p>
          </div>
        ) : null}

        {errorMsg ? (
          <p className="flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {errorMsg}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
