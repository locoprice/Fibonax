import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { loadUsageAnalytics, type TeamLastUse, type UsageAnalyticsApi } from '@/lib/usageAnalytics';
import { useTeamLastUseStore } from '@/stores/teamLastUseStore';

// Inline hex OK per CLAUDE.md: the dark tone mirrors the PromptBlockEditor
// drawer palette, as AssetAboutButton does.
const TONE = {
  light: 'text-ink-subtle',
  dark: 'text-[#8A8A95]',
} as const;

interface TeamLastUseLineProps {
  kind: 'snippet' | 'prompt';
  /** The item, plus any language versions kept as rows of their own: the latest use of any of them counts. */
  ids: readonly string[];
  /** Matches the host chrome. */
  tone?: 'light' | 'dark';
  className?: string;
}

/**
 * "Last used by Anna on 30/10/2026 at 14:05", or "Never used", under a snippet
 * or prompt that sits in a team folder. Callers render it only for team items.
 * The wording comes from extension/shared/usage-analytics.js (lastUseLine), the
 * same words the popup and the phone print. Hidden while loading and when the
 * read failed, so it never shows a guess.
 */
export function TeamLastUseLine({ kind, ids, tone = 'light', className }: TeamLastUseLineProps) {
  const uses = useTeamLastUseStore((s) => (kind === 'snippet' ? s.snippets : s.prompts));
  let lastUse: TeamLastUse | undefined;
  for (const id of ids) {
    const use = uses.get(id);
    if (use && (!lastUse || Date.parse(use.used_at) > Date.parse(lastUse.used_at))) lastUse = use;
  }
  const loaded = useTeamLastUseStore((s) => s.loaded);
  const failed = useTeamLastUseStore((s) => s.error !== null);
  const [api, setApi] = useState<UsageAnalyticsApi | null>(window.SBUsageAnalytics ?? null);

  useEffect(() => {
    if (api) return;
    let live = true;
    loadUsageAnalytics()
      .then((loadedApi) => {
        if (live) setApi(loadedApi);
      })
      .catch((err: unknown) => {
        console.error('Last used line: the shared wording could not load', err);
      });
    return () => {
      live = false;
    };
  }, [api]);

  if (!api || !loaded || failed) return null;
  const line = api.lastUseLine(lastUse);
  return (
    <p className={cn('flex min-w-0 items-start gap-1.5 text-xs leading-snug', TONE[tone], className)} title={line}>
      <History className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
      {/* Two lines at most: a long email as the name must not push the date out of sight. */}
      <span className="line-clamp-2 break-words">{line}</span>
    </p>
  );
}

/**
 * Loads who last used the team's items when a page that shows the line opens,
 * and again whenever the tab comes back into view, so a teammate's use shows
 * without a reload.
 */
export function useTeamLastUseRefresh(enabled: boolean): void {
  const refresh = useTeamLastUseStore((s) => s.refresh);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, refresh]);
}
