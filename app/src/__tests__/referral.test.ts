import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REFERRALS_OPEN,
  REFERRAL_DAYS,
  REFERRAL_MAX_FRIENDS,
  REFERRAL_TEXT,
  arrivalToast,
  claimMessage,
  daysLeft,
  friendLine,
  invitedLine,
  pendingReferralCode,
  readReferralClaim,
  readReferralCode,
  readReferralSummary,
  referralLink,
  rememberReferralCode,
  type ReferralClaimStatus,
} from '@/lib/referral';

// Refer a friend (lib/referral.ts, migration 20261118130000_referrals.sql).
//
// The server holds the rule; these tests cover how the dashboard reads a code,
// reads the server's answers and words them, and pin the numbers and the
// switch to the files that must agree with them.

const REPO = resolve(process.cwd(), '..');
const MIGRATION = readFileSync(
  resolve(REPO, 'services', 'supabase', 'migrations', '20261118130000_referrals.sql'),
  'utf8',
);
const NOW = Date.parse('2026-11-18T12:00:00Z');
const inDays = (days: number): string => new Date(NOW + days * 86_400_000).toISOString();

describe('the invite link and its code', () => {
  it('builds the link a person shares', () => {
    expect(referralLink('ABCD2345')).toBe('https://app.fibonax.com/signup?ref=ABCD2345');
  });

  it('reads the code back out of the link', () => {
    expect(readReferralCode(referralLink('ABCD2345'))).toBe('ABCD2345');
    expect(readReferralCode('?next=%2F&ref=abcd2345')).toBe('ABCD2345');
    expect(readReferralCode('https://app.fibonax.com/signup?ref=ABCD2345#top')).toBe('ABCD2345');
  });

  it('reads a code typed by hand, in any case, with spaces or a dash', () => {
    expect(readReferralCode('abcd2345')).toBe('ABCD2345');
    expect(readReferralCode('  abcd-2345 ')).toBe('ABCD2345');
    expect(readReferralCode('ABCD 2345')).toBe('ABCD2345');
  });

  it('refuses what is not a code', () => {
    for (const bad of ['', null, undefined, 'hello', 'ABCD234', 'ABCD23456', 'ABCD234O', 'ABCD2341', '?ref=']) {
      expect(readReferralCode(bad)).toBeNull();
    }
  });
});

describe('the server answers', () => {
  const body = {
    code: 'ABCD2345',
    max_friends: 3,
    days: 7,
    places_used: 2,
    friends: [
      { label: 'b***@example.com', joined_at: inDays(-1), deadline: inDays(6), state: 'waiting' },
      { label: 'c***@example.com', joined_at: inDays(-3), deadline: inDays(4), state: 'rewarded' },
      { label: 'd***@example.com', joined_at: inDays(-9), deadline: inDays(-2), state: 'expired' },
    ],
    invited: { deadline: inDays(2), state: 'waiting' },
    can_enter_code: false,
  };

  it('reads a summary', () => {
    const summary = readReferralSummary(body);
    expect(summary?.code).toBe('ABCD2345');
    expect(summary?.placesUsed).toBe(2);
    expect(summary?.friends.map((f) => f.state)).toEqual(['waiting', 'rewarded', 'expired']);
    expect(summary?.invited?.state).toBe('waiting');
    expect(summary?.canEnterCode).toBe(false);
  });

  it('reads a person nobody invited', () => {
    const summary = readReferralSummary({ ...body, friends: [], places_used: 0, invited: null, can_enter_code: true });
    expect(summary?.friends).toEqual([]);
    expect(summary?.invited).toBeNull();
    expect(summary?.canEnterCode).toBe(true);
  });

  it('fails closed on anything malformed', () => {
    expect(readReferralSummary(null)).toBeNull();
    expect(readReferralSummary('ABCD2345')).toBeNull();
    expect(readReferralSummary({ ...body, code: 'nope' })).toBeNull();
    expect(readReferralSummary({ ...body, places_used: '2' })).toBeNull();
    expect(readReferralSummary({ ...body, friends: null })).toBeNull();
    expect(readReferralSummary({ ...body, friends: [{ label: 'x', deadline: 'soon', state: 'waiting' }] })).toBeNull();
    expect(readReferralSummary({ ...body, friends: [{ label: 'x', deadline: inDays(1), state: 'paid' }] })).toBeNull();
    expect(readReferralSummary({ ...body, invited: { deadline: inDays(1), state: 'paid' } })).toBeNull();
  });

  it('reads the one-word answer to a code', () => {
    expect(readReferralClaim('ok')).toBe('ok');
    expect(readReferralClaim('full')).toBe('full');
    expect(readReferralClaim('maybe')).toBeNull();
    expect(readReferralClaim(null)).toBeNull();
  });
});

