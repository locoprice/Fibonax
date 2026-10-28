import { FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  isNotionId,
  pageIsInDatabase,
  sameNotionId,
  updatablePageId,
} from '../../../services/supabase/functions/_shared/notionGuard';

// Push to Notion writes with the team's Notion key. These tests pin the rule
// that keeps it inside the team database: a stored page id is followed only
// when it is a real id of a page in that database, and nothing else ever
// reaches a Notion URL. The membership half is checked in the functions.

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));

import { promptsApi } from '@/lib/api/promptsApi';
import { snippetsApi } from '@/lib/api/snippetsApi';

const DB = 'a06cac8d5e0282c28c4101e9e3ea3f88';
const DB_DASHED = 'a06cac8d-5e02-82c2-8c41-01e9e3ea3f88';
const PAGE = '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b';
const HEADERS = { Authorization: 'Bearer test' };

function pageReply(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('isNotionId', () => {
  it.each([DB, DB_DASHED, PAGE, PAGE.toUpperCase()])('accepts %s', (id) => {
    expect(isNotionId(id)).toBe(true);
  });

  it.each([
    '',
    'not-an-id',
    `${PAGE}/../databases/${DB}`,
    `../../v1/databases/${DB}/query`,
    `${DB}?x=1`,
    `${DB}0`,
    null,
    42,
  ])('refuses %s', (id) => {
    expect(isNotionId(id)).toBe(false);
  });
});

describe('sameNotionId and pageIsInDatabase', () => {
  it('matches an id written with or without dashes', () => {
    expect(sameNotionId(DB, DB_DASHED)).toBe(true);
    expect(sameNotionId(DB, PAGE)).toBe(false);
  });

  it('accepts only a page whose parent is the team database', () => {
    expect(pageIsInDatabase({ parent: { type: 'database_id', database_id: DB_DASHED } }, DB)).toBe(true);
    expect(pageIsInDatabase({ parent: { type: 'database_id', database_id: PAGE } }, DB)).toBe(false);
    expect(pageIsInDatabase({ parent: { type: 'page_id', page_id: DB } }, DB)).toBe(false);
    expect(pageIsInDatabase({ parent: { type: 'workspace', workspace: true } }, DB)).toBe(false);
    expect(pageIsInDatabase(null, DB)).toBe(false);
  });
});

describe('updatablePageId', () => {
  it('keeps a page that sits in the team database', async () => {
    const fetchPage = pageReply(200, { parent: { type: 'database_id', database_id: DB_DASHED } });
    await expect(updatablePageId(PAGE, DB, HEADERS, fetchPage)).resolves.toBe(PAGE);
    expect(fetchPage).toHaveBeenCalledWith(`https://api.notion.com/v1/pages/${PAGE}`, { headers: HEADERS });
  });

  it('drops a page that sits anywhere else', async () => {
    const fetchPage = pageReply(200, { parent: { type: 'page_id', page_id: PAGE } });
    await expect(updatablePageId(PAGE, DB, HEADERS, fetchPage)).resolves.toBeNull();
  });

  it('drops a page Notion cannot find', async () => {
    await expect(updatablePageId(PAGE, DB, HEADERS, pageReply(404, { code: 'object_not_found' }))).resolves.toBeNull();
  });

  it('never asks Notion about a malformed id', async () => {
    const fetchPage = pageReply(200, {});
    await expect(updatablePageId(`../../v1/databases/${DB}/query`, DB, HEADERS, fetchPage)).resolves.toBeNull();
    await expect(updatablePageId(null, DB, HEADERS, fetchPage)).resolves.toBeNull();
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe('what a failed push says on the dashboard', () => {
  function failWith(status: number, code: string): void {
    invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(
        new Response(JSON.stringify({ error: code }), { status, headers: { 'Content-Type': 'application/json' } }),
      ),
    });
  }

  it('tells someone outside the team, for snippets and prompts alike', async () => {
    const outside = 'Push to Notion works only for the team that connected its Notion.';
    failWith(403, 'not_team_member');
    await expect(snippetsApi.pushToNotion('s1')).rejects.toThrow(outside);
    failWith(403, 'not_team_member');
    await expect(promptsApi.pushToNotion('p1')).rejects.toThrow(outside);
  });

  it('falls back to a plain retry message', async () => {
    failWith(500, 'db_update_failed');
    await expect(snippetsApi.pushToNotion('s1')).rejects.toThrow('Could not reach Notion. Try again.');
  });
});
