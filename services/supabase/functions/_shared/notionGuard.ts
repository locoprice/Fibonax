// notionGuard.ts · who may push to the team's Notion, and which page it may change.
//
// notion-snippet-push and notion-prompt-push write with one Notion key, the
// team's, whoever calls them. Two rules keep that key inside its team:
//
// 1. Only a member of the team that owns the key may push (NOTION_ORG_ID).
//    The functions check the caller's membership row before anything else.
// 2. An existing page is changed only when it sits in the team's database.
//    notion_page_id is a column the snippet's owner can edit, so without this a
//    caller could point it at any page the key reaches and overwrite it. A page
//    id that is malformed, unreadable or in another place is ignored, and a
//    new page is created in the database instead.
//
// No Deno APIs, so the app's test runner loads it by relative path
// (app/src/__tests__/notionGuard.test.ts), like read-link/linkGuard.ts.

/** The team whose Notion workspace NOTION_API_KEY belongs to. */
export const DEFAULT_NOTION_ORG_ID = '4cbb025d-2364-4e3c-8222-4c79485f7e51';

const NOTION_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A Notion page or database id, with or without dashes. Nothing else goes into a URL. */
export function isNotionId(raw: unknown): raw is string {
  return typeof raw === 'string' && NOTION_ID.test(raw);
}

/** Notion writes ids both ways; compare them without dashes or case. */
export function sameNotionId(a: string, b: string): boolean {
  return a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase();
}

/** Whether a page object Notion returned sits directly in the given database. */
export function pageIsInDatabase(page: unknown, databaseId: string): boolean {
  const parent = (page as { parent?: { type?: unknown; database_id?: unknown } } | null)?.parent;
  return (
    parent?.type === 'database_id' &&
    typeof parent.database_id === 'string' &&
    sameNotionId(parent.database_id, databaseId)
  );
}

/**
 * The stored page id when it may be updated, or null when a new page must be
 * created: missing, malformed, unreadable, or in a different place.
 */
export async function updatablePageId(
  pageId: unknown,
  databaseId: string,
  headers: Record<string, string>,
  fetchPage: typeof fetch = fetch,
): Promise<string | null> {
  if (!isNotionId(pageId) || !isNotionId(databaseId)) return null;
  const res = await fetchPage(`https://api.notion.com/v1/pages/${pageId}`, { headers });
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const page = (await res.json()) as unknown;
  return pageIsInDatabase(page, databaseId) ? pageId : null;
}
