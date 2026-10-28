import type { OrganizationSummary } from '@/types/database';

// Who sees Push to Notion.
//
// Push to Notion writes with one team's Notion key into that team's database,
// so the server lets only that team's members push
// (services/supabase/functions/_shared/notionGuard.ts, DEFAULT_NOTION_ORG_ID).
// The dashboard shows the Notion buttons to the same people and to nobody
// else: anyone outside the team would only get an error. A test pins the two
// ids together (src/__tests__/notionTeam.test.ts).

/** The team whose Notion database Push to Notion writes to. */
export const NOTION_TEAM_ID = '4cbb025d-2364-4e3c-8222-4c79485f7e51';

/**
 * Prompts push through their own function, notion-prompt-push, which is not
 * deployed and has no prompts database yet. Until both exist the prompt
 * card's Notion button stays hidden for everyone. Typed `boolean`, not left to
 * infer `false`, so the call site reads as a live condition.
 */
export const PROMPT_NOTION_PUSH_AVAILABLE: boolean = false;

/** Whether someone who belongs to these teams may push to the team's Notion. */
export function canPushToNotion(orgs: readonly Pick<OrganizationSummary, 'id'>[]): boolean {
  return orgs.some((org) => org.id === NOTION_TEAM_ID);
}
