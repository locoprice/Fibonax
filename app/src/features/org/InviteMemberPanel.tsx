import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Mail, Send, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { invitationsApi } from '@/lib/api/invitationsApi';
import {
  isCommitKey,
  parseEmailList,
  summarizeInvites,
  type InviteOutcome,
} from '@/lib/emailList';
import { useUiStore } from '@/stores/uiStore';
import type { OrganizationSummary, OrgInvitation, OrgRole } from '@/types/database';

/**
 * Inviting people into a team (INVITE-001), in two halves that the People
 * list on the Team page composes: the **Invite people** button with its
 * window, and the rows of invitations already sent. Both read the same
 * `useInvitations` state, so a sent invitation shows up in the list at once.
 *
 * Admins and managers only, the same bar the `orginv_write` policy and the
 * `invite-member` edge function enforce, so a member never sees a control
 * that would fail. An invitation is not a membership: the person accepts or
 * declines from /invite, and only accepting puts them in the roster.
 */

export const ROLE_LABEL: Record<OrgRole, string> = {
  member: 'Member',
  manager: 'Manager',
  admin: 'Admin',
};

// Describes SHARING power, because that is what this chooser actually decides.
// The manager line used to read "Can invite people and share folders", which
// promised authority the code does not grant: `app.folder_level` returns
// 'owner' to org ADMINS only, so a manager manages sharing on exactly the
// folders they own, same as any member.
const ROLE_HELP: Record<OrgRole, string> = {
  member: 'Uses everything shared with them. Can share folders they own.',
  manager: 'Everything a member can do, plus inviting people.',
  admin: 'Full control, including sharing on every folder in the team.',
};

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-primary-light text-primary',
  declined: 'bg-danger-bg text-danger',
  expired: 'bg-warning-bg text-warning-deep',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  declined: 'Declined',
  expired: 'Expired',
};

/** Whether this role may invite people and manage the invitations sent. */
export function canInvite(role: OrgRole): boolean {
  return role === 'admin' || role === 'manager';
}

