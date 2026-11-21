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
//    not do, and the key decides whose account it is.
// 2. The gateway's sign-in check is off for this function (deploy with
//    verify_jwt false): AI apps send the link's key, never a Supabase sign-in.
// 3. A key is never logged. Errors are logged by what failed, not by who.
// 4. Bounded: 10 seconds a database call, 60 calls a minute a key (the key's
//    rate limit, counted in the database).
//
// Environment (injected automatically by the runtime):
//   SUPABASE_URL, SUPABASE_ANON_KEY

import '../_shared/memory-pack.js';
import { createMcpServer } from './server.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const DB_TIMEOUT_MS = 10_000;

interface RateLimited extends Error {
  rateLimited: true;
}

async function callDb(key: string, action: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mcp_call`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_token: key, p_action: action, p_args: args }),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  });
  if (response.status === 429) {
    const limited = new Error('rate limited') as RateLimited;
    limited.rateLimited = true;
    throw limited;
  }
  if (!response.ok) {
    // PostgREST's own wording, without the request: it never echoes the key.
    const detail = await response.text().catch(() => '');
    throw new Error(`mcp_call ${action} answered ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

const server = createMcpServer({
  callDb,
  pack: (globalThis as unknown as { SBMemoryPack: unknown }).SBMemoryPack,
  log: (message: string) => console.error('[mcp] ' + message),
});

Deno.serve((request: Request) => server.handle(request));
