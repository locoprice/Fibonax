import { supabase } from '@/lib/supabase';
import {
  AI_LIMIT_MESSAGE,
  AI_PRO_CHECK_MESSAGE,
  AI_PRO_MESSAGE,
  readEdgeErrorCode,
} from '@/lib/api/edgeFunctionError';

// Machine translation for a snippet body (TRANSLATE-001).
//
// The edge function masks every Fibonax token before the model sees the
// text and refuses any reply that altered one, so what comes back here either
// carries the original machinery intact or is an error. There is no partial
// success to reconcile — which is why this wrapper is as thin as it is.

const EDGE_FN_TRANSLATE = 'translate-body';

/** The languages a body can be translated into. English is always the source. */
export type TranslateTarget = 'IT' | 'ES' | 'FR';

export interface TranslateApi {
  /**
   * Translate `body` from English into `target`.
   *
   * Throws with a sentence the user can act on. Never returns a body whose
   * placeholders were changed.
   */
  translateBody(body: string, target: TranslateTarget): Promise<string>;
}

/**
 * Turn an edge-function failure into something worth reading.
 *
 * The distinctions here are the ones that change what the user does next:
 * a corrupted-placeholder refusal means "try again, it may well work", while
 * a missing key means "nothing you do in this dialog will help".
 *
 * The code comes from the response body (readEdgeErrorCode): supabase-js only
 * says "non-2xx status code" in `message`, so matching on it never hit.
 */
const TRANSLATE_ERRORS: Record<string, string> = {
  anthropic_not_configured: 'Translation is not configured yet.',
  placeholders_corrupted: 'The translation changed a field, so it was discarded. Try again.',
  translation_refused: 'This text could not be translated.',
  source_too_long: 'This body is too long to translate.',
  empty_source: 'There is no English text to translate.',
  pro_check_failed: AI_PRO_CHECK_MESSAGE,
  pro_required: AI_PRO_MESSAGE,
  rate_limited: AI_LIMIT_MESSAGE,
};

function translateError(code: string): Error {
  return new Error(TRANSLATE_ERRORS[code] ?? 'Could not reach the translation service. Try again.');
}

export const translateApi: TranslateApi = {
  async translateBody(body, target) {
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      translation: string;
    }>(EDGE_FN_TRANSLATE, {
      body: { body, target },
    });

    if (error) throw translateError(await readEdgeErrorCode(error));
    if (!data?.ok || typeof data.translation !== 'string') throw translateError('');

    return data.translation;
  },
};
