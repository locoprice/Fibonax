import { supabase } from '@/lib/supabase';
import {
  AI_LIMIT_MESSAGE,
  AI_PRO_CHECK_MESSAGE,
  AI_PRO_MESSAGE,
  readEdgeErrorCode,
} from '@/lib/api/edgeFunctionError';

// Improve with AI, in the snippet editor's Quality window. The review-snippet
// edge function reads the name and body sent here and returns suggestions;
// nothing is saved and the rule-based score is never touched.

const EDGE_FN_REVIEW_SNIPPET = 'review-snippet';

export type ReviewArea = 'clarity' | 'completeness' | 'value' | 'title' | 'care';

export interface ReviewSuggestion {
  area: ReviewArea;
  issue: string;
  fix: string;
}

export interface SnippetReview {
  summary: string;
  suggestions: ReviewSuggestion[];
}

export interface SnippetReviewDraft {
  name: string;
  body: string;
  language: string;
}

const REVIEW_AREAS: readonly ReviewArea[] = ['clarity', 'completeness', 'value', 'title', 'care'];

const REVIEW_ERRORS: Record<string, string> = {
  anthropic_not_configured: 'Improve with AI is not set up yet.',
  anthropic_bad_output: 'The suggestions came back unreadable. Try again.',
  anthropic_refused: 'The AI could not review this text.',
  too_short: 'Write a few words first, then ask for suggestions.',
  too_long: 'This snippet is too long to review in one go.',
  pro_check_failed: AI_PRO_CHECK_MESSAGE,
  pro_required: AI_PRO_MESSAGE,
  rate_limited: AI_LIMIT_MESSAGE,
};

function reviewError(code: string): Error {
  return new Error(REVIEW_ERRORS[code] ?? 'Could not reach the AI service. Try again.');
}

/** Keeps only what the window can show: known areas, no blank text. */
function readSuggestions(raw: unknown): ReviewSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ReviewSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { area, issue, fix } = item as Record<string, unknown>;
    if (typeof area !== 'string' || !REVIEW_AREAS.includes(area as ReviewArea)) continue;
    if (typeof issue !== 'string' || typeof fix !== 'string' || !issue.trim() || !fix.trim()) continue;
    out.push({ area: area as ReviewArea, issue: issue.trim(), fix: fix.trim() });
  }
  return out;
}

export const snippetReviewApi = {
  async review(draft: SnippetReviewDraft): Promise<SnippetReview> {
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      summary?: unknown;
      suggestions?: unknown;
    }>(EDGE_FN_REVIEW_SNIPPET, {
      body: { name: draft.name, body: draft.body, language: draft.language },
    });

    if (error) throw reviewError(await readEdgeErrorCode(error));
    if (!data?.ok) throw reviewError('');

    return {
      summary: typeof data.summary === 'string' ? data.summary.trim() : '',
      suggestions: readSuggestions(data.suggestions),
    };
  },
};
