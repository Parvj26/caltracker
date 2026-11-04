import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function signInAsCoach(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('coach@demo.local');
  await page.getByLabel('Password').fill('demo-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/clients$/);
}

const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test.beforeEach(async ({ page }) => {
  await signInAsCoach(page);
});

test('add a client: shows under Pending invites, expires in 14 days, then resend', async ({ page }) => {
  const email = `new-${unique()}@example.com`;
  await page.getByLabel('Name').fill('New Client');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText('Invite sent')).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toBeVisible();
  await expect(row.getByText('Expires in 14 days')).toBeVisible();

  await row.getByRole('button', { name: 'Resend' }).click();
  await expect(row.getByText('Invite re-sent')).toBeVisible();
});

test('empty name shows an inline error and sends nothing', async ({ page }) => {
  const email = `noname-${unique()}@example.com`;
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter a name' })).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(email)).toHaveCount(0);
});

test('CSV upload previews valid rows and line errors, then sends the valid ones', async ({ page }) => {
  const run = unique();
  const csv = readFileSync(join(__dirname, 'fixtures', 'clients.csv'), 'utf8').replaceAll('{{RUN}}', run);
  await page.getByLabel('Upload CSV').setInputFiles({
    name: 'clients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });

  const preview = page.getByRole('table', { name: 'CSV preview' });
  await expect(preview.getByRole('row')).toHaveCount(4); // header + 3 rows
  await expect(page.getByText('Line 5: Invalid email: not-an-email')).toBeVisible();
  await expect(page.getByText(/Line 6: Duplicate email/)).toBeVisible();

  await page.getByRole('button', { name: 'Send 3 invites' }).click();
  for (const who of ['alice', 'bob', 'cara']) {
    const row = page.getByRole('row').filter({ hasText: `${who}-${run}@example.com` });
    await expect(row.first()).toBeVisible();
  }
  await expect(page.getByRole('table', { name: 'Pending invites' }).getByText(`bob-${run}@example.com`)).toBeVisible();
});

test('the demo client is listed under Clients', async ({ page }) => {
  await expect(page.getByRole('table', { name: 'Clients' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Clients' }).getByRole('row')).not.toHaveCount(1);
});
