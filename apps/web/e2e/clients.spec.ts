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

  // A resend right after sending changes nothing: the link already in the inbox keeps working.
  await row.getByRole('button', { name: 'Resend' }).click();
  await expect(row.getByText(/Already sent a moment ago/)).toBeVisible();
});

test('a 45-row CSV is sent in chunks and every row is reported', async ({ page }) => {
  const run = unique();
  const lines = ['Name,Email', ...Array.from({ length: 45 }, (_, i) => `Bulk ${i},bulk${i}-${run}@example.com`)];
  await page.getByLabel('Upload CSV').setInputFiles({
    name: 'bulk.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(lines.join('\n')),
  });
  await page.getByRole('button', { name: 'Send 45 invites' }).click();
  await expect(page.getByRole('table', { name: 'CSV preview' }).getByText('Invite sent')).toHaveCount(45, { timeout: 60_000 });
});

test('while a CSV is sending, a new file cannot be picked and the send cannot be restarted', async ({ page }) => {
  const run = unique();
  // Hold the send (a server action POST to this page) until the checks below have run.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/clients', async (route) => {
    if (route.request().method() === 'POST') await held;
    await route.continue();
  });
  const fileInput = page.getByLabel('Upload CSV');
  await fileInput.setInputFiles({
    name: 'busy.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Name,Email\nBusy One,busy1-${run}@example.com\nBusy Two,busy2-${run}@example.com`),
  });
  await page.getByRole('button', { name: 'Send 2 invites' }).click();
  await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await expect(fileInput).toBeDisabled();

  release();
  await expect(page.getByRole('table', { name: 'CSV preview' }).getByText('Invite sent')).toHaveCount(2);
  await expect(fileInput).toBeEnabled();
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
  await expect(preview.getByText('Invite sent')).toHaveCount(3);

  const pendingTable = page.getByRole('table', { name: 'Pending invites' });
  for (const who of ['alice', 'bob', 'cara']) {
    // Exactly one pending row each, so the duplicate line produced no second copy.
    await expect(pendingTable.getByRole('row').filter({ hasText: `${who}-${run}@example.com` })).toHaveCount(1);
  }
  await expect(pendingTable.getByText('not-an-email')).toHaveCount(0);
});

test('the demo client is listed under Clients', async ({ page }) => {
  const clients = page.getByRole('table', { name: 'Clients' });
  await expect(clients.getByRole('row').filter({ hasText: 'Demo Client' })).toBeVisible();
  await expect(page.getByText('No clients yet')).toHaveCount(0);
});
