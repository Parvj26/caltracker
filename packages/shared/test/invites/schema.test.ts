import { describe, expect, it } from 'vitest';
import {
  INVITE_RESULT_STATUSES,
  InviteInput,
  SendInvitesRequest,
  SendInvitesResponse,
} from '../../src/invites/schema';

const workspaceId = '123e4567-e89b-42d3-a456-426614174000';

describe('InviteInput', () => {
  it('trims and lowercases the email and trims the names', () => {
    const parsed = InviteInput.parse({ email: ' Sam@Gmail.com ', firstName: ' Sam ', lastName: ' Lee ' });
    expect(parsed).toEqual({ email: 'sam@gmail.com', firstName: 'Sam', lastName: 'Lee' });
  });

  it('requires a first name', () => {
    expect(InviteInput.safeParse({ email: 'a@b.com', firstName: '  ', lastName: 'Lee' }).success).toBe(false);
    expect(InviteInput.safeParse({ email: 'a@b.com', lastName: 'Lee' }).success).toBe(false);
  });

  it('allows an empty or missing last name', () => {
    expect(InviteInput.parse({ email: 'a@b.com', firstName: 'Cher', lastName: '  ' })).toEqual({
      email: 'a@b.com',
      firstName: 'Cher',
      lastName: '',
    });
    expect(InviteInput.parse({ email: 'a@b.com', firstName: 'Cher' }).lastName).toBe('');
  });

  it('limits each name to 100 characters', () => {
    const long = 'x'.repeat(101);
    expect(InviteInput.safeParse({ email: 'a@b.com', firstName: 'x'.repeat(100), lastName: 'x'.repeat(100) }).success).toBe(true);
    expect(InviteInput.safeParse({ email: 'a@b.com', firstName: long }).success).toBe(false);
    expect(InviteInput.safeParse({ email: 'a@b.com', firstName: 'A', lastName: long }).success).toBe(false);
  });

  it('reports which field is wrong', () => {
    const r = InviteInput.safeParse({ email: 'a@b.com', firstName: 'A', lastName: 'x'.repeat(101) });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['lastName']);
  });
});

describe('SendInvitesRequest', () => {
  const invite = { email: 'a@b.com', firstName: 'A', lastName: 'B' };

  it('accepts 50 invites', () => {
    const invites = Array.from({ length: 50 }, () => invite);
    expect(SendInvitesRequest.safeParse({ workspaceId, invites }).success).toBe(true);
  });

  it('rejects 51 invites', () => {
    const invites = Array.from({ length: 51 }, () => invite);
    expect(SendInvitesRequest.safeParse({ workspaceId, invites }).success).toBe(false);
  });

  it('rejects an empty invite list', () => {
    expect(SendInvitesRequest.safeParse({ workspaceId, invites: [] }).success).toBe(false);
  });

  it('rejects a non-uuid workspace', () => {
    const result = SendInvitesRequest.safeParse({ workspaceId: 'nope', invites: [invite] });
    expect(result.success).toBe(false);
  });
});

describe('SendInvitesResponse', () => {
  it('accepts every known status and rejects unknown ones', () => {
    for (const status of INVITE_RESULT_STATUSES) {
      expect(SendInvitesResponse.safeParse({ results: [{ email: 'a@b.com', status }] }).success).toBe(true);
    }
    expect(
      SendInvitesResponse.safeParse({ results: [{ email: 'a@b.com', status: 'bogus' }] }).success,
    ).toBe(false);
  });
});
