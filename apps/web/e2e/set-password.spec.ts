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
  return JSON.parse(line.slice('RESULT:'.length)) as { userId: string; workspaceId: string };
}

async function emailLinkFor(email: string, subject?: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`);
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT}/search?query=${query}`);
        const body = (await res.json()) as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
        // The search is fuzzy, so keep only messages sent to exactly this recipient.
        id = body.messages.find(
          (m) => m.To.some((t) => t.Address.toLowerCase() === email) && (!subject || m.Subject.includes(subject)),
        )?.ID;
        return id;
      },
      { timeout: 20_000 },
    )
    .toBeTruthy();
  const msg = (await (await fetch(`${MAILPIT}/message/${id}`)).json()) as { HTML: string };
  const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML)?.[1];
  if (!href) throw new Error('Email has no /auth/confirm link');
  return href.replaceAll('&amp;', '&');
}

test('provisioned coach opens the invite link, sets a password, then signs in with it', async ({ page }) => {
  const email = `new-coach-${randomUUID()}@example.test`;
  const { userId, workspaceId } = provision(email);
  try {
    const link = await emailLinkFor(email);
    await page.goto(link);
    // Opening the link must not spend the token: only the button does (email scanners follow links).
    await expect(page).toHaveURL(/\/auth\/confirm\?/);
    await page.getByRole('button', { name: 'Continue' }).click();
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

test('a bad confirm link shows a friendly message on /sign-in', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=nonsense&type=invite&next=/set-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/sign-in\?error=link$/);
  await expect(page.getByText(/expired or was already used/)).toBeVisible();
});

async function freshToken(type: 'magiclink' | 'recovery'): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type, email: 'coach@demo.local' });
  if (error) throw error;
  return data.properties.hashed_token;
}

// A user has one active magic-link/recovery token at a time, so these tests share the demo coach one at a time.
test.describe('/auth/confirm with real tokens', () => {
  test.describe.configure({ mode: 'serial' });

  test('GET /auth/confirm does not spend the token', async ({ page, browser }) => {
    const token = await freshToken('magiclink');
    await page.goto(`/auth/confirm?token_hash=${token}&type=magiclink&next=/clients`);
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    // Still valid for a second visitor.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`http://localhost:3000/auth/confirm?token_hash=${token}&type=magiclink&next=/clients`);
    await otherPage.getByRole('button', { name: 'Continue' }).click();
    await expect(otherPage).toHaveURL(/localhost:3000\/clients$/);
    await other.close();
  });

  // The URL parser strips tab/CR/LF, so these all used to become `//evil.com`.
  const EVIL_NEXT = ['//evil.com', '/%09/evil.com', '/%0A/evil.com', '/%0D/evil.com', '/%09%5Cevil.com', 'https://evil.com'];
  for (const next of EVIL_NEXT) {
    test(`/auth/confirm never redirects off-site (next=${next})`, async ({ page }) => {
      const token = await freshToken('magiclink');
      await page.goto(`/auth/confirm?token_hash=${token}&type=magiclink&next=${next}`);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page).toHaveURL(/^http:\/\/localhost:3000\/clients$/);
    });
  }

  // The page already cleans `next`, but the form can be edited by the visitor (or forged), so the server action
  // must check it again. This submits a tampered hidden field to prove the action-level guard on its own.
  for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
    test(`the confirm action re-checks a tampered hidden next field (${evil})`, async ({ page }) => {
      const token = await freshToken('magiclink');
      await page.goto(`/auth/confirm?token_hash=${token}&type=magiclink&next=/clients`);
      const next = page.locator('input[name="next"]');
      await expect(next).toHaveValue('/clients');
      await next.evaluate((el, value) => ((el as HTMLInputElement).value = value), evil);
      await expect(next).toHaveValue(evil);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page).toHaveURL(/^http:\/\/localhost:3000\/clients$/);
    });
  }

  test('/auth/confirm honours the allowlisted /set-password', async ({ page }) => {
    const token = await freshToken('recovery');
    await page.goto(`/auth/confirm?token_hash=${token}&type=recovery&next=/set-password`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/^http:\/\/localhost:3000\/set-password$/);
  });

  test('a reused confirm link shows the friendly message', async ({ page, browser }) => {
    const token = await freshToken('magiclink');
    const url = `/auth/confirm?token_hash=${token}&type=magiclink&next=/clients`;
    await page.goto(url);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/clients$/);

    const second = await browser.newContext({ baseURL: 'http://localhost:3000' });
    const secondPage = await second.newPage();
    await secondPage.goto(url);
    await secondPage.getByRole('button', { name: 'Continue' }).click();
    await expect(secondPage).toHaveURL(/\/sign-in\?error=link$/);
    await expect(secondPage.getByText(/expired or was already used/)).toBeVisible();
    await second.close();
  });
});

test('forgot password: same message for any email, and the emailed link lets a coach back in', async ({ page }) => {
  const email = `forgot-${randomUUID()}@example.test`;
  const { userId, workspaceId } = provision(email);
  try {
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);

    // Unknown address: identical message, no hint whether an account exists.
    await page.getByLabel('Email').fill(`nobody-${randomUUID()}@example.test`);
    await page.getByRole('button', { name: 'Send link' }).click();
    await expect(page.getByText("If that email has an account, we've sent a link.")).toBeVisible();

    // GoTrue allows one email per address per second, so wait out the invite we just triggered.
    await page.waitForTimeout(1500);
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send link' }).click();
    await expect(page.getByText("If that email has an account, we've sent a link.")).toBeVisible();

    await page.goto(await emailLinkFor(email, 'Reset your CalTracker password'));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/set-password$/);
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page).toHaveURL(/\/clients$/);
  } finally {
    await admin.from('workspaces').delete().eq('id', workspaceId);
    await admin.auth.admin.deleteUser(userId);
  }
});

test('/set-password is protected: signed-out visitors go to /sign-in', async ({ page }) => {
  await page.goto('/set-password');
  await expect(page).toHaveURL(/\/sign-in/);
});
