import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertCircle, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { BrandMark } from '@/components/layout/BrandMark';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { aiAppsApi, type ConnectingApp } from '@/lib/api/aiAppsApi';
import { connectReturnPlace, connectReturnUrl, readConnectRequest } from '@/lib/aiAppLink';
import { useAuthStore } from '@/stores/authStore';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; app: ConnectingApp }
  | { state: 'invalid' }
  | { state: 'failed'; message: string };

/**
 * "Sign in with Fibonax": where a person allows an AI app (Claude, ChatGPT and
 * others) to use their prompts and Brains. The AI app sends them here through
 * the server function's /authorize; saying yes sends them back with a one-time
 * code the app trades for its key (20261125130000_ai_app_sign_in.sql).
 *
 * Standalone and served at any width: people connect an app from their phone
 * as often as from a computer.
 */
export function ConnectAppPage() {
  const location = useLocation();
  const email = useAuthStore((s) => s.user?.email ?? null);
  // Drawn inside another site's frame, the page answers nothing: a click on
  // Allow could be tricked out of someone there (netlify.toml forbids it too).
  const framed = typeof window !== 'undefined' && window.top !== window.self;
  const request = useMemo(() => (framed ? null : readConnectRequest(location.search)), [framed, location.search]);
  const saveLabelId = useId();
  const [load, setLoad] = useState<Load>(request ? { state: 'loading' } : { state: 'invalid' });
  const [attempt, setAttempt] = useState(0);
  const [canSave, setCanSave] = useState(false);
  const [busy, setBusy] = useState<'allow' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    let live = true;
    setLoad({ state: 'loading' });
    aiAppsApi
      .getConnectingApp(request)
      .then((app) => {
        if (live) setLoad(app ? { state: 'ready', app } : { state: 'invalid' });
      })
      .catch((err: unknown) => {
        if (live) setLoad({ state: 'failed', message: err instanceof Error ? err.message : 'This could not load.' });
      });
    return () => {
      live = false;
    };
  }, [request, attempt]);

  async function onAllow() {
    if (!request || busy) return;
    setBusy('allow');
    setError(null);
    try {
      const code = await aiAppsApi.approveConnection(request, canSave);
      window.location.assign(connectReturnUrl(request.redirectUri, { code, state: request.state }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The connection could not be made. Try again.');
      setBusy(null);
    }
  }

  function onCancel() {
    if (!request || busy) return;
    setBusy('cancel');
    window.location.assign(
      connectReturnUrl(request.redirectUri, {
        error: 'access_denied',
        error_description: 'The person chose not to connect',
        state: request.state,
      }),
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md rounded-[16px] border border-line bg-card p-6 shadow-md">
        <div className="mb-5 flex items-center justify-center gap-2 text-ink">
          <BrandMark className="h-6 w-6" />
          <span translate="no" className="text-base font-semibold tracking-tight">
            Fibonax
          </span>
        </div>

        {load.state === 'loading' ? (
          <div className="py-6 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" aria-hidden />
            <p className="mt-4 text-sm text-ink-muted">Checking the request…</p>
          </div>
        ) : load.state === 'invalid' ? (
          <div className="text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-ink-subtle" aria-hidden />
            <h1 className="text-lg font-semibold text-ink">This request is not valid</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Go back to your AI app and connect Fibonax again. Nothing was shared.
            </p>
            <Button asChild variant="ghost" className="mt-5">
              <Link to="/">Go to your dashboard</Link>
            </Button>
          </div>
        ) : load.state === 'failed' ? (
          <div className="text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-danger" aria-hidden />
            <h1 className="text-lg font-semibold text-ink">This could not load</h1>
            <p className="mt-2 text-sm text-ink-muted">{load.message} Check your connection and try again.</p>
            <Button className="mt-5" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <h1 className="text-center text-lg font-semibold text-ink">
              Connect <span translate="no">{load.app.name}</span> to Fibonax?
            </h1>
            <p className="mt-2 text-center text-sm text-ink-muted">
              It will be able to use your prompts and Brains while it works for you.
            </p>

            <ul className="mt-5 grid gap-2 text-sm text-ink">
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="sr-only">It can: </span>Find and read your prompts and Brains, and the prompts
                  your team shares with you.
                </span>
              </li>
              <li className="flex gap-2">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
                <span>
                  <span className="sr-only">It cannot: </span>It never sees your snippets, and it cannot change or
                  delete anything.
                </span>
              </li>
            </ul>

            <div className="mt-4 flex items-start justify-between gap-4 rounded-[12px] border border-line p-4">
              <div>
                <p id={saveLabelId} className="text-sm font-medium text-ink">
                  Let it save to your Brains
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  It only adds new items, marked AI generated for you to check.
                </p>
              </div>
              <Switch checked={canSave} onChange={setCanSave} aria-labelledby={saveLabelId} disabled={busy !== null} />
            </div>

            {error ? (
              <p role="alert" className="mt-4 flex items-start gap-1.5 text-xs text-danger">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-2">
              <Button size="lg" className="w-full" disabled={busy !== null} onClick={() => void onAllow()}>
                {busy === 'allow' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {busy === 'allow' ? 'Connecting…' : 'Allow'}
              </Button>
              <Button size="lg" variant="ghost" className="w-full" disabled={busy !== null} onClick={onCancel}>
                Cancel
              </Button>
            </div>

            <div className="mt-5 flex gap-2 border-t border-line pt-4 text-xs text-ink-muted">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <p>
                You are signed in as{' '}
                <span translate="no" className="font-medium text-ink">
                  {email ?? 'this account'}
                </span>
                . After you answer, you go back to{' '}
                <span translate="no" className="font-medium text-ink">
                  {request ? connectReturnPlace(request.redirectUri) : 'your AI app'}
                </span>
                . You can switch this off any time in Settings, Integrations, AI apps.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
