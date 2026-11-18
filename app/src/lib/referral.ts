/**
 * Refer a friend: a private link, up to 3 friends, a free month of Pro each.
 *
 * The rule (Valentina, 2026-11-18): a friend who opens an account through the
 * link and subscribes to Pro within 7 days of opening it earns one free month
 * for themself and one for the person who invited them.
 *
 * The server holds the rule (migration `20261118130000_referrals.sql`): who
 * may join under a code, the 3 places, the 7 days, and the free months, which
 * a trigger gives when the friend's plan turns Pro. This file holds the
 * switch, the words, and how the dashboard reads the server's answers.
 *
 * SWITCHED OFF. Nobody can subscribe until payments are connected, so the
 * sidebar row shows locked, no link is remembered and no call leaves the
 * dashboard. Turning it on: docs/pro-features/README.md.
 */

// Typed `boolean`, not left to infer `false`, so every call site reads as a
// live condition instead of dead code.
export const REFERRALS_OPEN: boolean = false;

/** What the locked sidebar row says on hover and to screen readers. */
export const REFERRAL_SOON_LABEL = 'Available soon';

/** Pinned to the migration by `__tests__/referral.test.ts`. */
export const REFERRAL_MAX_FRIENDS = 3;
export const REFERRAL_DAYS = 7;

export const REFERRAL_TEXT = {
  row: 'Refer a friend',
  title: 'Refer a friend',
  lead: 'Give a month of Pro, and get 1 month for each friend who subscribes.',
  cardLine: 'Full access for 1 month',
  stepsTitle: 'How it works',
  steps: [
    `Share your unique private link with up to ${REFERRAL_MAX_FRIENDS} friends.`,
    `Your friend opens an account and subscribes to Pro within ${REFERRAL_DAYS} days.`,
    'You both get a free month of Pro.',
  ],
  linkLabel: 'Your invite link',
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Could not copy. Select the link and copy it by hand.',
  friendsEmpty: 'Nobody has joined with your link yet.',
  placesFull: `All ${REFERRAL_MAX_FRIENDS} places are taken.`,
  codeToggle: 'Did a friend invite you?',
  codeLabel: "Your friend's link or code",
  codeApply: 'Add',
  footnote: `Your friend must subscribe within ${REFERRAL_DAYS} days of opening their account. Free months are added to your Pro time by themselves.`,
  loadFailed: 'Could not load your invite link.',
  retry: 'Try again',
  signupBanner: `A friend invited you. Open your account and subscribe to Pro within ${REFERRAL_DAYS} days, and you both get a free month.`,
} as const;

/** Where a friend opens their account. Always the public dashboard. */
const SIGNUP_URL = 'https://app.fibonax.com/signup';

/** 8 characters that cannot be misread: no 0, O, 1 or I. */
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export type ReferralFriendState = 'waiting' | 'rewarded' | 'expired';

export interface ReferralFriend {
  /** The friend's address, masked by the server: `v***@example.com`. */
  label: string;
  /** The last moment the friend can subscribe, ISO 8601. */
  deadline: string;
  state: ReferralFriendState;
}

export interface ReferralSummary {
  code: string;
  /** Places taken: friends rewarded, or still inside their 7 days. */
  placesUsed: number;
  friends: ReferralFriend[];
  /** This person's own place under a friend's link, when they joined through one. */
  invited: { deadline: string; state: ReferralFriendState } | null;
  /** This person may still type a friend's code. */
  canEnterCode: boolean;
}

/** The one-word answers of `referral_claim()`. */
export type ReferralClaimStatus =
  | 'ok'
  | 'unknown'
  | 'own'
  | 'already'
  | 'too_late'
  | 'already_pro'
  | 'full'
  | 'signed_out';

const CLAIM_STATUSES: ReadonlySet<string> = new Set<ReferralClaimStatus>([
  'ok',
  'unknown',
  'own',
  'already',
  'too_late',
  'already_pro',
  'full',
  'signed_out',
]);

/** The link a person shares. */
export function referralLink(code: string): string {
  return `${SIGNUP_URL}?ref=${encodeURIComponent(code)}`;
}

/**
 * The code inside what a person typed or pasted: a whole invite link, or the
 * code alone in any case, with or without spaces and dashes. Null when there
 * is no valid code in it.
 */
