import { describe, expect, it } from 'vitest';
import { alertCode } from './alert-code';

describe('alertCode', () => {
  it('reports a known data-error-code', () => {
    expect(alertCode('invite_email_invalid')).toBe('invite_email_invalid');
  });
  it('reports missing_code for an alert without a known code (no more "alert")', () => {
    expect(alertCode(null)).toBe('missing_code');
    expect(alertCode('alert')).toBe('missing_code');
    expect(alertCode('Luis is not a client')).toBe('missing_code');
  });
});
