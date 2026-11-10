import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
// Admin site port: 3100 locally (the coach website uses 3000). E2E_ADMIN_PORT overrides it.
const port = process.env.E2E_ADMIN_PORT ?? '3100';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  // Every test makes its own admin accounts, so tests never share a session. Two workers locally (see apps/web).
  workers: Number(process.env.E2E_WORKERS ?? 2),
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['blob']] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /last-owner\.spec\.ts/ },
    // Needs exactly one owner in the database, which the parallel tests above never leave: runs after them, alone.
    { name: 'last-owner', use: { ...devices['Desktop Chrome'] }, testMatch: /last-owner\.spec\.ts/, dependencies: ['chromium'] },
  ],
  webServer: [
    {
      // CI builds the app in its own step first, so here it only starts it.
      command: isCI ? `pnpm exec next start -p ${port}` : `pnpm exec next dev -p ${port}`,
      url: `${baseURL}/sign-in`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
    },
    {
      // send-invite Edge Function: Resend invite, Move and Restore (needs local Supabase and supabase/functions/.env).
      command: 'pnpm --dir ../.. functions:serve',
      wait: { stdout: /Serving functions on/ },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