export function readReferralCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const fromLink = /[?&]ref=([^&#\s]+)/i.exec(input);
  let raw = fromLink?.[1] ?? input;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // A stray % sign: read the text as it came.
  }
  const code = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

function isState(value: unknown): value is ReferralFriendState {
  return value === 'waiting' || value === 'rewarded' || value === 'expired';
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** The server's answer to `referral_summary()`, or null when it is not usable. */
export function readReferralSummary(body: unknown): ReferralSummary | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;
  const code = typeof row.code === 'string' ? readReferralCode(row.code) : null;
  if (!code || typeof row.places_used !== 'number' || !Array.isArray(row.friends)) return null;

  const friends: ReferralFriend[] = [];
  for (const item of row.friends) {
    if (!item || typeof item !== 'object') return null;
    const friend = item as Record<string, unknown>;
    if (typeof friend.label !== 'string' || !isDate(friend.deadline) || !isState(friend.state)) {
      return null;
    }
    friends.push({ label: friend.label, deadline: friend.deadline, state: friend.state });
  }

  let invited: ReferralSummary['invited'] = null;
  if (row.invited && typeof row.invited === 'object') {
    const own = row.invited as Record<string, unknown>;
    if (!isDate(own.deadline) || !isState(own.state)) return null;
    invited = { deadline: own.deadline, state: own.state };
  }

  return {
    code,
    placesUsed: row.places_used,
    friends,
    invited,
    canEnterCode: row.can_enter_code === true,
  };
}

/** The server's one-word answer to `referral_claim()`, or null when it is not one of them. */
export function readReferralClaim(body: unknown): ReferralClaimStatus | null {
  return typeof body === 'string' && CLAIM_STATUSES.has(body) ? (body as ReferralClaimStatus) : null;
}

const DAY_MS = 86_400_000;

/** Whole days left before a deadline, counting a started day as a day. Never below 0. */
export function daysLeft(deadline: string, now: number = Date.now()): number {
  const left = Date.parse(deadline) - now;
  return Number.isFinite(left) && left > 0 ? Math.ceil(left / DAY_MS) : 0;
}

/** What the friends list says under a friend's address. */
export function friendLine(friend: ReferralFriend, now: number = Date.now()): string {
  if (friend.state === 'rewarded') return 'Subscribed. You both got a free month.';
  if (friend.state === 'expired') return 'Did not subscribe in time.';
  const days = daysLeft(friend.deadline, now);
  if (days <= 1) return 'Last day to subscribe.';
  return `${days} days left to subscribe.`;
}

/** What a person who joined through a friend's link reads about their own place. */
export function invitedLine(
  invited: NonNullable<ReferralSummary['invited']>,
  now: number = Date.now(),
): string {
  if (invited.state === 'rewarded') {
    return 'You joined through a friend, and you both got a free month of Pro.';
  }
  if (invited.state === 'expired') {
    return `You joined through a friend. The ${REFERRAL_DAYS} days to subscribe have passed.`;
  }
  const days = daysLeft(invited.deadline, now);
  const left = days <= 1 ? 'today' : `in the next ${days} days`;
  return `You joined through a friend. Subscribe to Pro ${left} and you both get a free month.`;
}

/** What the window says after a friend's code was typed. */
export function claimMessage(status: ReferralClaimStatus | null): string {
  switch (status) {
    case 'ok':
      return `Done. Subscribe to Pro within ${REFERRAL_DAYS} days of opening your account and you both get a free month.`;
    case 'unknown':
      return 'That code was not found. Check it and try again.';
    case 'own':
      return 'That is your own link. Share it with a friend.';
    case 'already':
      return "You already joined through a friend's link.";
    case 'too_late':
      return `A friend's link works only in the first ${REFERRAL_DAYS} days after opening an account.`;
    case 'already_pro':
      return "This account is already on Pro, so a friend's link can no longer be added.";
    case 'full':
      return `That friend's ${REFERRAL_MAX_FRIENDS} places are already taken.`;
    default:
      return 'Could not check the code. Try again.';
  }
}

/**
 * What the dashboard says, unasked, after it placed a new account under the
 * link it arrived through. Only the two answers worth interrupting for: the
 * rest (an old account, a second link) say nothing.
 */
export function arrivalToast(
  status: ReferralClaimStatus | null,
): { message: string; type: 'success' | 'error' } | null {
  if (status === 'ok') {
    return {
      message: `Your friend's invite is saved. Subscribe to Pro within ${REFERRAL_DAYS} days and you both get a free month.`,
      type: 'success',
    };
  }
  if (status === 'full') return { message: claimMessage('full'), type: 'error' };
  return null;
}

// ── The code a visitor arrived with ────────────────────────────────────────
// Kept in this browser from the moment the link is opened until the account
// exists and the server has answered, so it survives the email step and the
// trip to Google and back.

const PENDING_KEY = 'sb_referral_code';

/** Remember the code in a page address (`?ref=…`). Does nothing while the switch is off. */
export function rememberReferralCode(search: string): void {
  if (!REFERRALS_OPEN) return;
  const code = readReferralCode(search.includes('ref=') ? search : null);
  if (!code) return;
  try {
    localStorage.setItem(PENDING_KEY, code);
  } catch {
    // Storage blocked: the friend can still type the code in the window.
  }
}

/** The code waiting to be placed, or null. */
export function pendingReferralCode(): string | null {
  if (!REFERRALS_OPEN) return null;
  try {
    return readReferralCode(localStorage.getItem(PENDING_KEY));
  } catch {
    return null;
  }
}

export function forgetReferralCode(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to forget.
  }
}
