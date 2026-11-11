import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadErrorCard } from '@/components/shared/LoadErrorCard';
import { Segmented } from '@/components/ui/segmented';
import { AccountPanel } from '@/features/settings/AccountPanel';
import { AutoInsertPanel } from '@/features/settings/AutoInsertPanel';
import { BrandingPanel } from '@/features/settings/BrandingPanel';
import { DeleteAccountPanel } from '@/features/settings/DeleteAccountPanel';
import { FiboTokenRatePanel } from '@/features/settings/FiboTokenRatePanel';
import { InactivityPanel } from '@/features/settings/InactivityPanel';
import { InlineTriggerPanel } from '@/features/settings/InlineTriggerPanel';
import { IntegrationsPanel } from '@/features/settings/IntegrationsPanel';
import { MonthlyRecapPanel } from '@/features/settings/MonthlyRecapPanel';
import { PasswordPanel } from '@/features/settings/PasswordPanel';
import { SaintOfDayPanel } from '@/features/settings/SaintOfDayPanel';
import { SecurityPanel } from '@/features/settings/SecurityPanel';
import { useSettingsStore } from '@/stores/settingsStore';

const SECTION_OPTIONS = [
  { value: 'account', label: 'Account' },
  { value: 'security', label: 'Security' },
  { value: 'integrations', label: 'Integrations' },
] as const;

type SectionKey = (typeof SECTION_OPTIONS)[number]['value'];

const SECTION_DESCRIPTIONS: Record<SectionKey, string> = {
  account: 'Your profile, your company brand, how snippets are inserted and the FiboToken rate.',
  security: 'Your password, the devices signed in and your recent sign-ins.',
  integrations: 'The other places where you use Fibonax.',
};

/** Two columns on the golden ratio on wide screens, one column below. */
const GOLDEN_COLUMNS = 'grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)]';

export function SettingsPage() {
  const profile = useSettingsStore((s) => s.profile);
  const error = useSettingsStore((s) => s.error);
  const load = useSettingsStore((s) => s.load);
  // ?tab=security opens straight on that section (the password reset link lands there).
  const [params] = useSearchParams();
  const requested = params.get('tab');
  const [section, setSection] = useState<SectionKey>(
    () => SECTION_OPTIONS.find((o) => o.value === requested)?.value ?? 'account',
  );

  useEffect(() => {
    if (!profile) {
      void load();
    }
  }, [load, profile]);

  return (
    <>
      <PageHeader
        title="Settings"
        description={SECTION_DESCRIPTIONS[section]}
        action={
          <Segmented
            ariaLabel="Settings section"
            className="shrink-0 [&>button]:whitespace-nowrap"
            options={SECTION_OPTIONS}
            value={section}
            onChange={setSection}
          />
        }
      />

      {section === 'account' ? (
        profile ? (
          <>
            <div className={GOLDEN_COLUMNS}>
              <div className="grid gap-5">
                <AccountPanel />
                <BrandingPanel />
                <MonthlyRecapPanel />
                <SaintOfDayPanel />
              </div>
              <div className="grid gap-5">
                <InlineTriggerPanel />
                <AutoInsertPanel />
                <InactivityPanel />
                <FiboTokenRatePanel />
              </div>
            </div>
            <div className="mt-6">
              <DeleteAccountPanel />
            </div>
          </>
        ) : error ? (
          <LoadErrorCard
            title="Your settings could not load."
            message={`${error} Check your connection and try again.`}
            onRetry={() => void load()}
          />
        ) : (
          <div className={GOLDEN_COLUMNS}>
            <div className="h-[520px] animate-pulse rounded-[16px] bg-card" />
            <div className="h-[520px] animate-pulse rounded-[16px] bg-card" />
          </div>
        )
      ) : null}

      {section === 'security' ? (
        <>
          <PasswordPanel />
          <div className={`mt-6 ${GOLDEN_COLUMNS}`}>
            <SecurityPanel />
          </div>
        </>
      ) : null}

      {section === 'integrations' ? <IntegrationsPanel /> : null}
    </>
  );
}
