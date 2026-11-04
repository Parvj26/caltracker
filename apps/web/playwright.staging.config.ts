import { defineConfig, devices } from '@playwright/test';

// Smoke tests against the deployed staging site. Separate from playwright.config.ts so `pnpm test:e2e`
// never touches the network. Run with `pnpm --filter web test:e2e:staging`.
export default defineConfig({
  testDir: './e2e-staging',
  fullyParallel: false,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.STAGING_URL ?? 'https://staging.caltracker.app',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
