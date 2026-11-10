import { describe, expect, it } from 'vitest';
import { AdminCoachRequest, deleteConfirmMatches } from '../../src/admin/coach';

describe('AdminCoachRequest', () => {
  it('accepts a create, trimming and lower-casing the email', () => {
    const r = AdminCoachRequest.parse({
      action: 'create',
      email: ' Sam@SamFit.com ',
      firstName: ' Sam ',
      lastName: 'Rivera',
      workspaceName: ' Sam Fit Coaching ',
    });
    expect(r).toEqual({
      action: 'create',
      email: 'sam@samfit.com',
      firstName: 'Sam',
      lastName: 'Rivera',
      workspaceName: 'Sam Fit Coaching',
    });
  });

  it('allows no last name, but needs a first name, a valid email and a workspace name', () => {
    const base = { action: 'create', email: 'a@b.co', firstName: 'A', workspaceName: 'W' };
    expect(AdminCoachRequest.parse(base)).toMatchObject({ lastName: '' });
    expect(AdminCoachRequest.safeParse({ ...base, firstName: ' ' }).success).toBe(false);
    expect(AdminCoachRequest.safeParse({ ...base, email: 'nope' }).success).toBe(false);
    expect(AdminCoachRequest.safeParse({ ...base, workspaceName: '  ' }).success).toBe(false);
    expect(AdminCoachRequest.safeParse({ ...base, workspaceName: 'x'.repeat(81) }).success).toBe(false);
  });

  it('accepts a delete and keeps the typed name as typed', () => {
    const id = '7b0c3a4e-1f2d-4c5b-8a9e-0d1c2b3a4f5e';
    expect(AdminCoachRequest.parse({ action: 'delete', workspaceId: id, confirmName: ' Luis ' })).toEqual({
      action: 'delete',
      workspaceId: id,
      confirmName: ' Luis ',
    });
    expect(AdminCoachRequest.safeParse({ action: 'delete', workspaceId: 'x', confirmName: 'L' }).success).toBe(false);
    expect(AdminCoachRequest.safeParse({ action: 'remove', workspaceId: id }).success).toBe(false);
  });
});

describe('deleteConfirmMatches', () => {
  it('needs the exact name', () => {
    expect(deleteConfirmMatches('Luis Bueno Coaching', 'Luis Bueno Coaching')).toBe(true);
    expect(deleteConfirmMatches('luis bueno coaching', 'Luis Bueno Coaching')).toBe(false);
    expect(deleteConfirmMatches('Luis Bueno Coaching ', 'Luis Bueno Coaching')).toBe(false);
    expect(deleteConfirmMatches('', '')).toBe(false);
  });
});
