import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Settings → Integrations → AI apps.
//
// • lib/aiAppLink — the link an AI app is given, what a new link may do, the
//   line that says what a link can do, and the name kept for it.
// • aiAppsApi — issuing goes through memory_issue_token with the scopes the
//   person chose; the list shows only links that work; switching off changes
//   one row and says so when nothing was changed.
// • "Sign in with Fibonax" — the request the /connect page reads from its
//   address, where it sends the person back, and the two calls behind Allow.
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

import {
  aiAppAbilities,
  aiAppLinkUrl,
  aiAppName,
  aiAppScopes,
  AI_APP_NAME_MAX,
  connectReturnPlace,
  connectReturnUrl,
  readConnectRequest,
} from '@/lib/aiAppLink';
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

  it('lists only what works: not switched off, not expired, and sign-in connections renewed in the last 90 days', async () => {
    const day = 24 * 60 * 60 * 1000;
    const at = (offset: number): string => new Date(Date.now() + offset).toISOString();
    const row = (id: string, expires_at: string | null, oauth_client_id: string | null) => ({
      id, name: id, scopes: ['read'], created_at: '2026-11-20T10:00:00Z', last_used_at: null, expires_at, oauth_client_id,
    });
    sb.state.queryResult = {
      data: [
        row('link', null, null),
        row('expired-link', at(-day), null),
        row('signed-in', at(-2 * day), 'client-1'),
        row('signed-in-idle', at(-91 * day), 'client-1'),
      ],
      error: null,
    };
    const links = await aiAppsApi.listLinks();
    expect(sb.state.lastQuery?.table).toBe('memory_tokens');
    expect(sb.state.lastQuery?.calls.map((c) => c.name)).toEqual(['select', 'is', 'order']);
    expect(sb.state.lastQuery?.calls[1]?.args).toEqual(['revoked_at', null]);
    // The select never asks for a hash: the database refuses those columns.
    expect(String(sb.state.lastQuery?.calls[0]?.args[0])).not.toMatch(/hash/);
    expect(links.map((l) => [l.id, l.signedIn])).toEqual([['link', false], ['signed-in', true]]);
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

describe('Sign in with Fibonax', () => {
  const CLIENT = '8a420c4d-9ad3-429a-8fb9-8adb7369f1b0';
  const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const SEARCH = `?client_id=${CLIENT}&redirect_uri=${encodeURIComponent('https://claude.ai/cb?x=1')}&code_challenge=${CHALLENGE}&state=abc`;

  it('reads a whole request and refuses a partial one', () => {
    expect(readConnectRequest(SEARCH)).toEqual({
      clientId: CLIENT, redirectUri: 'https://claude.ai/cb?x=1', codeChallenge: CHALLENGE, state: 'abc',
    });
    expect(readConnectRequest(SEARCH.replace(CLIENT, 'nope'))).toBeNull();
    expect(readConnectRequest(SEARCH.replace(CHALLENGE, 'short'))).toBeNull();
    expect(readConnectRequest(`?client_id=${CLIENT}&code_challenge=${CHALLENGE}`)).toBeNull();
  });

  it('sends the person back with the answer, keeping the address as it was', () => {
    expect(connectReturnUrl('https://claude.ai/cb?x=1', { code: 'sbmc_1', state: 'a b' })).toBe(
      'https://claude.ai/cb?x=1&code=sbmc_1&state=a+b',
    );
    // No state was sent: none goes back.
    expect(connectReturnUrl('cursor://app/cb', { code: 'c', state: '' })).toBe('cursor://app/cb?code=c');
  });

  it('says in words where the person goes back to', () => {
    expect(connectReturnPlace('https://claude.ai/api/cb')).toBe('claude.ai');
    expect(connectReturnPlace('http://localhost:6274/cb')).toBe('an app on this computer');
    expect(connectReturnPlace('cursor://app/cb')).toBe('the cursor app on this device');
    expect(connectReturnPlace('not an address')).toBe('your AI app');
  });

  it('shows an app only when its return address is its own', async () => {
    const request = readConnectRequest(SEARCH);
    if (!request) throw new Error('fixture');
    sb.state.rpcResult = { data: { name: 'Claude', redirect_ok: true }, error: null };
    expect(await aiAppsApi.getConnectingApp(request)).toEqual({ name: 'Claude' });
    expect(sb.state.lastRpc).toEqual({
      fn: 'mcp_oauth_client',
      args: { p_client_id: CLIENT, p_redirect_uri: 'https://claude.ai/cb?x=1' },
    });
    sb.state.rpcResult = { data: { name: 'Claude', redirect_ok: false }, error: null };
    expect(await aiAppsApi.getConnectingApp(request)).toBeNull();
    sb.state.rpcResult = { data: null, error: null };
    expect(await aiAppsApi.getConnectingApp(request)).toBeNull();
  });

  it('approves with the choice about saving and hands back the one-time code', async () => {
    const request = readConnectRequest(SEARCH);
    if (!request) throw new Error('fixture');
    sb.state.rpcResult = { data: 'sbmc_code', error: null };
    expect(await aiAppsApi.approveConnection(request, true)).toBe('sbmc_code');
    expect(sb.state.lastRpc).toEqual({
      fn: 'mcp_oauth_approve',
      args: { p_client_id: CLIENT, p_redirect_uri: 'https://claude.ai/cb?x=1', p_code_challenge: CHALLENGE, p_can_save: true },
    });
    sb.state.rpcResult = { data: null, error: { message: 'Too many tries in a few minutes. Wait a little, then connect again.', code: 'P0001' } };
    await expect(aiAppsApi.approveConnection(request, false)).rejects.toThrow('Too many tries');
  });
});
