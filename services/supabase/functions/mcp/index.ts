// mcp — Supabase Edge Function (Deno)
// The AI app link: the address a person pastes into Claude, ChatGPT or another
// AI app, made in Fibonax under Settings > Integrations > AI apps. The app then
// finds, reads and (when the link allows it) saves to the person's Prompts and
// Brains over MCP, the Model Context Protocol.
//
// This file only wires things together. The conversation is ./server.js,
// shared with the CI gate (scripts/check-mcp-link.js); who may read what is
// public.mcp_call (migration 20261121120000_ai_app_link.sql); how a Brain is
// handed out is extension/shared/memory-pack.js, carried here as
// ../_shared/memory-pack.js by scripts/sync-memory-pack.js.
//
// Guarantees, each enforced here or in what this file calls:
//
// 1. The publishable key only. There is no service-role client in this file:
//    every read and write goes through public.mcp_call with the link's key, so
//    this function can do nothing a stranger with the publishable key could
//    not do, and the key decides whose account it is. "Sign in with Fibonax"
//    adds three more database functions (mcp_oauth_*), also open to the
//    publishable key and also deciding everything themselves.
// 2. The gateway's sign-in check is off for this function (deploy with
//    verify_jwt false): AI apps send the link's key, never a Supabase sign-in.
// 3. A key is never logged. Errors are logged by what failed, not by who.
// 4. Bounded: 10 seconds a database call, 60 calls a minute a key (the key's
//    rate limit, counted in the database).
//
// Environment:
//   SUPABASE_URL, SUPABASE_ANON_KEY   injected automatically by the runtime
//   MCP_PUBLIC_URL                    optional: this server's public address
//   OPENAI_APPS_CHALLENGE             optional: OpenAI's domain check text

import '../_shared/memory-pack.js';
import { createMcpServer } from './server.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const DB_TIMEOUT_MS = 10_000;
/** The address AI apps are given. A proxy on that name forwards here (netlify.toml). */
const PUBLIC_URL = Deno.env.get('MCP_PUBLIC_URL') ?? 'https://mcp.fibonax.com';
/** Where a person approves an AI app: the dashboard, signed in. */
const CONSENT_URL = 'https://app.fibonax.com/connect';
/** The only database functions this server may call. */
const FUNCTIONS = new Set(['mcp_call', 'mcp_oauth_client', 'mcp_oauth_register', 'mcp_oauth_token']);

interface RateLimited extends Error {
  rateLimited: true;
}

async function rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
  if (!FUNCTIONS.has(name)) throw new Error(`not a function this server calls: ${name}`);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  });
  if (response.status === 429) {
    const limited = new Error('rate limited') as RateLimited;
    limited.rateLimited = true;
    throw limited;
  }
  if (!response.ok) {
    // PostgREST's own wording, without the request: it never echoes a key.
    const detail = await response.text().catch(() => '');
    throw new Error(`${name} answered ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

function callDb(key: string, action: string, args: Record<string, unknown>): Promise<unknown> {
  return rpc('mcp_call', { p_token: key, p_action: action, p_args: args });
}

const server = createMcpServer({
  callDb,
  rpc,
  publicUrl: PUBLIC_URL,
  consentUrl: CONSENT_URL,
  openaiChallenge: Deno.env.get('OPENAI_APPS_CHALLENGE') ?? '',
  pack: (globalThis as unknown as { SBMemoryPack: unknown }).SBMemoryPack,
  log: (message: string) => console.error('[mcp] ' + message),
});

Deno.serve((request: Request) => server.handle(request));
