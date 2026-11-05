import { describe, expect, it } from 'vitest';
import {
  ACCEPT_INVITE_REASONS,
  AcceptInviteRequest,
  AcceptInviteResponse,
  INVITE_TOKEN_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordBytes,
} from '../../src/invites/accept';

// Same shape as send-invite's tokens: 32 random bytes, base64url, no padding (43 characters).
const token = 'A'.repeat(43);

describe('INVITE_TOKEN_PATTERN', () => {
  it('accepts base64url tokens of a plausible length', () => {
    expect(INVITE_TOKEN_PATTERN.test(token)).toBe(true);
    expect(INVITE_TOKEN_PATTERN.test('abc-_DEF123'.repeat(3))).toBe(true);
  });

  it('rejects short, long or non-base64url tokens', () => {
    expect(INVITE_TOKEN_PATTERN.test('short')).toBe(false);
    expect(INVITE_TOKEN_PATTERN.test('A'.repeat(101))).toBe(false);
    expect(INVITE_TOKEN_PATTERN.test(`${'A'.repeat(42)}=`)).toBe(false);
    expect(INVITE_TOKEN_PATTERN.test(`${'A'.repeat(42)}/`)).toBe(false);
  });
});

describe('AcceptInviteRequest', () => {
  const valid = { token, password: 'password1', firstName: ' Sam ', lastName: ' Lee ' };

  it('trims the names and keeps the password exactly as typed', () => {
    expect(AcceptInviteRequest.parse({ ...valid, password: ' pass word ' })).toEqual({
      token,
      password: ' pass word ',
      firstName: 'Sam',
      lastName: 'Lee',
    });
  });

  it('defaults a missing last name to empty', () => {
    expect(AcceptInviteRequest.parse({ token, password: 'password1', firstName: 'Cher' }).lastName).toBe('');
  });

  it(`requires a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`, () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(72);
    expect(AcceptInviteRequest.safeParse({ ...valid, password: '1234567' }).success).toBe(false);
    expect(AcceptInviteRequest.safeParse({ ...valid, password: '12345678' }).success).toBe(true);
    expect(AcceptInviteRequest.safeParse({ ...valid, password: 'x'.repeat(72) }).success).toBe(true);
    expect(AcceptInviteRequest.safeParse({ ...valid, password: 'x'.repeat(73) }).success).toBe(false);
  });

  it('counts the 72 limit in bytes, so accented and emoji passwords cannot overflow it', () => {
    expect(passwordBytes('é')).toBe(2);
    expect(passwordBytes('💪')).toBe(4);
    expect(AcceptInviteRequest.safeParse({ ...valid, password: 'é'.repeat(36) }).success).toBe(true);
    expect(AcceptInviteRequest.safeParse({ ...valid, password: 'é'.repeat(37) }).success).toBe(false);
  });

  it('requires a first name and caps both names at 100 characters', () => {
    expect(AcceptInviteRequest.safeParse({ ...valid, firstName: '  ' }).success).toBe(false);
    expect(AcceptInviteRequest.safeParse({ ...valid, firstName: 'x'.repeat(101) }).success).toBe(false);
    expect(AcceptInviteRequest.safeParse({ ...valid, lastName: 'x'.repeat(101) }).success).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(AcceptInviteRequest.safeParse({ ...valid, token: 'short' }).success).toBe(false);
  });
});

describe('AcceptInviteResponse', () => {
  it('is either ok with the email or a known reason', () => {
    expect(AcceptInviteResponse.parse({ ok: true, email: 'sam@example.com' })).toEqual({
      ok: true,
      email: 'sam@example.com',
    });
    for (const reason of ACCEPT_INVITE_REASONS) {
      expect(AcceptInviteResponse.parse({ ok: false, reason })).toEqual({ ok: false, reason });
    }
    expect(AcceptInviteResponse.safeParse({ ok: false, reason: 'nope' }).success).toBe(false);
  });

  it('lists every reason the Join screen handles', () => {
    expect([...ACCEPT_INVITE_REASONS].sort()).toEqual(
      ['account_exists', 'coach_account', 'expired', 'invalid_request', 'not_found', 'other_coach', 'used', 'weak_password'].sort(),
    );
  });
});
