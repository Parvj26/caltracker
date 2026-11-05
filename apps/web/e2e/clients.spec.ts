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
  await page.getByLabel('First name').fill('New');
  await page.getByLabel('Last name').fill('Client');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText('Invite sent')).toBeVisible();
  await expect(page.getByText('Invite sent')).toHaveCSS('border-radius', '999px'); // result chips stay pills

  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toBeVisible();
  await expect(row.getByText('New Client')).toBeVisible();
  await expect(row.getByText('Expires in 14 days')).toBeVisible();
  await expect(row.getByText('Expires in 14 days')).toHaveCSS('border-radius', '999px'); // a grey status chip

  // A resend right after sending changes nothing: the link already in the inbox keeps working.
  await row.getByRole('button', { name: 'Resend' }).click();
  await expect(row.getByText(/Already sent a moment ago/)).toBeVisible();
});

test('pending invites are listed newest first, not by last name', async ({ page }) => {
  const run = unique();
  const add = async (firstName: string, lastName: string, email: string) => {
    await page.getByLabel('First name').fill(firstName);
    await page.getByLabel('Last name').fill(lastName);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByRole('table', { name: 'Pending invites' }).getByRole('row').filter({ hasText: email })).toBeVisible();
  };
  // Added first, and first by last name: newest-first must still put it below the later one.
  const older = `older-${run}@example.com`;
  const newer = `newer-${run}@example.com`;
  await add('Ada', 'Aardvark', older);
  await add('Zoe', 'Zulu', newer);
  await page.reload();
  const rows = await page.getByRole('table', { name: 'Pending invites' }).getByRole('row').allTextContents();
  const at = (email: string) => rows.findIndex((text) => text.includes(email));
  expect(at(newer)).toBeGreaterThan(-1);
  expect(at(newer)).toBeLessThan(at(older));
});

test('a 45-row CSV is sent in chunks and every row is reported', async ({ page }) => {
  const run = unique();
  // Older single Name column: still accepted and split on the first space.
  const lines = ['Name,Email', ...Array.from({ length: 45 }, (_, i) => `Bulk ${i},bulk${i}-${run}@example.com`)];
  await page.getByLabel('Invite many clients from a spreadsheet (CSV)').setInputFiles({
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
  const fileInput = page.getByLabel('Invite many clients from a spreadsheet (CSV)');
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

test('empty first name shows an inline error and sends nothing', async ({ page }) => {
  const email = `noname-${unique()}@example.com`;
  await page.getByLabel('Last name').fill('Only');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter a first name' })).toBeVisible();
  await expect(page.getByLabel('First name')).toHaveAttribute('aria-invalid', 'true');
  // Focused while invalid: the magenta border stays, and an ink outline still shows where focus is.
  await page.getByLabel('First name').focus();
  await expect(page.getByLabel('First name')).toHaveCSS('outline-style', 'solid');
  await expect(page.getByLabel('First name')).not.toHaveCSS('outline-width', '0px');
  await expect(page.getByText(email)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(email)).toHaveCount(0);
});

test('CSV upload previews valid rows and line errors, then sends the valid ones', async ({ page }) => {
  const run = unique();
  const csv = readFileSync(join(__dirname, 'fixtures', 'clients.csv'), 'utf8').replaceAll('{{RUN}}', run);
  await page.getByLabel('Invite many clients from a spreadsheet (CSV)').setInputFiles({
    name: 'clients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });

  const preview = page.getByRole('table', { name: 'CSV preview' });
  await expect(preview.getByRole('row')).toHaveCount(4); // header + 3 rows
  // Separate First Name / Last Name columns, as in an Everfit export.
  await expect(preview.getByRole('row').filter({ hasText: `alice-${run}@example.com` }).getByRole('cell')).toHaveText([
    'Alice',
    'Example',
    `alice-${run}@example.com`,
    '',
  ]);
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
