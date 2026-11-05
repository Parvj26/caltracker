import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  // Two workers, as on the GitHub runner. More than that exhausts the local auth container's outgoing ports (each auth
  // request opens a new database connection, which then sits in TIME_WAIT), and sign-ins fail with "Database error".
  workers: 2,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: isCI ? 'pnpm exec next build && pnpm exec next start -p 3000' : 'pnpm exec next dev -p 3000',
      url: 'http://localhost:3000/sign-in',
      reuseExistingServer: !isCI,
      timeout: 180_000,
    },
    {
      // send-invite Edge Function (needs local Supabase running and supabase/functions/.env).
      command: 'pnpm --dir ../.. functions:serve',
      // The API gateway answers 401 even before the runtime is up, so wait for the serve banner instead.
      wait: { stdout: /Serving functions on/ },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
