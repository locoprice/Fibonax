import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Settings → Integrations → AI apps.
//
// • lib/aiAppLink — the link an AI app is given, what a new link may do, the
//   line that says what a link can do, and the name kept for it.
// • aiAppsApi — issuing goes through memory_issue_token with the scopes the
//   person chose; the list shows only links that work; switching off changes
//   one row and says so when nothing was changed.
// The server side is held by scripts/check-mcp-link.js.
// ─────────────────────────────────────────────────────────────────────────────

const sb = vi.hoisted(() => {
  interface RecordedQuery {
    table: string;
    calls: { name: string; args: unknown[] }[];
  }
  const state = {
    rpcResult: { data: null as unknown, error: null as unknown },
    queryResult: { data: null as unknown, error: null as unknown },
    lastRpc: null as { fn: string; args: unknown } | null,
    lastQuery: null as RecordedQuery | null,
  };
  function builder(table: string) {
    const q: RecordedQuery = { table, calls: [] };
    state.lastQuery = q;
    const b: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'is', 'or', 'order', 'update']) {
      b[name] = (...args: unknown[]) => {
        q.calls.push({ name, args });
        return b;
      };
    }
    b.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
      Promise.resolve(state.queryResult).then(onFulfilled, onRejected);
    return b;
  }
  return { state, builder };
});

vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://project.supabase.co',
  supabase: {
    from: vi.fn((table: string) => sb.builder(table)),
    rpc: vi.fn((fn: string, args?: unknown) => {
      sb.state.lastRpc = { fn, args };
      return Promise.resolve(sb.state.rpcResult);
    }),
  },
}));

import { aiAppAbilities, aiAppLinkUrl, aiAppName, aiAppScopes, AI_APP_NAME_MAX } from '@/lib/aiAppLink';
import { aiAppsApi } from '@/lib/api/aiAppsApi';

const KEY = 'sbmw_' + 'a'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  sb.state.rpcResult = { data: null, error: null };
  sb.state.queryResult = { data: null, error: null };
  sb.state.lastRpc = null;
  sb.state.lastQuery = null;
});

describe('lib/aiAppLink', () => {
  it('builds the server function address with the key in it', () => {
    expect(aiAppLinkUrl(KEY)).toBe(`https://project.supabase.co/functions/v1/mcp?key=${KEY}`);
  });

  it('gives a new link Prompts and Brains, and saving only when asked', () => {
    expect(aiAppScopes(false)).toEqual(['read', 'prompts']);
    expect(aiAppScopes(true)).toEqual(['read', 'prompts', 'write']);
  });

  it('says in plain words what a link can do', () => {
    expect(aiAppAbilities(['read', 'prompts'])).toBe('Reads your prompts and Brains');
    expect(aiAppAbilities(['read', 'prompts', 'write'])).toBe('Reads your prompts and Brains, can save to Brains');
    // A key made before Prompts could be reached.
    expect(aiAppAbilities(['read'])).toBe('Reads your Brains');
  });

  it('keeps a tidy name, never an empty one', () => {
    expect(aiAppName('  Claude   desktop ')).toBe('Claude desktop');
    expect(aiAppName('   ')).toBeNull();
    expect(aiAppName('x'.repeat(80))).toHaveLength(AI_APP_NAME_MAX);
  });
});

describe('aiAppsApi', () => {
  it('issues a link through memory_issue_token and hands back the address once', async () => {
    sb.state.rpcResult = { data: [{ token_id: 'id-1', token: KEY }], error: null };
    const made = await aiAppsApi.createLink('Claude', true);
    expect(sb.state.lastRpc).toEqual({
      fn: 'memory_issue_token',
      args: { p_name: 'Claude', p_expires: null, p_scopes: ['read', 'prompts', 'write'] },
    });
    expect(made.url).toBe(aiAppLinkUrl(KEY));
    expect(made.link).toMatchObject({ id: 'id-1', name: 'Claude', scopes: ['read', 'prompts', 'write'], lastUsedAt: null });
  });

  it("passes on the server's own wording when a link cannot be made", async () => {
    sb.state.rpcResult = {
      data: null,
      error: { message: 'You already have 21 AI app links. Switch one off, then try again.', code: 'P0001' },
    };
    await expect(aiAppsApi.createLink('Claude', false)).rejects.toThrow('You already have 21 AI app links.');
  });

  it('lists only links that work: not switched off, not expired', async () => {
    sb.state.queryResult = {
      data: [{ id: 'id-1', name: 'ChatGPT', scopes: ['read'], created_at: '2026-11-20T10:00:00Z', last_used_at: null }],
      error: null,
    };
    const links = await aiAppsApi.listLinks();
    expect(sb.state.lastQuery?.table).toBe('memory_tokens');
    const names = sb.state.lastQuery?.calls.map((c) => c.name);
    expect(names).toEqual(['select', 'is', 'or', 'order']);
    expect(sb.state.lastQuery?.calls[1]?.args).toEqual(['revoked_at', null]);
    expect(String(sb.state.lastQuery?.calls[2]?.args[0])).toMatch(/^expires_at\.is\.null,expires_at\.gt\./);
    // The select never asks for the key's hash.
    expect(String(sb.state.lastQuery?.calls[0]?.args[0])).not.toContain('token_hash');
    expect(links).toEqual([{ id: 'id-1', name: 'ChatGPT', scopes: ['read'], createdAt: '2026-11-20T10:00:00Z', lastUsedAt: null }]);
  });

  it('switches off one live link and says so when nothing changed', async () => {
    sb.state.queryResult = { data: [{ id: 'id-1' }], error: null };
    await aiAppsApi.switchOff('id-1');
    const calls = sb.state.lastQuery?.calls ?? [];
    expect(calls.map((c) => c.name)).toEqual(['update', 'eq', 'is', 'select']);
    expect(Object.keys(calls[0]?.args[0] as object)).toEqual(['revoked_at']);

    sb.state.queryResult = { data: [], error: null };
    await expect(aiAppsApi.switchOff('id-1')).rejects.toThrow('already switched off');
  });
});
