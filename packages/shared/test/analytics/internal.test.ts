import { describe, expect, it } from 'vitest';
import { isInternalEmail } from '../../src/analytics/internal';

describe('isInternalEmail', () => {
  it('matches the PO addresses with or without a plus tag', () => {
    expect(isInternalEmail('ParvJain2503+smoke@gmail.com')).toBe(true);
    expect(isInternalEmail('parvjain2503@gmail.com')).toBe(true);
  });
  it('does not match real users or empty values', () => {
    expect(isInternalEmail('lggbueno23@gmail.com')).toBe(false);
    expect(isInternalEmail(null)).toBe(false);
    expect(isInternalEmail(undefined)).toBe(false);
  });
});
