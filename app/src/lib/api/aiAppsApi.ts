import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import { aiAppLinkUrl, aiAppScopes, type ConnectRequest } from '@/lib/aiAppLink';

// AI app links: keys in public.memory_tokens. Only the hash of a key is
// stored, so the link is shown once, when it is made, and never again.
// Issuing goes through memory_issue_token (the hash is computed on the server);
// listing and switching off are plain reads and writes of the person's own
// rows under row level security, which allow changing a link's name and its
// switched-off time and nothing else (20261121120000_ai_app_link.sql).
//
// A connection made with "Sign in with Fibonax" is a row here too
// (oauth_client_id set, 20261125130000_ai_app_sign_in.sql). Its key lasts an
// hour and the AI app renews it by itself, so it is listed while it has been
// renewed in the last 90 days, the same limit the database keeps.

export interface AiAppLink {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  /** Connected by signing in from the AI app, not by copying a link. */
  signedIn: boolean;
}

/** An AI app asking to be connected, as the /connect page shows it. */
export interface ConnectingApp {
  name: string;
}

export interface NewAiAppLink {
  link: AiAppLink;
  /** The full address with the key in it. Shown once. */
  url: string;
}

interface LinkRow {
  id: string;
  name: string;
  scopes: string[] | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  oauth_client_id: string | null;
}

/** A signed-in connection nobody renewed for this long is over. */
const SIGN_IN_IDLE_MS = 90 * 24 * 60 * 60 * 1000;

interface IssuedRow {
  token_id: string;
  token: string;
}

function rowToLink(row: LinkRow): AiAppLink {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes ?? ['read'],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    signedIn: row.oauth_client_id !== null,
  };
}

function stillWorks(row: LinkRow, now: number): boolean {
  if (row.expires_at === null) return true;
  const expires = new Date(row.expires_at).getTime();
  return row.oauth_client_id === null ? expires > now : expires > now - SIGN_IN_IDLE_MS;
}

export const aiAppsApi = {
  /** The links and connections that work today, newest first. */
  async listLinks(): Promise<AiAppLink[]> {
    const { data, error } = await supabase
      .from('memory_tokens')
      .select('id, name, scopes, created_at, last_used_at, expires_at, oauth_client_id')
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) throw toApiError(error);
    const now = Date.now();
    return ((data ?? []) as LinkRow[]).filter((row) => stillWorks(row, now)).map(rowToLink);
  },

  /** Makes a link. The address comes back once and is never stored. */
  async createLink(name: string, canSave: boolean): Promise<NewAiAppLink> {
    const { data, error } = await supabase.rpc('memory_issue_token', {
      p_name: name,
      p_expires: null,
      p_scopes: aiAppScopes(canSave),
    });
    if (error) throw toApiError(error);
    const issued = ((data ?? []) as IssuedRow[])[0];
    if (!issued) throw new Error('The link could not be made. Try again.');
    return {
      link: {
        id: issued.token_id,
        name,
        scopes: aiAppScopes(canSave),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        signedIn: false,
      },
      url: aiAppLinkUrl(issued.token),
    };
  },

  /** Switches a link off for good. The AI app loses access at once. */
  async switchOff(id: string): Promise<void> {
    const { data, error } = await supabase
      .from('memory_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('revoked_at', null)
      .select('id');
    if (error) throw toApiError(error);
    if (!data || data.length === 0) {
      throw new Error('That link is already switched off, or it is not yours.');
    }
  },

  /**
   * The AI app behind a "Sign in with Fibonax" request, or null when the app
   * is unknown or the return address is not one it registered. The page then
   * sends nobody anywhere.
   */
  async getConnectingApp(request: ConnectRequest): Promise<ConnectingApp | null> {
    const { data, error } = await supabase.rpc('mcp_oauth_client', {
      p_client_id: request.clientId,
      p_redirect_uri: request.redirectUri,
    });
    if (error) throw toApiError(error);
    const app = data as { name?: string; redirect_ok?: boolean } | null;
    if (!app || app.redirect_ok !== true || typeof app.name !== 'string') return null;
    return { name: app.name };
  },

  /** The person says yes. Returns the one-time code the AI app trades for its key. */
  async approveConnection(request: ConnectRequest, canSave: boolean): Promise<string> {
    const { data, error } = await supabase.rpc('mcp_oauth_approve', {
      p_client_id: request.clientId,
      p_redirect_uri: request.redirectUri,
      p_code_challenge: request.codeChallenge,
      p_can_save: canSave,
    });
    if (error) throw toApiError(error);
    if (typeof data !== 'string' || data === '') throw new Error('The connection could not be made. Try again.');
    return data;
  },
};
