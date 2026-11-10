import { expect, test } from '@playwright/test';
import { createUser, signInAdmin, signInWithPassword, totpCode } from './helpers';

test('non-admin sees Not authorised', async ({ page }) => {
  const user = await createUser();
  await signInWithPassword(page, user);
  await expect(page).toHaveURL(/\/not-authorised$/);
  await expect(page.getByRole('heading', { name: 'Not authorised' })).toBeVisible();
  // Signed out: the admin pages send them back to sign in.
  await page.goto('/overview');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('password only lands on /mfa', async ({ page }) => {
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInWithPassword(page, owner);
  await expect(page).toHaveURL(/\/mfa$/);
  await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
  // Skipping the code gets nothing: every admin page sends them back to /mfa.
  for (const path of ['/overview', '/coaches', '/clients', '/logs', '/audit', '/admins']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/mfa$/);
  }
});

test('first sign-in enrolls two-step then reaches Overview', async ({ page }) => {
  const owner = await createUser({ role: 'owner', firstName: 'Parv' });
  await signInWithPassword(page, owner);
  await expect(page).toHaveURL(/\/mfa$/);
  await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent())?.replace(/\s+/g, '') ?? '';
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  await page.getByLabel('6-digit code').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Signed in as Parv · 2-step on')).toBeVisible();
});

test('wrong two-step code is refused', async ({ page }) => {
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInWithPassword(page, owner);
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByLabel('6-digit code').fill(totpCode(owner.secret!) === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "That code didn't work" })).toBeVisible();
  await expect(page).toHaveURL(/\/mfa$/);
});

test('readonly has no Admins menu', async ({ page }) => {
  const readonly = await createUser({ role: 'readonly', enrolled: true });
  await signInAdmin(page, readonly);
  const nav = page.getByRole('navigation', { name: 'Admin' });
  await expect(nav.getByText('ADMIN · READONLY')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Admins' })).toHaveCount(0);
  // And the page itself is refused.
  await page.goto('/admins');
  await expect(page).toHaveURL(/\/not-authorised$/);
});

test('owner sees the Admins menu and the STAGING tag', async ({ page }) => {
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInAdmin(page, owner);
  const nav = page.getByRole('navigation', { name: 'Admin' });
  await expect(nav.getByText('ADMIN · OWNER')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Admins' })).toBeVisible();
  // Local runs are not production.
  await expect(page.getByText('STAGING', { exact: true })).toBeVisible();
});
