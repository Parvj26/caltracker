import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('sign-in page loads', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('invite page with a bogus token shows the not-found copy', async ({ page }) => {
  await page.goto(`/invite/${randomBytes(32).toString('base64url')}`);
  await expect(page.getByText("This invite link isn't valid.")).toBeVisible();
});

const email = process.env.STAGING_SMOKE_COACH_EMAIL;
const password = process.env.STAGING_SMOKE_COACH_PASSWORD;

test('proxy refreshes an expired session and rewrites the cookies', async ({ page, context }) => {
  if (!email || !password) {
    console.log('SKIPPED sign-in/session-refresh check: STAGING_SMOKE_COACH_EMAIL / STAGING_SMOKE_COACH_PASSWORD are not set.');
    test.skip();
    return;
  }

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/clients$/);

  // Force a refresh: mark the stored session as expired (expires_at in 2001) while keeping the valid
  // refresh token. Supabase's client treats the session as expired on the next request and calls the
  // refresh endpoint, which makes the proxy write new cookies. This is deterministic and needs no
  // change to staging's JWT expiry. The rewritten value has the same length, so the chunk layout holds.
  const isAuth = (name: string) => /^sb-.+-auth-token(\.\d+)?$/.test(name);
  const before = (await context.cookies()).filter((c) => isAuth(c.name));
  expect(before.length).toBeGreaterThan(0);
  const sorted = [...before].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const joined = sorted.map((c) => c.value).join('');
  expect(joined.startsWith('base64-')).toBe(true);
  const json = Buffer.from(joined.slice('base64-'.length), 'base64url').toString('utf8');
  expect(json).toMatch(/"expires_at":\d{10}/);
  const expired = 'base64-' + Buffer.from(json.replace(/"expires_at":\d{10}/, '"expires_at":1000000000')).toString('base64url');
  expect(expired.length).toBe(joined.length);

  let offset = 0;
  await context.addCookies(
    sorted.map((c) => {
      const value = expired.slice(offset, offset + c.value.length);
      offset += c.value.length;
      return { name: c.name, value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expires: c.expires };
    }),
  );

  await page.reload();
  await expect(page).toHaveURL(/\/clients$/); // still signed in, not bounced to /sign-in

  const after = (await context.cookies()).filter((c) => isAuth(c.name));
  const afterJoined = [...after].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((c) => c.value).join('');
  expect(afterJoined).not.toBe(expired); // cookies were rewritten by the proxy
  const afterJson = Buffer.from(afterJoined.slice('base64-'.length), 'base64url').toString('utf8');
  expect(Number(afterJson.match(/"expires_at":(\d+)/)![1])).toBeGreaterThan(Date.now() / 1000);
});

test('signed-in coach can open the workouts and programs pages', async ({ page }) => {
  if (!email || !password) {
    console.log('SKIPPED workouts/programs check: STAGING_SMOKE_COACH_EMAIL / STAGING_SMOKE_COACH_PASSWORD are not set.');
    test.skip();
    return;
  }

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/clients$/);

  await page.goto('/workouts');
  await expect(page.getByRole('heading', { name: 'Workouts' })).toBeVisible();
  await page.goto('/programs');
  await expect(page.getByRole('heading', { name: 'Programs' })).toBeVisible();
});
