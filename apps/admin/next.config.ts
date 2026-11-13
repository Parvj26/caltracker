import type { NextConfig } from 'next';

// Browser security headers on every response: the same list as apps/web/next.config.ts (see the notes there).
// frame-ancestors / X-Frame-Options matter most here: no other site may frame the admin pages.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@caltracker/shared'],
  poweredByHeader: false,
  headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
