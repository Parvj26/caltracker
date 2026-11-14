import { expect, test, type Page } from '@playwright/test';
import { signOutFromProfile } from './helpers';

const PASSWORD = 'demo-password-123';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('demo coach signs in and lands on /home with the workspace name', async ({ page }) => {
  await signIn(page, 'coach@demo.local', PASSWORD);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText('Demo Coaching')).toBeVisible();
});

test('wrong password shows a generic error', async ({ page }) => {
  await signIn(page, 'coach@demo.local', 'wrong-password');
  await expect(page.getByText('Wrong email or password.')).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
  // Only the password clears, so the coach can just retype it.
  await expect(page.getByLabel('Email')).toHaveValue('coach@demo.local');
  await expect(page.getByLabel('Password')).toHaveValue('');
});

test('unknown email shows the same error', async ({ page }) => {
  await signIn(page, 'nobody@demo.local', 'wrong-password');
  await expect(page.getByText('Wrong email or password.')).toBeVisible();
});

test('visiting /clients signed out redirects to /sign-in', async ({ page }) => {
  await page.goto('/clients');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('a client account sees the coaches-only message', async ({ page }) => {
  await signIn(page, 'client@demo.local', PASSWORD);
  await expect(page.getByRole('heading', { name: /This dashboard is for coaches/ })).toBeVisible();
});

test('coach can sign out from Profile, after a check', async ({ page }) => {
  await signIn(page, 'coach@demo.local', PASSWORD);
  await expect(page).toHaveURL(/\/home$/);
  await page.goto('/profile');
  // "Stay signed in" changes nothing.
  await page.getByRole('button', { name: 'Sign out' }).click();
  const check = page.getByRole('dialog', { name: 'Sign out?' });
  await expect(check).toBeVisible();
  await check.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(check).toBeHidden();
  await expect(page).toHaveURL(/\/profile$/);
  await signOutFromProfile(page);
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto('/clients');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('sign-out redirects with a relative address, so it never points at the server bind address (0.0.0.0)', async ({ page }) => {
  await signIn(page, 'coach@demo.local', PASSWORD);
  await expect(page).toHaveURL(/\/home$/);
  const res = await page.request.post('/auth/sign-out', { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()['location']).toBe('/sign-in');
});
