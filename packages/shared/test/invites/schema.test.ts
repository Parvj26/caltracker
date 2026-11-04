import { describe, expect, it } from 'vitest';
import {
  INVITE_RESULT_STATUSES,
  InviteInput,
  SendInvitesRequest,
  SendInvitesResponse,
} from '../../src/invites/schema';

const workspaceId = '123e4567-e89b-42d3-a456-426614174000';

describe('InviteInput', () => {
  it('trims and lowercases the email', () => {
    const parsed = InviteInput.parse({ email: ' Sam@Gmail.com ', fullName: ' Sam Lee ' });
    expect(parsed).toEqual({ email: 'sam@gmail.com', fullName: 'Sam Lee' });
  });

  it('rejects an empty name', () => {
    expect(InviteInput.safeParse({ email: 'a@b.com', fullName: '  ' }).success).toBe(false);
  });
});

describe('SendInvitesRequest', () => {
  const invite = { email: 'a@b.com', fullName: 'A' };

  it('accepts 200 invites', () => {
    const invites = Array.from({ length: 200 }, () => invite);
    expect(SendInvitesRequest.safeParse({ workspaceId, invites }).success).toBe(true);
  });

  it('rejects 201 invites', () => {
    const invites = Array.from({ length: 201 }, () => invite);
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
