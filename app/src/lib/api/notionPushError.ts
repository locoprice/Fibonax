import { readEdgeErrorCode } from '@/lib/api/edgeFunctionError';

// What a failed Push to Notion says, for snippets and prompts alike. The codes
// come from notion-snippet-push and notion-prompt-push. supabase-js only says
// "non-2xx status code", so the code is read from the response body.

const NOTION_PUSH_ERRORS: Record<string, string> = {
  not_team_member: 'Push to Notion works only for the team that connected its Notion.',
  notion_not_configured: 'Push to Notion is not set up yet.',
  notion_create_failed: 'Notion did not accept the page. Try again.',
  snippet_not_found: 'You can push only snippets you created.',
  prompt_not_found: 'You can push only prompts you created.',
  unauthorized: 'Your session has expired. Sign in again.',
};

const NOTION_PUSH_FALLBACK = 'Could not reach Notion. Try again.';

/** The sentence a person reads when a push to Notion fails. */
export async function notionPushError(error: unknown): Promise<Error> {
  const code = await readEdgeErrorCode(error);
  return new Error(NOTION_PUSH_ERRORS[code] ?? NOTION_PUSH_FALLBACK);
}
