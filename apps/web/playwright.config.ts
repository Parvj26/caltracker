import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
// Web app port. 3000 locally; the self-hosted CI runner sets E2E_WEB_PORT so it never clashes with a developer's server.
const port = process.env.E2E_WEB_PORT ?? '3000';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  // Locally: two workers. More than that exhausts the local auth container's outgoing ports on a Mac (each auth request
  // opens a new database connection, which then sits in TIME_WAIT), and sign-ins fail with "Database error". CI runs
  // on GitHub-hosted Linux, shards the suite over 4 jobs (each with its own Supabase) and signs in once per run, so it
  // can use E2E_WORKERS (set in .github/workflows/ci.yml).
  workers: Number(process.env.E2E_WORKERS ?? 2),
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // CI writes a blob report per shard; the e2e-report job merges them into one HTML report.
  reporter: isCI ? [['list'], ['blob']] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    // Signs the demo coach in once and saves the session for signInAsCoach() (e2e/helpers.ts).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
  webServer: [
    {
      // CI builds the app in its own step first (cached), so here it only starts it.
      command: isCI ? `pnpm exec next start -p ${port}` : `pnpm exec next dev -p ${port}`,
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
