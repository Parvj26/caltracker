import { expect, test, type Page } from '@playwright/test';

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
  await expect(page.getByText('Incorrect email or password')).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test('unknown email shows the same error', async ({ page }) => {
  await signIn(page, 'nobody@demo.local', 'wrong-password');
  await expect(page.getByText('Incorrect email or password')).toBeVisible();
});

test('visiting /clients signed out redirects to /sign-in', async ({ page }) => {
  await page.goto('/clients');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('a client account sees the coaches-only message', async ({ page }) => {
  await signIn(page, 'client@demo.local', PASSWORD);
  await expect(page.getByRole('heading', { name: /This dashboard is for coaches/ })).toBeVisible();
});

test('coach can sign out', async ({ page }) => {
  await signIn(page, 'coach@demo.local', PASSWORD);
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto('/clients');
  await expect(page).toHaveURL(/\/sign-in/);
});
