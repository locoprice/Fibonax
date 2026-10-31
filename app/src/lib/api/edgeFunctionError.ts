/**
 * What every AI feature says once the per-person limit is reached: the edge
 * functions answer `rate_limited` when ai_call_allow() refuses
 * (services/supabase/migrations/20261026150000_ai_call_limit.sql). Same words as
 * AI_LIMIT_TEXT on the phone.
 */
export const AI_LIMIT_MESSAGE =
  'You have reached the AI limit: 30 uses an hour and 200 a day. Try again later.';

/**
 * What every AI feature says to an account that is not Pro: the edge functions
 * answer `pro_required` when is_pro() is false
 * (services/supabase/migrations/20261028150000_pro_plan.sql), and
 * `pro_check_failed` when the plan could not be read. Same words as
 * AI_PRO_TEXT and AI_PRO_CHECK_TEXT on the phone.
 */
export const AI_PRO_MESSAGE = 'AI features are part of Fibonax Pro.';
export const AI_PRO_CHECK_MESSAGE = 'Could not check your plan. Try again.';

/**
 * The `error` code an edge function sent back with a failed response.
 *
 * supabase-js leaves `message` generic ("Edge Function returned a non-2xx
 * status code") and puts the failed Response on `context`, so the code has to
 * be read from the body. Returns '' when there is none.
 */
export async function readEdgeErrorCode(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return '';
  try {
    const body = (await context.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : '';
  } catch {
    return '';
  }
}
