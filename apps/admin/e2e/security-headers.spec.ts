import { expect, test } from '@playwright/test';

// Every page sends the browser security headers from next.config.ts: no other site may frame it (clickjacking),
// browsers stay on https, and the framework isn't announced.
test('the sign-in page sends the security headers', async ({ request }) => {
  const res = await request.get('/sign-in');
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers['content-security-policy']).toBe("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['strict-transport-security']).toBe('max-age=31536000');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-powered-by']).toBeUndefined();
});
