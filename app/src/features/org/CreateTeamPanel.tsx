import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AutofillHint } from '@/components/shared/AutofillHint';
import { COMPANY_NAME_MAX } from '@/lib/branding';
import { useAuthStore } from '@/stores/authStore';
import { useOrgStore } from '@/stores/orgStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

interface CreateTeamPanelProps {
  /**
   * Rendered inside the share modal rather than on /team. Drops the framing
   * copy and tightens the spacing, so the modal stays one decision tall.
   */
  compact?: boolean;
  /**
   * One line of framing above the field, in compact mode. Each host explains
   * why it is asking, since the reason differs (sharing a folder vs adding a
   * second team). Omit for no framing.
   */
  blurb?: string;
  /** Called once the team exists, so a host modal can continue its own flow. */
  onCreated?: () => void | Promise<void>;
}

/** Read the brand name the user already set in Settings, if they set one. */
function prefillName(metadata: Record<string, unknown> | undefined): string {
  const value = metadata?.['company_name'];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Create a team (TEAM-CREATE-001). The entry point that did not exist: until
 * this shipped, every organization was inserted by hand in a migration and a
 * user with no team met a guide telling them to share a folder, followed by a
 * modal refusing to share it.
 *
 * The work happens in the `create_team` RPC, not here — `org_insert` and
 * `orgmem_write` deadlock a client-side create, so the caller could make an
 * organization they could not then join. See the migration for the detail.
 */
export function CreateTeamPanel({ compact = false, blurb, onCreated }: CreateTeamPanelProps) {
  const user = useAuthStore((s) => s.user);
  const createTeam = useOrgStore((s) => s.createTeam);
  const showToast = useUiStore((s) => s.showToast);

  const editProfile = useSettingsStore((s) => s.editProfile);
  const savedCompany = prefillName(user?.user_metadata);

  // The company name is required here: the team's snippets sign and send
  // their wishes with it ({my: company}), and every member uses the one of
  // whoever created the team. It is the Company branding of Settings, not a
  // field of its own. The team name follows it until it is typed in.
  const [company, setCompany] = useState(savedCompany);
  const [name, setName] = useState(savedCompany);
  const [nameTouched, setNameTouched] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const companyTrimmed = company.trim();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (trimmed === '' || companyTrimmed === '' || working) return;

    setWorking(true);
    setError(null);
    try {
      if (companyTrimmed !== savedCompany) await editProfile({ company_name: companyTrimmed });
      await createTeam(trimmed);
      showToast(`Team created. You're the admin.`);
      await onCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the team. Try again.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className={
        compact
          ? 'flex flex-col gap-3 rounded-[12px] border border-line bg-bg-alt/50 p-3'
          : 'rounded-[16px] border border-line bg-card p-6'
      }
    >
      {!compact && (
        <header className="mb-5 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
            <Users className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Team
            </p>
            <h2 className="text-base font-semibold text-ink">Create your team</h2>
            <p className="mt-1 text-sm text-ink-muted">
              A team is where shared folders live. You can invite people right after.
            </p>
          </div>
        </header>
      )}

      {compact && blurb !== undefined && <p className="text-xs text-ink-muted">{blurb}</p>}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5">
          <label
            htmlFor="create-team-company"
            className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle"
          >
            Company name
          </label>
          <AutofillHint detail="company" />
        </span>
        <Input
          id="create-team-company"
          type="text"
          autoFocus
          required
          maxLength={COMPANY_NAME_MAX}
          autoComplete="organization"
          placeholder="Acme Ltd"
          value={company}
          translate="no"
          onChange={(e) => {
            setCompany(e.target.value);
            if (!nameTouched) setName(e.target.value);
          }}
          disabled={working}
        />
        <p className="text-[11px] text-ink-subtle">
          Your team&apos;s snippets sign and send their wishes with it. Saved in Settings &gt; Company branding.
        </p>
        <label
          htmlFor="create-team-name"
          className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle"
        >
          Team name
        </label>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <Input
              id="create-team-name"
              type="text"
              maxLength={60}
              placeholder="Acme Ltd"
              value={name}
              translate="no"
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              disabled={working}
            />
          </div>
          <Button type="submit" disabled={working || trimmed === '' || companyTrimmed === ''}>
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create team
          </Button>
        </div>
        <p className="text-[11px] text-ink-subtle">You can rename it later.</p>

        {error && <p className="text-xs text-danger">{error}</p>}
      </form>

      {!compact && (
        <>
          <div className="my-5 h-px bg-line" />
          <p className="text-xs text-ink-muted">
            Were you invited to a team?{' '}
            <Link to="/invite" className="font-semibold text-primary hover:underline">
              Check your invitations
            </Link>
            .
          </p>
        </>
      )}
    </section>
  );
}
