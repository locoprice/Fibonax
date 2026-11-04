import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { recapApi } from '@/lib/api/recapApi';
import { useUiStore } from '@/stores/uiStore';

/**
 * "Monthly recap email" card: the one switch for the email that arrives on
 * the 1st of each month, and a button that sends last month's recap now.
 *
 * The switch is part of the account (it is read by the server when the emails
 * go out), so it lives in the database, not on this device. The email's own
 * "Stop the monthly recap" link turns the same switch off.
 */
export function MonthlyRecapPanel() {
  const showToast = useUiStore((s) => s.showToast);

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    recapApi
      .getEnabled()
      .then((on) => { if (alive) setEnabled(on); })
      .catch((err: unknown) => {
        if (alive) setErrorMsg(err instanceof Error ? err.message : 'Could not read the setting.');
      });
    return () => { alive = false; };
  }, []);

  async function onToggle(next: boolean) {
    if (saving || enabled === null) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const on = await recapApi.setEnabled(next);
      setEnabled(on);
      showToast(on ? 'Monthly recap on' : 'Monthly recap off');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onSend() {
    if (sending) return;
    setSending(true);
    setErrorMsg(null);
    try {
      const { to } = await recapApi.sendToMe();
      showToast(to ? `Sent to ${to}` : 'Sent. Check your inbox.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'The recap could not be sent.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly recap email</CardTitle>
        <CardDescription>
          On the 1st of each month, one email with your figures for the month just ended: inserts,
          time saved, active days, your busiest day and the few snippets that did most of the work.
          Only for months you used Fibonax.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="monthly-recap" className="text-xs font-medium text-ink-muted">
            Email me a recap on the 1st of each month
          </label>
          <Switch
            id="monthly-recap"
            checked={enabled === true}
            onChange={onToggle}
            disabled={saving || enabled === null}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-subtle">See what it looks like with your own figures.</span>
          <Button type="button" variant="ghost" size="sm" onClick={onSend} disabled={sending}>
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Email me last month&apos;s recap
          </Button>
        </div>
        {errorMsg ? (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {errorMsg}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
