import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Check, Clock, Copy, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  REFERRAL_MAX_FRIENDS,
  REFERRAL_TEXT,
  claimMessage,
  friendLine,
  invitedLine,
  readReferralCode,
  referralLink,
  type ReferralFriend,
  type ReferralSummary,
} from '@/lib/referral';
import { referralApi } from '@/lib/api/referralApi';
import { BrandMark } from '@/components/layout/BrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// The Fibonacci spiral behind the gift card: quarter arcs through squares of
// 21, 13, 8, 5, 3, 2 and 1, in a 34 by 21 box (docs/DESIGN_SYSTEM.md,
// "Proportion").
const SPIRAL =
  'M0 21A21 21 0 0 1 21 0A13 13 0 0 1 34 13A8 8 0 0 1 26 21A5 5 0 0 1 21 16A3 3 0 0 1 24 13A2 2 0 0 1 26 15A1 1 0 0 1 25 16';

const COPIED_MS = 2000;

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; summary: ReferralSummary };

interface ReferFriendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose gift the card says it is: the person's first name. */
  giverName: string;
  /** The sidebar row, which gets the focus back when the window closes. */
  opener: RefObject<HTMLButtonElement>;
}

function FriendRow({ friend }: { friend: ReferralFriend }) {
  const Icon = friend.state === 'rewarded' ? Check : friend.state === 'waiting' ? Clock : X;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          friend.state === 'rewarded' ? 'bg-primary-light text-primary' : 'bg-bg-alt text-ink-muted',
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink" translate="no">
          {friend.label}
        </span>
        <span className="block text-xs text-ink-muted">{friendLine(friend)}</span>
      </span>
    </li>
  );
}

/**
 * "Refer a friend": the gift card, how it works, the person's private link
 * with Copy, and the friends who joined through it. A new account that was
 * invited but lost the link on the way can type it here.
 */
