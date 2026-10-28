/**
 * What every AI feature says once the per-person limit is reached: the edge
 * functions answer `rate_limited` when ai_call_allow() refuses
 * (services/supabase/migrations/20261026150000_ai_call_limit.sql). Same words as
 * AI_LIMIT_TEXT on the phone.
 */
export const AI_LIMIT_MESSAGE =
  'You have reached the AI limit: 30 uses an hour and 200 a day. Try again later.';

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
