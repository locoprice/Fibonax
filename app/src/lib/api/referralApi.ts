import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import {
  REFERRAL_TEXT,
  forgetReferralCode,
  pendingReferralCode,
  readReferralClaim,
  readReferralSummary,
  type ReferralClaimStatus,
  type ReferralSummary,
} from '@/lib/referral';

// Refer a friend's two server calls (migration 20261118130000_referrals.sql).
// Each is keyed on the caller's own session, so neither takes a user id.

export const referralApi = {
  /** This person's link, friends and own place. Makes the link on the first read. */
  async getSummary(): Promise<ReferralSummary> {
    const { data, error } = await supabase.rpc('referral_summary');
    if (error) throw toApiError(error, REFERRAL_TEXT.loadFailed);
    const summary = readReferralSummary(data);
    if (!summary) throw toApiError(new Error(REFERRAL_TEXT.loadFailed));
    return summary;
  },

  /**
   * Place this account under a friend's code. The server's one-word answer,
   * or null when the call itself failed. Never throws: the window turns
   * either into a sentence.
   */
  async claim(code: string): Promise<ReferralClaimStatus | null> {
    try {
      const { data, error } = await supabase.rpc('referral_claim', { p_code: code });
      if (error) {
        console.warn('referralApi: code not placed', error);
        return null;
      }
      return readReferralClaim(data);
    } catch (err) {
      console.warn('referralApi: code not placed', err);
      return null;
    }
  },
};

// One call at a time: the sign-up page, the callback and the dashboard can
// all reach for the waiting code within the same second.
let placing: Promise<ReferralClaimStatus | null> | null = null;

async function placeWaitingCode(): Promise<ReferralClaimStatus | null> {
  const code = pendingReferralCode();
  if (!code) return null;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  const status = await referralApi.claim(code);
  // Kept only when the call itself failed, so the next page load tries again.
  if (status !== null && status !== 'signed_out') forgetReferralCode();
  return status;
}

/**
 * Place the signed-in account under the link it arrived through, if one is
 * waiting in this browser. Null when there was nothing to do.
 */
export function placePendingReferral(): Promise<ReferralClaimStatus | null> {
  if (!placing) {
    placing = placeWaitingCode().finally(() => {
      placing = null;
    });
  }
  return placing;
}

const LEAVE_WAIT_MS = 2500;

/**
 * Send a phone to the mobile app, after the waiting code (if any) is placed:
 * leaving the page first would cut the call short. Never waits longer than
 * LEAVE_WAIT_MS, and does not wait at all when no code is waiting.
 */
export async function leaveForMobile(): Promise<void> {
  if (pendingReferralCode()) {
    await Promise.race([
      placePendingReferral(),
      new Promise<void>((resolve) => window.setTimeout(resolve, LEAVE_WAIT_MS)),
    ]);
  }
  window.location.replace('/mobile/');
}
