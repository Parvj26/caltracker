import { describe, expect, it } from 'vitest';
import { adminErrorMessage, GENERIC_ERROR } from './actions-shared';

describe('adminErrorMessage', () => {
  it("turns the database's admin errors into sentences", () => {
    expect(adminErrorMessage({ code: 'P0002', message: 'admin: no account with that email' })).toBe('No account with that email.');
    expect(adminErrorMessage({ code: 'P0001', message: 'admin: test notification already sent, wait a minute' })).toBe(
      'Test notification already sent, wait a minute.',
    );
    expect(adminErrorMessage({ code: 'P0001', message: 'admin: at least one owner is required' })).toBe('At least one owner is required.');
  });
  it('hides anything else', () => {
    expect(adminErrorMessage({ code: '42501', message: 'admin: not authorised' })).toBe("You don't have permission to do that.");
    expect(adminErrorMessage({ code: 'XX000', message: 'relation does not exist' })).toBe(GENERIC_ERROR);
    expect(adminErrorMessage(null)).toBe(GENERIC_ERROR);
  });
});
