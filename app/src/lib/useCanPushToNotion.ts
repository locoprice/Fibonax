import { useEffect } from 'react';
import { useOrgStore } from '@/stores/orgStore';
import { canPushToNotion } from '@/lib/notionTeam';

/**
 * Whether the signed-in person may see Push to Notion (see lib/notionTeam.ts).
 * Reads the team list from orgStore, loading it once if nothing has yet; until
 * it arrives the answer is no, so nobody outside the team ever sees the button.
 */
export function useCanPushToNotion(): boolean {
  const load = useOrgStore((s) => s.load);
  const allowed = useOrgStore((s) => canPushToNotion(s.orgs));

  // Idempotent: no-ops once the team list is loaded.
  useEffect(() => {
    void load();
  }, [load]);

  return allowed;
}
