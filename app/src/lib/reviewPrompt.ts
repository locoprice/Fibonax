/**
 * When to ask a free account for a Chrome Web Store review.
 *
 * One short line and a button, shown after 10 sign-ins and at most 5 times.
 * The rule is decided once in `extension/shared/review-prompt.js` (the popup
 * runs that file) and copied here for the dashboard. `__tests__/reviewPrompt
 * .test.ts` loads both and runs the same cases over them, so the two surfaces
 * cannot show it at different moments.
 *
 * The counts live on the server, per person (migration
 * `20261027140000_review_prompt.sql`): a trigger counts sign-ins, and
 * `review_prompt_record_view()` holds the cap of MAX_VIEWS on its own.
 *
 * Every answer fails closed: a missing or malformed field hides the prompt.
 */

export const REVIEW_PROMPT_START_LOGIN = 10;
export const REVIEW_PROMPT_MAX_VIEWS = 5;
export const REVIEW_PROMPT_PLAN_FREE = 'free';
export const REVIEW_PROMPT_URL =
  'https://chromewebstore.google.com/detail/fibonax/khdpimdpkgmmaimpbfjgglnpaemmopoo/reviews';
export const REVIEW_PROMPT_MESSAGE = "You're using an enterprise tool for free.";
export const REVIEW_PROMPT_REVIEW_LABEL = 'Leave us a review :)';
/** What a screen reader says: the same words without the smiley. */
export const REVIEW_PROMPT_REVIEW_ARIA_LABEL = 'Leave us a review';
export const REVIEW_PROMPT_STOP_LABEL = "Don't ask again";

/** Why the server stopped asking: they opened the review page, or said no. */
export type ReviewPromptStopReason = 'reviewed' | 'dismissed';

export interface ReviewPromptState {
  /** Real sign-ins counted for this person, on every device. */
  loginCount: number;
  /** Times the prompt was drawn. Never above REVIEW_PROMPT_MAX_VIEWS. */
  viewCount: number;
  /** They opened the review page or chose "Don't ask again". Permanent. */
  stopped: boolean;
  /** 'free' unless billing set something else. */
  plan: string;
  /** Already drawn in this sign-in session: a reload does not draw it again. */
  viewedThisSession: boolean;
}

interface StatusRow {
  login_count?: unknown;
  view_count?: unknown;
  stopped?: unknown;
  plan?: unknown;
  viewed_this_session?: unknown;
}

/** The server's one-row answer to `review_prompt_status()`, or null when it is not usable. */
export function readReviewPromptStatus(body: unknown): ReviewPromptState | null {
  const row = (Array.isArray(body) ? body[0] : body) as StatusRow | null | undefined;
  if (!row || typeof row !== 'object') return null;
  const { login_count, view_count, stopped, plan, viewed_this_session } = row;
  if (typeof login_count !== 'number' || typeof view_count !== 'number') return null;
  if (typeof stopped !== 'boolean' || typeof viewed_this_session !== 'boolean') return null;
  if (typeof plan !== 'string') return null;
  return {
    loginCount: login_count,
    viewCount: view_count,
    stopped,
    plan,
    viewedThisSession: viewed_this_session,
  };
}

/**
 * True when the prompt may be drawn now. Drawing is a separate step: the caller
 * must still win `review_prompt_record_view()` and draws only on true.
 */
export function shouldShowReviewPrompt(state: ReviewPromptState | null): boolean {
  if (!state) return false;
  if (state.plan !== REVIEW_PROMPT_PLAN_FREE) return false;
  if (state.stopped !== false) return false;
  if (state.viewedThisSession !== false) return false;
  if (!(state.loginCount >= REVIEW_PROMPT_START_LOGIN)) return false;
  if (!(state.viewCount < REVIEW_PROMPT_MAX_VIEWS)) return false;
  return true;
}
