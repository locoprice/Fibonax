/**
 * The AI app link (Settings > Integrations > AI apps).
 *
 * A person makes a link and pastes it into Claude, ChatGPT or another AI app,
 * which then finds and reads their prompts and Brains over MCP, and saves to a
 * Brain when the link allows it. The link is the address of the `mcp` server
 * function with the key in it: most AI apps only take a link, so the key has to
 * travel inside it. The server function, and what a key may reach, are
 * described in services/supabase/functions/mcp/index.ts and the migration
 * 20261121120000_ai_app_link.sql; scripts/check-mcp-link.js holds this file to
 * them.
 */
import { SUPABASE_URL } from '@/lib/supabase';

/** The names offered as one tap when a link is made. Anything else is typed. */
export const AI_APP_SUGGESTIONS = ['Claude', 'ChatGPT'] as const;

/** The longest name the database keeps for a link (memory_tokens.name). */
export const AI_APP_NAME_MAX = 48;

/** The address an AI app is given: the server function, carrying the key. */
export function aiAppLinkUrl(key: string): string {
  return `${SUPABASE_URL}/functions/v1/mcp?key=${encodeURIComponent(key)}`;
}

/**
 * What a new link may do: read Prompts and Brains always, save to Brains only
 * when the person turns it on.
 */
export function aiAppScopes(canSave: boolean): string[] {
  return canSave ? ['read', 'prompts', 'write'] : ['read', 'prompts'];
}

/** One line saying what a link can do, from its scopes. */
export function aiAppAbilities(scopes: readonly string[]): string {
  const reads = scopes.includes('prompts') ? 'Reads your prompts and Brains' : 'Reads your Brains';
  return scopes.includes('write') ? `${reads}, can save to Brains` : reads;
}

/** A name as the database keeps it, or null when there is nothing to keep. */
export function aiAppName(value: string): string | null {
  const name = value.replace(/\s+/g, ' ').trim().slice(0, AI_APP_NAME_MAX).trim();
  return name ? name : null;
}

/**
 * "Sign in with Fibonax": what an AI app asks for when it sends a person to
 * /connect (through the server function's /authorize, which has already
 * checked the app and its return address).
 */
export interface ConnectRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request in the page's address, or null when a part is missing or malformed. */
export function readConnectRequest(search: string): ConnectRequest | null {
  const q = new URLSearchParams(search);
  const clientId = q.get('client_id') ?? '';
  const redirectUri = q.get('redirect_uri') ?? '';
  const codeChallenge = q.get('code_challenge') ?? '';
  if (!UUID_RE.test(clientId) || !redirectUri || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return null;
  return { clientId, redirectUri, codeChallenge, state: q.get('state') ?? '' };
}

/** `redirectUri` with `params` added to its query, keeping what it already has. */
export function connectReturnUrl(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== '') url.searchParams.set(name, value);
  }
  return url.toString();
}

/**
 * Where the person goes after answering, in words: the site's name for a web
 * address, "this computer" for an app listening locally, and the app's own
 * scheme for an installed app. Shown on the page so nobody approves a name
 * without seeing where it leads.
 */
export function connectReturnPlace(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    if (url.protocol === 'https:') return url.hostname;
    if (url.protocol === 'http:') return 'an app on this computer';
    return `the ${url.protocol.replace(':', '')} app on this device`;
  } catch {
    return 'your AI app';
  }
}
