import { z } from 'zod';
import { FirstName, LastName } from './schema';

/** Raw invite tokens are base64url (send-invite makes 43 characters); anything else cannot match. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

/** Same minimum as Supabase Auth's `minimum_password_length`. */
export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt ignores everything after 72 bytes, so longer passwords are refused rather than silently cut. */
export const PASSWORD_MAX_LENGTH = 72;

/** Body of the accept-invite Edge Function: join a coach from the invite link with only a password. */
export const AcceptInviteRequest = z.object({
  token: z.string().regex(INVITE_TOKEN_PATTERN),
  // Not trimmed: a password is used exactly as typed.
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  firstName: FirstName,
  lastName: LastName.default(''),
});
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequest>;

export const ACCEPT_INVITE_REASONS = [
  /** The invite link is unknown, cancelled or replaced by a resend. */
  'not_found',
  'expired',
  'used',
  /** A confirmed account already has this email: sign in instead (signing in links the coach). */
  'account_exists',
  /** The invited email belongs to a coach. */
  'coach_account',
  /** The account already trains with a different coach. */
  'other_coach',
  /** The body failed validation (the app validates first, so this means an outdated or tampered client). */
  'invalid_request',
] as const;
export type AcceptInviteReason = (typeof ACCEPT_INVITE_REASONS)[number];

export const AcceptInviteResponse = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), email: z.string() }),
  z.object({ ok: z.literal(false), reason: z.enum(ACCEPT_INVITE_REASONS) }),
]);
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponse>;
