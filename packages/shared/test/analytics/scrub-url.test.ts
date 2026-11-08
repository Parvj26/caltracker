import { describe, expect, it } from 'vitest';
import { scrubUrl } from '../../src/analytics/scrub-url';

describe('scrubUrl', () => {
  it('hides invite tokens and drops query and hash', () => {
    expect(scrubUrl('https://staging.caltracker.app/invite/abc123?x=1#access_token=t')).toBe('https://staging.caltracker.app/invite/[token]');
  });
  it('drops auth codes from query', () => {
    expect(scrubUrl('/set-password?code=abc')).toBe('/set-password');
  });
  it('handles the app scheme', () => {
    expect(scrubUrl('caltracker://invite/tok')).toBe('caltracker://invite/[token]');
    expect(scrubUrl('invite/tok')).toBe('invite/[token]');
  });
  it('leaves other paths alone', () => {
    expect(scrubUrl('/clients/5f0c2c1e-1111-4222-8333-444455556666#x')).toBe('/clients/5f0c2c1e-1111-4222-8333-444455556666');
  });
});
