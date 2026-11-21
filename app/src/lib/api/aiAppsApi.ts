import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import { aiAppLinkUrl, aiAppScopes } from '@/lib/aiAppLink';

// AI app links: keys in public.memory_tokens. Only the hash of a key is
// stored, so the link is shown once, when it is made, and never again.
// Issuing goes through memory_issue_token (the hash is computed on the server);
// listing and switching off are plain reads and writes of the person's own
// rows under row level security, which allow changing a link's name and its
// switched-off time and nothing else (20261121120000_ai_app_link.sql).

export interface AiAppLink {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
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
}

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
  };
}

export const aiAppsApi = {
  /** The links that work today, newest first. */
  async listLinks(): Promise<AiAppLink[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('memory_tokens')
      .select('id, name, scopes, created_at, last_used_at')
      .is('revoked_at', null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false });
    if (error) throw toApiError(error);
    return ((data ?? []) as LinkRow[]).map(rowToLink);
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
};
