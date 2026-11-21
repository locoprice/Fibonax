import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, Bot, Check, Copy, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { aiAppsApi, type AiAppLink } from '@/lib/api/aiAppsApi';
import { AI_APP_NAME_MAX, AI_APP_SUGGESTIONS, aiAppAbilities, aiAppName } from '@/lib/aiAppLink';
import { useUiStore } from '@/stores/uiStore';

const GUIDE_URL = 'https://docs.fibonax.com/integrations/ai-apps';
const COPIED_MS = 2000;
const OTHER = 'other';

function usedLine(link: AiAppLink): string {
  return link.lastUsedAt
    ? `Last used ${formatDistanceToNow(new Date(link.lastUsedAt), { addSuffix: true })}`
    : 'Not used yet';
}

/**
 * Settings > Integrations > AI apps: make a private link for Claude, ChatGPT
 * or another AI app, see which links work, and switch one off.
 */
export function AiAppsPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [links, setLinks] = useState<AiAppLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [toSwitchOff, setToSwitchOff] = useState<AiAppLink | null>(null);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setLinks(await aiAppsApi.listLinks());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Your AI app links could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onConfirmSwitchOff() {
    if (!toSwitchOff) return;
    setSwitching(true);
    try {
      await aiAppsApi.switchOff(toSwitchOff.id);
      setLinks((prev) => prev.filter((l) => l.id !== toSwitchOff.id));
      showToast(`${toSwitchOff.name} is switched off`);
      setToSwitchOff(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The link could not be switched off. Try again.', 'error');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>AI apps</CardTitle>
          <CardDescription>
            Let an AI app such as Claude or ChatGPT find and use your prompts and Brains while it
            works for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-3 py-2 text-sm text-ink-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading your AI apps…
            </div>
          ) : loadError ? (
            <div className="flex items-center justify-between gap-3 rounded-[10px] border border-danger/30 bg-danger/5 p-3">
              <div className="flex items-center gap-2 text-xs text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {loadError}
              </div>
              <Button variant="ghost" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : links.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-line px-6 py-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-alt text-ink-muted">
                <Bot className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">No AI app connected yet</p>
                <p className="mt-1 max-w-sm text-sm text-ink-muted">
                  Make a private link, paste it into your AI app, and it can work with your prompts
                  and Brains.
                </p>
              </div>
              <Button onClick={() => setConnectOpen(true)}>Connect an AI app</Button>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {links.map((link) => (
                <div key={link.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-bg-alt text-ink-muted">
                    <Bot className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span translate="no" className="block truncate text-sm font-medium text-ink">
                      {link.name}
                    </span>
                    <p className="text-xs text-ink-muted">
                      {aiAppAbilities(link.scopes)} · {usedLine(link)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    disabled={switching}
                    onClick={() => setToSwitchOff(link)}
                  >
                    Switch off
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        {!loading && !loadError && links.length > 0 ? (
          <CardFooter className="justify-between gap-4">
            <p className="text-xs text-ink-muted">
              Each link works like a password. Switch off any you no longer use.
            </p>
            <Button className="shrink-0" onClick={() => setConnectOpen(true)}>
              Connect an AI app
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <ConnectAiAppDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onCreated={(link) => setLinks((prev) => [link, ...prev])}
      />

      <Dialog
        open={toSwitchOff !== null}
        onOpenChange={(open) => {
          if (!open && !switching) setToSwitchOff(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Switch off <span translate="no">{toSwitchOff?.name}</span>?
            </DialogTitle>
            <DialogDescription>
              It stops working at once. To connect this app again, make a new link.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={switching} onClick={() => setToSwitchOff(null)}>
              Cancel
            </Button>
            <Button
              className="bg-danger text-white hover:bg-danger/90"
              disabled={switching}
              onClick={() => void onConfirmSwitchOff()}
            >
              {switching ? 'Switching off…' : 'Switch off'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ConnectAiAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (link: AiAppLink) => void;
}

/** Two steps: choose the app (and whether it may save), then copy the link, shown once. */
function ConnectAiAppDialog({ open, onOpenChange, onCreated }: ConnectAiAppDialogProps) {
  const formId = useId();
  const saveLabelId = useId();
  const [choice, setChoice] = useState<string>(AI_APP_SUGGESTIONS[0]);
  const [otherName, setOtherName] = useState('');
  const [canSave, setCanSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const copiedTimer = useRef<number | null>(null);

  // Every open starts fresh: a link is shown once, never again.
  useEffect(() => {
    if (!open) return;
    setChoice(AI_APP_SUGGESTIONS[0]);
    setOtherName('');
    setCanSave(false);
    setBusy(false);
    setError(null);
    setMade(null);
    setCopied('no');
  }, [open]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const name = aiAppName(choice === OTHER ? otherName : choice);
    if (!name) {
      setError('Give the app a name, so you can tell your links apart.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await aiAppsApi.createLink(name, canSave);
      onCreated(created.link);
      setMade({ name, url: created.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The link could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied('no'), COPIED_MS);
  }

  const options: { value: string; label: string }[] = [
    ...AI_APP_SUGGESTIONS.map((name) => ({ value: name, label: name })),
    { value: OTHER, label: 'Another app' },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        {made ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Your link for <span translate="no">{made.name}</span>
              </DialogTitle>
              <DialogDescription>Paste it into the app to connect it.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={made.url}
                  aria-label="Your private link"
                  translate="no"
                  className="font-mono text-[13px]"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" className="shrink-0" onClick={() => void onCopy()}>
                  {copied === 'yes' ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {copied === 'yes' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {copied === 'failed' ? (
                <p className="text-xs text-danger">
                  Your browser did not allow copying. Click the link, then press Ctrl+C (or Cmd+C on a Mac).
                </p>
              ) : null}
              <div className="flex gap-3 rounded-[12px] border border-warning-deep/30 bg-warning/10 p-3 text-sm text-ink">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-deep" aria-hidden />
                <p>
                  <strong className="font-semibold">Keep this link private, like a password.</strong>{' '}
                  Anyone who has it can read your prompts and Brains. It is shown only now: if you lose
                  it, make a new one.
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-ink">How to add it</p>
                <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm text-ink-muted">
                  <li>Copy the link.</li>
                  <li>
                    In <span translate="no">{made.name}</span>, open its settings and find Connectors.
                    Some apps call them Integrations or Apps.
                  </li>
                  <li>Add a custom connector and paste the link. No sign-in is needed.</li>
                </ol>
                <a
                  href={GUIDE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                >
                  Step-by-step guide
                </a>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Connect an AI app</DialogTitle>
              <DialogDescription>
                Make a private link for one AI app. It can then find and read your prompts and Brains.
              </DialogDescription>
            </DialogHeader>
            <form id={formId} className="grid gap-4" onSubmit={(event) => void onCreate(event)}>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium text-ink">Which app?</legend>
                <div className="flex flex-wrap gap-2">
                  {options.map((option) => (
                    <label key={option.value} className="cursor-pointer">
                      <input
                        type="radio"
                        name={`${formId}-app`}
                        value={option.value}
                        checked={choice === option.value}
                        onChange={() => {
                          setChoice(option.value);
                          setError(null);
                        }}
                        className="peer sr-only"
                      />
                      <span
                        translate={option.value === OTHER ? undefined : 'no'}
                        className="inline-flex h-8 items-center rounded-full border border-line px-3 text-sm font-medium text-ink transition-colors hover:bg-bg-alt peer-checked:border-primary/40 peer-checked:bg-primary-light peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40"
                      >
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
                {choice === OTHER ? (
                  <Input
                    autoFocus
                    aria-label="App name"
                    placeholder="For example: Cursor"
                    maxLength={AI_APP_NAME_MAX}
                    value={otherName}
                    translate="no"
                    onChange={(event) => {
                      setOtherName(event.target.value);
                      setError(null);
                    }}
                  />
                ) : null}
              </fieldset>
              <div className="flex items-start justify-between gap-4 rounded-[12px] border border-line p-4">
                <div>
                  <p id={saveLabelId} className="text-sm font-medium text-ink">
                    Let it save to your Brains
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    It only adds new items, marked AI generated for you to check. It never changes or
                    deletes anything.
                  </p>
                </div>
                <Switch checked={canSave} onChange={setCanSave} aria-labelledby={saveLabelId} />
              </div>
              {error ? (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Making the link…' : 'Create link'}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
