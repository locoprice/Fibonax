import { supabase } from '@/lib/supabase';
import {
  AI_LIMIT_MESSAGE,
  AI_PRO_CHECK_MESSAGE,
  AI_PRO_MESSAGE,
  readEdgeErrorCode,
} from '@/lib/api/edgeFunctionError';
import { reconcileSuggestions, type LabelSuggestion, type RawSuggestion } from '@/lib/labelSuggest';
import type { Label } from '@/types/database';

// AI label suggestions for a draft snippet (LABELS-AI-001).
//
// The edge function reads the caller's own vocabulary under RLS and returns
// plain names. Reconciling those names against the live catalog happens here,
// on the way out, so no component ever handles unreconciled model output.

const EDGE_FN_SUGGEST_LABELS = 'suggest-labels';

/** What the editor knows about the snippet being written. */
export interface SnippetDraft {
  name: string;
  body: string;
  folderName: string | null;
  language: string | null;
}

export interface LabelSuggestApi {
  /**
   * Suggest labels for a draft. Returns an empty list when the draft is too
   * thin to judge — that is an answer, not a failure.
   */
  suggestForSnippet(
    draft: SnippetDraft,
    catalog: readonly Label[],
    assigned: readonly string[],
  ): Promise<LabelSuggestion[]>;
}

/**
 * Turn an edge-function failure into a sentence a user can act on. The
 * function distinguishes "not wired up yet" from "the model call failed", and
 * those need different responses from whoever sees them.
 *
 * The code comes from the response body (readEdgeErrorCode): supabase-js only
 * says "non-2xx status code" in `message`, so matching on it never hit.
 */
const SUGGEST_ERRORS: Record<string, string> = {
  anthropic_not_configured: 'AI suggestions are not configured yet.',
  anthropic_bad_output: 'The suggestion came back unreadable. Try again.',
  pro_check_failed: AI_PRO_CHECK_MESSAGE,
  pro_required: AI_PRO_MESSAGE,
  rate_limited: AI_LIMIT_MESSAGE,
};

function suggestError(code: string): Error {
  return new Error(SUGGEST_ERRORS[code] ?? 'Could not reach the suggestion service. Try again.');
}

export const labelSuggestApi: LabelSuggestApi = {
  async suggestForSnippet(draft, catalog, assigned) {
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      suggestions: RawSuggestion[];
    }>(EDGE_FN_SUGGEST_LABELS, {
      body: {
        name: draft.name,
        body: draft.body,
        folder_name: draft.folderName,
        language: draft.language,
      },
    });

    if (error) throw suggestError(await readEdgeErrorCode(error));
    if (!data?.ok) throw suggestError('');

    return reconcileSuggestions(data.suggestions ?? [], catalog, assigned);
  },
};