describe('the words', () => {
  it('counts a started day as a day, and never goes below 0', () => {
    expect(daysLeft(inDays(7), NOW)).toBe(7);
    expect(daysLeft(inDays(6.2), NOW)).toBe(7);
    expect(daysLeft(inDays(0.1), NOW)).toBe(1);
    expect(daysLeft(inDays(-1), NOW)).toBe(0);
    expect(daysLeft('soon', NOW)).toBe(0);
  });

  it('says where each friend stands', () => {
    const friend = { label: 'b***@example.com', deadline: inDays(5), state: 'waiting' as const };
    expect(friendLine(friend, NOW)).toBe('5 days left to subscribe.');
    expect(friendLine({ ...friend, deadline: inDays(0.5) }, NOW)).toBe('Last day to subscribe.');
    expect(friendLine({ ...friend, state: 'rewarded' }, NOW)).toBe('Subscribed. You both got a free month.');
    expect(friendLine({ ...friend, state: 'expired' }, NOW)).toBe('Did not subscribe in time.');
  });

  it('tells an invited person what is left to do', () => {
    expect(invitedLine({ deadline: inDays(3), state: 'waiting' }, NOW)).toContain('in the next 3 days');
    expect(invitedLine({ deadline: inDays(0.2), state: 'waiting' }, NOW)).toContain('today');
    expect(invitedLine({ deadline: inDays(-1), state: 'expired' }, NOW)).toContain('have passed');
    expect(invitedLine({ deadline: inDays(2), state: 'rewarded' }, NOW)).toContain('free month');
  });

  it('has a sentence for every answer to a code', () => {
    const statuses: (ReferralClaimStatus | null)[] = [
      'ok', 'unknown', 'own', 'already', 'too_late', 'already_pro', 'full', 'signed_out', null,
    ];
    const sentences = statuses.map((status) => claimMessage(status));
    for (const sentence of sentences) expect(sentence).toMatch(/[.]$/);
    // signed_out and a failed call share the "try again" sentence; the rest differ.
    expect(new Set(sentences).size).toBe(statuses.length - 1);
  });

  it('interrupts a new account only for the two answers that matter', () => {
    expect(arrivalToast('ok')?.type).toBe('success');
    expect(arrivalToast('full')?.type).toBe('error');
    for (const quiet of ['unknown', 'own', 'already', 'too_late', 'already_pro', 'signed_out', null] as const) {
      expect(arrivalToast(quiet)).toBeNull();
    }
  });

  it('never uses a long dash', () => {
    const all = JSON.stringify(REFERRAL_TEXT) + claimMessage('ok') + claimMessage('full');
    expect(all).not.toMatch(/[–—]/);
  });
});

describe('what must agree with the server', () => {
  it('3 friends and 7 days, in the copy and in both server functions', () => {
    expect(REFERRAL_MAX_FRIENDS).toBe(3);
    expect(REFERRAL_DAYS).toBe(7);
    expect(MIGRATION.match(/v_max\s+constant integer := (\d+);/g)).toEqual([
      `v_max     constant integer := ${REFERRAL_MAX_FRIENDS};`,
      `v_max      constant integer := ${REFERRAL_MAX_FRIENDS};`,
    ]);
    expect(MIGRATION.match(/v_days\s+constant integer := (\d+);/g)).toEqual([
      `v_days    constant integer := ${REFERRAL_DAYS};`,
      `v_days     constant integer := ${REFERRAL_DAYS};`,
    ]);
    expect(REFERRAL_TEXT.steps[0]).toContain(`up to ${REFERRAL_MAX_FRIENDS} friends`);
    expect(REFERRAL_TEXT.steps[1]).toContain(`within ${REFERRAL_DAYS} days`);
  });

  it('the code pattern is the server one', () => {
    expect(MIGRATION).toContain("check (code ~ '^[A-HJ-NP-Z2-9]{8}$')");
    expect(MIGRATION).toContain("v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';");
    for (const letter of 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
      expect(readReferralCode(letter.repeat(8))).toBe(letter.repeat(8));
    }
  });

  it('every answer the server can give is one the dashboard reads', () => {
    const answers = [...MIGRATION.matchAll(/return '([a-z_]+)';/g)].map((m) => m[1]);
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) expect(readReferralClaim(answer)).toBe(answer);
  });
});

describe('the switch', () => {
  // Turning Refer a friend on is a deliberate step (docs/pro-features/README.md):
  // the manual page ships with it, and stays out while it is off.
  it('the manual has the page only while the feature is on', () => {
    expect(existsSync(resolve(REPO, 'user-docs', 'settings', 'refer-a-friend.mdx'))).toBe(REFERRALS_OPEN);
  });

  it('while it is off, no invite code is remembered or read', () => {
    if (REFERRALS_OPEN) return;
    rememberReferralCode('?ref=ABCD2345');
    expect(pendingReferralCode()).toBeNull();
  });
});
