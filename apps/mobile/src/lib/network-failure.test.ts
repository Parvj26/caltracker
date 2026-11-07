import { describe, expect, it } from 'vitest';
import { isNetworkFailure } from './network-failure';

describe('isNetworkFailure', () => {
  it('recognises the PostgREST shape for a dropped connection', () => {
    expect(isNetworkFailure({ message: 'TypeError: Network request failed', details: '', hint: '', code: '' })).toBe(true);
  });
  it('recognises the storage-js shape for a dropped connection', () => {
    const e = Object.assign(new Error('Network request failed'), { name: 'StorageUnknownError', originalError: new TypeError('Network request failed') });
    expect(isNetworkFailure(e)).toBe(true);
  });
  it('recognises a plain fetch TypeError and a timeout', () => {
    expect(isNetworkFailure(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkFailure(new Error('The request timed out.'))).toBe(true);
  });
  it('does not treat an answer from the server as a dropped connection', () => {
    expect(isNetworkFailure({ message: 'permission denied', code: '42501' })).toBe(false);
    expect(isNetworkFailure({ name: 'StorageApiError', message: 'Payload too large', status: 413, statusCode: '413' })).toBe(false);
    expect(isNetworkFailure({ message: 'new row violates row-level security policy', status: 403 })).toBe(false);
  });
  it('is false for things that are not errors', () => {
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure('Network request failed')).toBe(false);
  });
});