export interface InvitationsState {
  invitations: OrgInvitation[];
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * The invitations sent into one team. Pass `null` for someone who may not
 * invite: the list stays empty and nothing is fetched, since the RPC admits
 * admins and managers only.
 */
export function useInvitations(orgId: string | null): InvitationsState {
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [loading, setLoading] = useState(orgId !== null);

  const refresh = useCallback(async () => {
    if (orgId === null) {
      setInvitations([]);
      setLoading(false);
      return;
    }
    try {
      setInvitations(await invitationsApi.listForOrg(orgId));
    } catch {
      // Non-fatal: inviting still works. The list simply stays as it was.
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { invitations, loading, refresh };
}

/* ------------------------------------------------------------------ */

interface InvitePeopleButtonProps {
  org: OrganizationSummary;
  /** Called after at least one invitation went out, so the list can refresh. */
  onSent: () => void | Promise<void>;
}

/** The one action on the People list: opens the invite window. */
export function InvitePeopleButton({ org, onSent }: InvitePeopleButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        Invite people
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite people to {org.name}</DialogTitle>
            <DialogDescription>
              They get an email and choose whether to join. Nothing is shared until they accept.
            </DialogDescription>
          </DialogHeader>
          {/* Mounted only while open, so a closed window forgets its draft. */}
          {open && (
            <InviteForm
              org={org}
              onSent={onSent}
              onDone={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface InviteFormProps {
  org: OrganizationSummary;
  onSent: () => void | Promise<void>;
  /** Everything went out: the window can close. */
  onDone: () => void;
}

function InviteForm({ org, onSent, onDone }: InviteFormProps) {
  const showToast = useUiStore((s) => s.showToast);

  /** Committed addresses, shown as chips. */
  const [emails, setEmails] = useState<string[]>([]);
  /** What is still being typed, not yet committed to a chip. */
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // An admin can hand out any role; a manager cannot mint an admin (the edge
  // function rejects it either way — this keeps the impossible option hidden).
  const roles: OrgRole[] =
    org.myRole === 'admin' ? ['member', 'manager', 'admin'] : ['member', 'manager'];

  /** Send one invitation into THIS org. Never throws; reports its own outcome. */
  async function sendOne(target: string, targetRole: OrgRole): Promise<InviteOutcome> {
    try {
      const result = await invitationsApi.send(target, targetRole, org.id);
      if (!result.emailed) {
        return {
          email: target,
          ok: false,
          reason: `saved, but the email didn’t go out (${result.emailError ?? 'unknown error'}).`,
        };
      }
      return { email: target, ok: true, reason: '' };
    } catch (err) {
      return {
        email: target,
        ok: false,
        reason: err instanceof Error ? err.message : 'could not be sent.',
      };
    }
  }

  /** Move whatever is in the draft into chips. Returns the resulting list. */
  function commitDraft(text: string, current: string[]): string[] {
    const { valid, invalid } = parseEmailList(text);
    setError(
      invalid.length === 0
        ? null
        : invalid.length === 1
          ? `“${invalid[0]}” is not an email address.`
          : `${invalid.length} entries are not email addresses, starting with “${invalid[0]}”.`,
    );
    if (valid.length === 0) return current;
    const merged = [...current];
    for (const address of valid) if (!merged.includes(address)) merged.push(address);
    return merged;
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (isCommitKey(e.key)) {
      // Space and comma are separators here, never characters in an address.
      if (draft.trim() === '') {
        if (e.key !== 'Tab') e.preventDefault();
        return;
      }
      e.preventDefault();
      setEmails((prev) => commitDraft(draft, prev));
      setDraft('');
      return;
    }
    // Backspace on an empty field pulls the last chip back for editing, which
    // is what every chip input does and what a typo correction needs.
    if (e.key === 'Backspace' && draft === '' && emails.length > 0) {
      e.preventDefault();
      setDraft(emails[emails.length - 1] ?? '');
      setEmails((prev) => prev.slice(0, -1));
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!/[\s,;]/.test(text)) return; // a single address: let it type normally
    e.preventDefault();
    setEmails((prev) => commitDraft(draft + ' ' + text, prev));
    setDraft('');
  }

  function removeEmail(target: string) {
    setEmails((prev) => prev.filter((a) => a !== target));
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    // Anything still in the box counts: nobody expects Send to ignore what
    // they just typed because they did not press comma first.
    const targets = commitDraft(draft, emails);
    if (targets.length === 0) return;
    setEmails(targets);
    setDraft('');

    setSending(true);
    const outcomes: InviteOutcome[] = [];
    for (const target of targets) {
      outcomes.push(await sendOne(target, role));
    }
    const failed = outcomes.filter((o) => !o.ok);
    if (failed.length < outcomes.length) await onSent();
    setSending(false);

    showToast(summarizeInvites(outcomes), failed.length > 0 ? 'error' : 'success');
    if (failed.length === 0) {
      onDone();
      return;
    }
    // Keep only what failed, so a retry does not re-invite everyone who worked.
    setEmails(failed.map((o) => o.email));
    setError(summarizeInvites(outcomes));
  }

  const nothingToSend = emails.length === 0 && draft.trim() === '';

  return (
    <form onSubmit={handleSend} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-emails" className="text-xs font-medium text-ink-muted">
          Email addresses
        </label>
        {/* Chip field. Clicking anywhere in it focuses the input, so the
            whole box behaves like one control rather than a box with an
            input hiding at the end of it. */}
        <div
          onClick={() => inputRef.current?.focus()}
          className={cn(
            'flex flex-wrap items-center gap-1.5 rounded-[10px] border border-line bg-card px-2.5 py-2',
            'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
            sending && 'opacity-60',
          )}
        >
          {emails.map((address) => (
            <span
              key={address}
              className="inline-flex items-center gap-1 rounded-full bg-bg-alt py-1 pl-2.5 pr-1 text-xs text-ink-muted"
            >
              {address}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeEmail(address);
                }}
                disabled={sending}
                aria-label={`Remove ${address}`}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id="invite-emails"
            type="text"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            placeholder={emails.length === 0 ? 'teammate@company.com' : 'Add another'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={() => {
              if (draft.trim() === '') return;
              setEmails((prev) => commitDraft(draft, prev));
              setDraft('');
            }}
            disabled={sending}
            className="min-w-[180px] flex-1 border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-ink-subtle"
          />
        </div>
        <p className="text-xs text-ink-subtle">You can paste a whole list.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-muted">Join as</span>
        <Segmented
          options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          value={role}
          onChange={setRole}
          ariaLabel="Join as"
          disabled={sending}
        />
        <p className="text-xs text-ink-subtle">{ROLE_HELP[role]}</p>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={sending || nothingToSend}>
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {emails.length > 1 ? `Send ${emails.length} invites` : 'Send invite'}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */

interface InvitationRowsProps {
  org: OrganizationSummary;
  invitations: OrgInvitation[];
  /** Called after an invitation was sent again or withdrawn. */
  onChanged: () => void | Promise<void>;
}

/**
 * The invitations already sent, as the last group of the People list: open
 * ones first, then anything that came back declined or ran out. Each row says
 * its state in a word and offers Send again, and Withdraw while it is open.
 */
export function InvitationRows({ org, invitations, onChanged }: InvitationRowsProps) {
  const showToast = useUiStore((s) => s.showToast);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (invitations.length === 0) return null;

  async function handleResend(invitation: OrgInvitation) {
    setBusyId(invitation.id);
    try {
      const result = await invitationsApi.send(invitation.email, invitation.role, org.id);
      showToast(
        result.emailed
          ? `Invitation sent again to ${invitation.email}.`
          : `${invitation.email}: saved, but the email didn’t go out (${result.emailError ?? 'unknown error'}).`,
        result.emailed ? 'success' : 'error',
      );
    } catch (err) {
      showToast(
        `${invitation.email}: ${err instanceof Error ? err.message : 'could not be sent.'}`,
        'error',
      );
    }
    await onChanged();
    setBusyId(null);
  }

  async function handleRevoke(invitation: OrgInvitation) {
    setBusyId(invitation.id);
    try {
      await invitationsApi.revoke(invitation.id);
      showToast(`Invitation to ${invitation.email} withdrawn.`);
      await onChanged();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not withdraw the invitation.',
        'error',
      );
    }
    setBusyId(null);
  }

  return (
    <div className="border-t border-line">
      <p className="px-5 pb-1 pt-3 text-xs font-medium text-ink-subtle">Invited</p>
      <ul className="divide-y divide-line">
        {invitations.map((invitation) => {
          const busy = busyId === invitation.id;
          // An admin invitation is an admin's to resend or withdraw: the
          // database refuses a manager (orginv_write), so the buttons are not
          // offered to one.
          const canChange = org.myRole === 'admin' || invitation.role !== 'admin';
          return (
            <li key={invitation.id} className="flex items-center gap-3 px-5 py-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-alt text-ink-subtle"
                aria-hidden="true"
              >
                <Mail className="h-4 w-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-ink">{invitation.email}</span>
                <span className="truncate text-xs text-ink-subtle">
                  {ROLE_LABEL[invitation.role]} ·{' '}
                  {invitation.invited_by_name ? `invited by ${invitation.invited_by_name} · ` : ''}
                  {formatDistanceToNow(new Date(invitation.created_at), { addSuffix: true })}
                </span>
              </span>

              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  STATUS_STYLE[invitation.status] ?? 'bg-bg-alt text-ink-subtle',
                )}
              >
                {STATUS_LABEL[invitation.status] ?? invitation.status}
              </span>

              {canChange && (
                <span className="flex shrink-0 items-center gap-1">
                  <RowButton
                    onClick={() => void handleResend(invitation)}
                    disabled={busy}
                    label={`Send again to ${invitation.email}`}
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                    Send again
                  </RowButton>
                  {invitation.status === 'pending' && (
                    <RowButton
                      onClick={() => void handleRevoke(invitation)}
                      disabled={busy}
                      label={`Withdraw the invitation to ${invitation.email}`}
                      danger
                    >
                      Withdraw
                    </RowButton>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RowButton({
  children,
  onClick,
  disabled,
  label,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Accessible name: the visible words plus who the row is about. */
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs font-medium text-ink-muted transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50',
        danger ? 'hover:bg-danger/10 hover:text-danger' : 'hover:bg-bg-alt hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}
