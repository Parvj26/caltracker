import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@caltracker/shared'],
  // The profile photo (a WebP of at most 1600 px plus its thumbnail) is posted to a server action; the default
  // limit is 1 MB, which a detailed photo can pass.
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  // Development only: Next's dev badge defaults to bottom-left, where the phone menu button sits.
  devIndicators: { position: 'bottom-right' },
};

export default nextConfig;