export function ReferFriendDialog({ open, onOpenChange, giverName, opener }: ReferFriendDialogProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeText, setCodeText] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeNote, setCodeNote] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const linkId = useId();
  const codeId = useId();

  const refresh = useCallback(async () => {
    try {
      setLoad({ state: 'ready', summary: await referralApi.getSummary() });
    } catch (err) {
      setLoad({
        state: 'error',
        message: err instanceof Error ? err.message : REFERRAL_TEXT.loadFailed,
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoad({ state: 'loading' });
    setCopied('no');
    setCodeOpen(false);
    setCodeText('');
    setCodeNote(null);
    void refresh();
  }, [open, refresh]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const summary = load.state === 'ready' ? load.summary : null;
  const link = summary ? referralLink(summary.code) : '';

  async function onCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied('no'), COPIED_MS);
  }

  async function onAddCode(event: FormEvent) {
    event.preventDefault();
    if (codeBusy) return;
    const code = readReferralCode(codeText);
    if (!code) {
      setCodeNote(claimMessage('unknown'));
      return;
    }
    setCodeBusy(true);
    setCodeNote(null);
    const status = await referralApi.claim(code);
    setCodeBusy(false);
    if (status === 'ok') {
      // The window now shows the person's own place instead of the box.
      setCodeOpen(false);
      setCodeText('');
      await refresh();
      return;
    }
    setCodeNote(claimMessage(status));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-[640px] gap-5 overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{REFERRAL_TEXT.title}</DialogTitle>
          <DialogDescription>{REFERRAL_TEXT.lead}</DialogDescription>
        </DialogHeader>

        {/* A golden rectangle beside a square: the card, then the three steps. */}
        <div className="grid grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)] gap-5">
          <div className="relative flex aspect-[1.618/1] flex-col items-center justify-center gap-3 overflow-hidden rounded-[16px] bg-gradient-to-br from-primary to-primary-dark px-5 text-white shadow-md">
            <svg
              viewBox="0 0 34 21"
              preserveAspectRatio="none"
              aria-hidden
              className="absolute inset-0 h-full w-full text-white opacity-[0.16]"
            >
              <path
                d={SPIRAL}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <p className="relative flex items-center gap-2.5" translate="no">
              <BrandMark className="h-8 w-8 text-white" />
              <span className="text-[26px] font-bold leading-none tracking-tight">Fibonax</span>
              <span className="rounded-[8px] bg-white px-2 py-1 text-sm font-bold leading-none text-primary">
                Pro
              </span>
            </p>
            <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em]">
              {REFERRAL_TEXT.cardLine}
            </p>
            <p className="relative max-w-full truncate rounded-full bg-white/[0.16] px-3 py-1 text-xs font-semibold">
              Gifted by<span translate="no"> {giverName}</span>
            </p>
          </div>

          <div className="flex flex-col justify-center">
            <h3 className="text-sm font-semibold text-ink">{REFERRAL_TEXT.stepsTitle}</h3>
            <ol className="mt-2.5 grid gap-2.5">
              {REFERRAL_TEXT.steps.map((step, index) => (
                <li key={step} className="flex gap-2.5 text-[13px] leading-snug text-ink-muted">
                  <span
                    aria-hidden
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-light text-[11px] font-bold text-primary"
                  >
                    {index + 1}
                  </span>
                  <span>
                    <span className="sr-only">Step {index + 1}: </span>
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {load.state === 'loading' && (
          <div role="status" className="flex items-center gap-3 py-6 text-sm text-ink-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading your invite link…
          </div>
        )}

        {load.state === 'error' && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-danger-bg px-4 py-3 text-sm text-danger"
          >
            {load.message}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setLoad({ state: 'loading' });
                void refresh();
              }}
            >
              {REFERRAL_TEXT.retry}
            </Button>
          </div>
        )}

        {summary && (
          <>
            <div className="grid gap-1.5">
              <label htmlFor={linkId} className="text-sm font-semibold text-ink">
                {REFERRAL_TEXT.linkLabel}
              </label>
              <div className="flex gap-2">
                <Input
                  id={linkId}
                  readOnly
                  translate="no"
                  value={link}
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 flex-1 font-mono text-[13px]"
                />
                <Button type="button" onClick={() => void onCopy()} className="shrink-0">
                  {copied === 'yes' ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden />
                  )}
                  {copied === 'yes' ? REFERRAL_TEXT.copied : REFERRAL_TEXT.copy}
                </Button>
              </div>
              <p role="status" className="min-h-[1rem] text-xs text-ink-muted">
                {copied === 'failed'
                  ? REFERRAL_TEXT.copyFailed
                  : summary.placesUsed >= REFERRAL_MAX_FRIENDS
                    ? REFERRAL_TEXT.placesFull
                    : ''}
              </p>
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink">Friends who joined</h3>
                <span className="text-xs tabular-nums text-ink-muted">
                  {summary.placesUsed} of {REFERRAL_MAX_FRIENDS} places taken
                </span>
              </div>
              {summary.friends.length === 0 ? (
                <p className="rounded-[12px] bg-bg-alt px-4 py-3 text-sm text-ink-muted">
                  {REFERRAL_TEXT.friendsEmpty}
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-[12px] border border-line">
                  {summary.friends.map((friend) => (
                    <FriendRow key={`${friend.label}-${friend.deadline}`} friend={friend} />
                  ))}
                </ul>
              )}
            </div>

            {summary.invited && (
              <p className="rounded-[12px] bg-primary-light px-4 py-3 text-sm text-ink">
                {invitedLine(summary.invited)}
              </p>
            )}

            {summary.canEnterCode && (
              <div className="grid gap-2">
                <button
                  type="button"
                  aria-expanded={codeOpen}
                  onClick={() => setCodeOpen((value) => !value)}
                  className="justify-self-start rounded-[6px] text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {REFERRAL_TEXT.codeToggle}
                </button>
                {codeOpen && (
                  <form onSubmit={(event) => void onAddCode(event)} noValidate className="grid gap-1.5">
                    <label htmlFor={codeId} className="text-xs text-ink-muted">
                      {REFERRAL_TEXT.codeLabel}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id={codeId}
                        translate="no"
                        value={codeText}
                        onChange={(event) => setCodeText(event.target.value)}
                        readOnly={codeBusy}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        className="min-w-0 flex-1"
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        className="shrink-0"
                        disabled={codeBusy || codeText.trim() === ''}
                      >
                        {codeBusy ? 'Checking…' : REFERRAL_TEXT.codeApply}
                      </Button>
                    </div>
                    <p role="status" className="min-h-[1rem] text-xs text-danger">
                      {codeNote ?? ''}
                    </p>
                  </form>
                )}
              </div>
            )}
          </>
        )}

        <p className="border-t border-line pt-4 text-xs leading-relaxed text-ink-subtle">
          {REFERRAL_TEXT.footnote}
        </p>
      </DialogContent>
    </Dialog>
  );
}
