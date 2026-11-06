import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
// Web app port. 3000 locally; the self-hosted CI runner sets E2E_WEB_PORT so it never clashes with a developer's server.
const port = process.env.E2E_WEB_PORT ?? '3000';
const baseURL = `http://localhost:${port}`;

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
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: isCI ? `pnpm exec next build && pnpm exec next start -p ${port}` : `pnpm exec next dev -p ${port}`,
      url: `${baseURL}/sign-in`,
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
