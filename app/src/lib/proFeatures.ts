// Pro features: the ones that call the AI service, pictures in snippets, which
// are kept in storage, and email layouts.
//
// Each use of an AI feature costs real money, so it belongs to the Pro plan.
// A feature runs only when its switch below is on AND the signed-in account
// is Pro (isProPlan, the same rule as is_pro() in
// services/supabase/migrations/20261028150000_pro_plan.sql). Everyone else
// sees the entry point where it lives, switched off, with a lock and the
// tooltip "Available to Pro users soon". A locked entry point cannot start a
// request: the control does nothing, and the code behind it is never reached.
// The server asks is_pro() again, so this is what a person sees, not the lock.
// An email layout costs nothing to run, so it is on for everyone.
//
// One switch per feature, so each turns on when its server function is
// deployed, independently of the others. The phone carries its own copy of
// the label, of the Ask and Picture switches and of the plan rule
// (app/public/mobile/index.html); scripts/check-pro-gate.js fails CI if they
// drift.

import { useAuthStore } from '@/stores/authStore';

/** The words every locked control shows, on every surface. */
export const PRO_SOON_LABEL = 'Available to Pro users soon';

export type ProFeature =
  /** FiboChat: the search panel's answer row. */
  | 'ask'
  /** Draft from text, in the snippet, prompt and Brain item editors. */
  | 'draft'
  /** Translate from EN, in the snippet editor. */
  | 'translate'
  /** Suggest labels, in the snippet editor. */
  | 'labels'
  /** Read a picture, in the phone's Save to Brain. On the phone only, which
      carries this switch as PICTURE_AVAILABLE. */
  | 'picture'
  /** Add a picture, in the snippet editor's side panel. Uploads to storage;
      calls no AI service. The fill surfaces show pictures already in a
      snippet whatever this says. */
  | 'snippetPictures'
  /** Use an email layout, in the snippet body's bar: an email, or an .html
      file, as the snippet. Calls no service. On for everyone until the plan
      exists (Valentina, 2026-10-27). */
  | 'emailLayout';

// Typed `boolean`, not left to infer `false`, so every call site reads as a
// live condition instead of dead code.
const AVAILABLE: Record<ProFeature, boolean> = {
  ask: true,
  draft: true,
  translate: true,
  labels: true,
  picture: true,
  snippetPictures: false,
  emailLayout: true,
};

/** Features open to every account, Pro or not: they cost nothing to run. */
const FREE_FOR_ALL: ReadonlySet<ProFeature> = new Set<ProFeature>(['emailLayout']);

/**
 * Whether an account is Pro: app_metadata.plan is 'pro' and
 * app_metadata.pro_until is a real date that has not passed. A missing or
 * unreadable date is not Pro, exactly as is_pro() decides on the server.
 */
export function isProPlan(appMetadata: Record<string, unknown> | null | undefined, now: number = Date.now()): boolean {
  if (!appMetadata || appMetadata.plan !== 'pro') return false;
  const until = appMetadata.pro_until;
  if (typeof until !== 'string') return false;
  const ends = Date.parse(until);
  return Number.isFinite(ends) && ends > now;
}

/** Whether this feature may run for the signed-in account. */
export function isProFeatureAvailable(feature: ProFeature): boolean {
  if (!AVAILABLE[feature]) return false;
  if (FREE_FOR_ALL.has(feature)) return true;
  return isProPlan(useAuthStore.getState().user?.app_metadata);
}
