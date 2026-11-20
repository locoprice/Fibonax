import { useSettingsStore } from '@/stores/settingsStore';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { MasterSearch } from '@/features/search/MasterSearch';
import { BrandMark } from '@/components/layout/BrandMark';

/**
 * Top bar — design system v1.1.
 * Spans the dashboard width at 60px; brand sits on the left (mirrors the
 * mockup at design_handoff_design_system/mockups/harmonized-final.html),
 * search anchors the middle, and the language choice and the theme toggle
 * stay on the right.
 */
export function Topbar() {
  const profile = useSettingsStore((s) => s.profile);
  const companyName = profile?.company_name ?? '';
  const companyLogo = profile?.company_logo_url ?? null;

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-line bg-card px-6">
      {/* Brand: the Fibonax T and the wordmark, co-branded with the user's
          company mark (Settings, Company branding) when one is set. */}
      <div className="flex shrink-0 items-center gap-2.5">
        <BrandMark className="h-7 w-7" />
        <span className="text-[15px] font-bold tracking-tight text-ink" translate="no">Fibonax</span>
        {(companyLogo || companyName) && (
          <>
            <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-ink-subtle" aria-hidden="true" />
            {companyLogo ? (
              <span
                className="flex items-center rounded-[8px] bg-white px-1.5 py-1"
                title={companyName || undefined}
              >
                <img
                  src={companyLogo}
                  alt={companyName || 'Company logo'}
                  draggable={false}
                  className="max-h-6 max-w-[160px] object-contain"
                />
              </span>
            ) : (
              <span className="max-w-[200px] truncate text-[15px] font-bold tracking-tight text-ink" translate="no">
                {companyName}
              </span>
            )}
          </>
        )}
      </div>

      <MasterSearch />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <LanguagePicker />
        <ThemeToggle />
      </div>
    </header>
  );
}
