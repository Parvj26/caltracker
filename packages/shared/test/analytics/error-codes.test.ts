import { describe, expect, it } from 'vitest';
import { BAD_TODAY_ERROR } from '../../src/programs/date-rules';
import { ERROR_CODES, LABEL_PATTERN, codeForMessage, errorMessage, isErrorCode } from '../../src/analytics/error-codes';
import { sanitize } from '../../src/analytics/sanitize';

describe('error codes', () => {
  it('every code is lowercase snake_case', () => {
    for (const code of Object.keys(ERROR_CODES)) expect(code).toMatch(/^[a-z]+(_[a-z0-9]+)*$/);
  });
  it('every code has a non-empty message', () => {
    for (const message of Object.values(ERROR_CODES)) expect(message.length).toBeGreaterThan(0);
  });
  it('missing_code shows the server_error message', () => {
    expect(errorMessage('missing_code')).toBe(errorMessage('server_error'));
  });
  it('isErrorCode accepts only catalogue codes', () => {
    expect(isErrorCode('invite_email_invalid')).toBe(true);
    expect(isErrorCode('alert')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
  it('label pattern needs area and action', () => {
    expect(LABEL_PATTERN.test('assign_save')).toBe(true);
    expect(LABEL_PATTERN.test('save')).toBe(false);
    expect(LABEL_PATTERN.test('Save button')).toBe(false);
    expect(LABEL_PATTERN.test('client_[id]')).toBe(false);
  });
});

describe('sanitize error codes', () => {
  it('replaces an unknown code with missing_code', () => {
    expect(sanitize('error_shown', { code: 'nope' }).code).toBe('missing_code');
    expect(sanitize('error_shown', { code: 'alert' }).code).toBe('missing_code');
    expect(sanitize('error_shown', { code: 5 }).code).toBe('missing_code');
  });
  it('passes known codes through', () => {
    expect(sanitize('error_shown', { code: 'invite_email_invalid', screen: '/clients' })).toEqual({ code: 'invite_email_invalid', screen: '/clients' });
  });
});

describe('codeForMessage', () => {
  it('finds the code of a fixed shared message', () => {
    expect(codeForMessage(BAD_TODAY_ERROR, 'field_format')).toBe('date_bad_today');
  });
  it('falls back for unknown or empty text', () => {
    expect(codeForMessage('Luis typed this', 'field_format')).toBe('field_format');
    expect(codeForMessage(null, 'server_error')).toBe('server_error');
  });
  it('never answers missing_code for the shared server message', () => {
    expect(codeForMessage(errorMessage('server_error'), 'field_format')).toBe('server_error');
  });
});
