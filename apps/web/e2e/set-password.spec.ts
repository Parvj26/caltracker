import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

// Local Supabase's mail catcher (Mailpit) HTTP API.
const MAILPIT = 'http://127.0.0.1:54324/api/v1';
const NEW_PASSWORD = 'brand-new-password-1';

// Service role is used in test code only, to clean up the coach afterwards.
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// scripts/ is an ES module package and the web app is CommonJS, so run the script's exported
// provisionCoach through tsx instead of importing it into the Playwright process.
function provision(email: string): { userId: string; workspaceId: string } {
  const code = `
    import { createClient } from '@supabase/supabase-js';
    import { provisionCoach } from './provision-coach.ts';
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const r = await provisionCoach(admin, { email: process.argv[1], fullName: 'Fresh Coach', workspaceName: 'Fresh Gym' });
    console.log('RESULT:' + JSON.stringify(r));
  `;
  const out = execFileSync('pnpm', ['--filter', '@caltracker/scripts', 'exec', 'tsx', '--input-type=module', '-e', code, email], {
    cwd: join(__dirname, '..', '..', '..'),
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_SITE_URL: 'http://localhost:3000' },
  });
  const line = out.split('\n').find((l) => l.startsWith('RESULT:'));
  if (!line) throw new Error(`provisionCoach gave no result:\n${out}`);
  return JSON.parse(line.slice('RESULT:'.length));
}

async function inviteLinkFor(email: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`);
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT}/search?query=${query}`);
        const body = (await res.json()) as { messages: { ID: string; To: { Address: string }[] }[] };
        // The search is fuzzy, so keep only messages sent to exactly this recipient.
        id = body.messages.find((m) => m.To.some((t) => t.Address.toLowerCase() === email))?.ID;
        return id;
      },
      { timeout: 20_000 },
    )
    .toBeTruthy();
  const msg = (await (await fetch(`${MAILPIT}/message/${id}`)).json()) as { HTML: string };
  const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML)?.[1];
  if (!href) throw new Error('Invite email has no /auth/confirm link');
  return href.replaceAll('&amp;', '&');
}

test('provisioned coach opens the invite link, sets a password, then signs in with it', async ({ page }) => {
  const email = `new-coach-${randomUUID()}@example.test`;
  const { userId, workspaceId } = provision(email);
  try {
    const link = await inviteLinkFor(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/set-password$/);

    await page.getByLabel('New password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('short');
    await page.getByRole('button', { name: 'Set password' }).click();
    // Browser minlength validation blocks the submit; the page stays put.
    await expect(page).toHaveURL(/\/set-password$/);

    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill('does-not-match-1');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();

    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByText('Fresh Gym')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/clients$/);
  } finally {
    await admin.from('workspaces').delete().eq('id', workspaceId);
    await admin.auth.admin.deleteUser(userId);
  }
});

test('a bad or reused confirm link shows a friendly message on /sign-in', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=nonsense&type=invite&next=/set-password');
  await expect(page).toHaveURL(/\/sign-in\?error=link$/);
  await expect(page.getByText(/expired or was already used/)).toBeVisible();
});

test('/auth/confirm never redirects off-site', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=nonsense&type=invite&next=//evil.example');
  await expect(page).toHaveURL(/localhost:3000\/sign-in\?error=link$/);
});

test('/set-password is protected: signed-out visitors go to /sign-in', async ({ page }) => {
  await page.goto('/set-password');
  await expect(page).toHaveURL(/\/sign-in/);
});
