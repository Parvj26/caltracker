import type { NextConfig } from 'next';

// Browser security headers on every response. frame-ancestors / X-Frame-Options stop other sites from loading
// the app inside a hidden frame (clickjacking). This CSP holds only frame-ancestors, so it limits no scripts,
// styles or images; a full script policy needs its own testing first. HSTS has no includeSubDomains, so it covers
// this host alone. The admin app (apps/admin/next.config.ts) sends the same list.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@caltracker/shared'],
  // The profile photo (a WebP of at most 1600 px plus its thumbnail) is posted to a server action; the default
  // limit is 1 MB, which a detailed photo can pass.
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  // Development only: Next's dev badge defaults to bottom-left, where the phone menu button sits.
  devIndicators: { position: 'bottom-right' },
  // Don't announce the framework in an x-powered-by header.
  poweredByHeader: false,
  headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
