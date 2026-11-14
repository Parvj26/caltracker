import { expect, test, type Page } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';

// Body scans on the client page, and the coach home's Needs attention "Scan due" rows. Every test seeds its own uniquely
// named client in the demo workspace and only looks at its own rows, so tests can run side by side.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { users: string[]; files: string[]; measures: string[] } = { users: [], files: [], measures: [] };
let workspaceId: string;

test.beforeAll(async () => {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
});

test.afterAll(async () => {
  if (created.files.length) await admin.storage.from('scan-attachments').remove(created.files);
  // Deleting a client removes their scans with them.
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  for (const name of created.measures) await admin.from('custom_metrics').delete().eq('workspace_id', workspaceId).eq('name', name);
});

const MS_DAY = 86_400_000;
const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const dayOffset = (n: number) => isoDay(new Date(Date.now() + n * MS_DAY));

async function newClient(joinedDaysAgo = 0): Promise<{ id: string; last: string }> {
  const last = `Scan${unique()}`;
  const u = await admin.auth.admin.createUser({
    email: `scan-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: 'Body', last_name: last },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin
    .from('workspace_members')
    .insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client', created_at: new Date(Date.now() - joinedDaysAgo * MS_DAY).toISOString() });
  if (m.error) throw m.error;
  return { id: u.data.user.id, last };
}

async function seedScan(
  clientId: string,
  daysAgo: number,
  values: Record<string, number>,
  o: { source?: 'coach' | 'client'; attachmentPath?: string } = {},
): Promise<string> {
  const r = await admin
    .from('body_measurements')
    .insert({ workspace_id: workspaceId, client_id: clientId, measured_on: dayOffset(-daysAgo), source: o.source ?? 'coach', attachment_path: o.attachmentPath ?? null })
    .select('id')
    .single();
  if (r.error) throw r.error;
  const v = await admin.from('body_measurement_values').insert(Object.entries(values).map(([metric_key, value]) => ({ measurement_id: r.data.id, metric_key, value })));
  if (v.error) throw v.error;
  return r.data.id;
}

const pdf = (bytes = 600) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes, 0x20), Buffer.from('\n%%EOF')]);

async function openForm(page: Page, clientId: string) {
  await signInAsCoach(page);
  await page.goto(`/clients/${clientId}/body`);
  await page.getByRole('button', { name: 'Add scan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a scan' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const history = (page: Page) => page.getByRole('table', { name: /Scan history/ });

test('adding a scan with values and a PDF shows it in the history and on the chart', async ({ page }) => {
  const c = await newClient();
  await seedScan(c.id, 20, { body_fat_pct: 22 });
  const dialog = await openForm(page, c.id);
  await dialog.getByLabel('Body fat (%)', { exact: true }).fill('20.5');
  await dialog.getByLabel('BMI', { exact: true }).fill('24.1');
  await dialog.getByLabel(/^Printout/).setInputFiles({ name: 'inbody.pdf', mimeType: 'application/pdf', buffer: pdf() });
  await dialog.getByRole('button', { name: 'Save scan' }).click();
  await expect(dialog).toBeHidden();

  const row = history(page).getByRole('row').filter({ hasText: 'Body fat 20.5%' });
  await expect(row).toContainText('BMI 24.1');
  await expect(row).toContainText('Coach');
  const link = row.getByRole('link', { name: 'View printout' });
  await expect(link).toBeVisible();
  const file = await page.request.get((await link.getAttribute('href'))!);
  expect(file.status()).toBe(200);

  const chart = page.getByRole('group', { name: 'Body fat chart' });
  await expect(chart).toBeVisible();
  await expect(chart.locator('circle')).toHaveCount(2);
  await expect(page.getByText('−1.5 since')).toBeVisible();
  // Only BMI has a single value: no chart for it.
  await expect(page.getByRole('group', { name: 'BMI chart' })).toHaveCount(0);

  const stored = await admin.from('body_measurements').select('attachment_path').eq('client_id', c.id).not('attachment_path', 'is', null).single();
  if (stored.error) throw stored.error;
  created.files.push(stored.data.attachment_path);
  expect(stored.data.attachment_path).toMatch(new RegExp(`^${workspaceId}/${c.id}/[0-9a-f-]{36}\\.pdf$`));
});

test('a client with one scan shows a note instead of a chart', async ({ page }) => {
  const c = await newClient();
  await seedScan(c.id, 3, { body_fat_pct: 22 });
  await signInAsCoach(page);
  await page.goto(`/clients/${c.id}/body`);
  await expect(page.getByText('Add another scan to see a trend.')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Body fat chart' })).toHaveCount(0);
});

test('editing a scan changes its values, and the date can not be in the future', async ({ page }) => {
  const c = await newClient();
  await seedScan(c.id, 5, { body_fat_pct: 22 });
  await signInAsCoach(page);
  await page.goto(`/clients/${c.id}/body`);
  await page.getByRole('button', { name: /^Edit scan of/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit scan' });
  await expect(dialog.getByLabel('Body fat (%)', { exact: true })).toHaveValue('22');
  await dialog.getByLabel('Body fat (%)', { exact: true }).fill('80');
  await dialog.getByRole('button', { name: 'Save scan' }).click();
  await expect(dialog.getByText('Body fat (%) must be between 2 and 75.')).toBeVisible();
  await dialog.getByLabel('Body fat (%)', { exact: true }).fill('19');
  await dialog.getByLabel('Date').fill(dayOffset(5));
  await expect(dialog.getByText("The date can't be in the future.")).toBeVisible();
  await dialog.getByLabel('Date').fill(dayOffset(-4));
  await dialog.getByRole('button', { name: 'Save scan' }).click();
  await expect(dialog).toBeHidden();
  await expect(history(page).getByRole('row').filter({ hasText: 'Body fat 19.0%' })).toHaveCount(1);
  await expect(history(page).getByText('Body fat 22.0%')).toHaveCount(0);
});

test('deleting a scan asks first, removes its row and its printout file', async ({ page }) => {
  const c = await newClient();
  const path = `${workspaceId}/${c.id}/${crypto.randomUUID()}.pdf`;
  created.files.push(path);
  const up = await admin.storage.from('scan-attachments').upload(path, pdf(), { contentType: 'application/pdf' });
  if (up.error) throw up.error;
  await seedScan(c.id, 5, { body_fat_pct: 22 }, { attachmentPath: path });
  await signInAsCoach(page);
  await page.goto(`/clients/${c.id}/body`);
  await page.getByRole('button', { name: /^Delete scan of/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this scan?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(history(page).getByRole('row')).toHaveCount(2); // header + the scan

  await page.getByRole('button', { name: /^Delete scan of/ }).click();
  await page.getByRole('dialog', { name: 'Delete this scan?' }).getByRole('button', { name: 'Delete scan' }).click();
  await expect(page.getByText('Scan deleted.')).toBeVisible();
  await expect(page.getByText('No scans yet.')).toBeVisible();

  const left = await admin.storage.from('scan-attachments').list(`${workspaceId}/${c.id}`);
  if (left.error) throw left.error;
  expect(left.data).toEqual([]);
});

test('a custom measure joins the form; archived, it leaves the form but stays in the history', async ({ page }) => {
  const c = await newClient();
  const name = `Waist${unique()}`;
  created.measures.push(name);
  const dialog = await openForm(page, c.id);
  await dialog.getByRole('button', { name: 'Manage custom measures' }).click();
  const manage = page.getByRole('dialog', { name: 'Custom measures' });
  await manage.getByLabel('Measure name').fill(name);
  await manage.getByLabel('Unit label').fill('in');
  await manage.getByLabel('Smallest value').fill('15');
  await manage.getByLabel('Largest value').fill('80');
  await manage.getByRole('button', { name: 'Add measure' }).click();
  await expect(manage.getByRole('list', { name: 'Custom measures' })).toContainText(name);
  await manage.getByRole('button', { name: 'Done' }).click();

  const field = dialog.getByLabel(`${name} (in)`, { exact: true });
  await expect(field).toBeVisible();
  await field.fill('90');
  await dialog.getByRole('button', { name: 'Save scan' }).click();
  await expect(dialog.getByText(`${name} (in) must be between 15 and 80.`)).toBeVisible();
  await field.fill('32.5');
  await dialog.getByRole('button', { name: 'Save scan' }).click();
  await expect(dialog).toBeHidden();
  await expect(history(page).getByText(`${name} 32.5 in`)).toBeVisible();

  await page.getByRole('button', { name: 'Add scan' }).click();
  const again = page.getByRole('dialog', { name: 'Add a scan' });
  await expect(again.getByLabel(`${name} (in)`, { exact: true })).toBeVisible();
  await again.getByRole('button', { name: 'Manage custom measures' }).click();
  await page.getByRole('dialog', { name: 'Custom measures' }).getByRole('button', { name: `Archive ${name}` }).click();
  await expect(page.getByRole('dialog', { name: 'Custom measures' }).getByRole('list', { name: 'Custom measures' })).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Custom measures' }).getByRole('button', { name: 'Done' }).click();
  await expect(again.getByLabel(`${name} (in)`, { exact: true })).toHaveCount(0);
  await again.getByRole('button', { name: 'Cancel' }).click();
  await expect(history(page).getByText(`${name} 32.5 in`)).toBeVisible();
});

test('a 6 MB PDF is refused with the exact message, and so is a fake PDF', async ({ page }) => {
  const c = await newClient();
  const dialog = await openForm(page, c.id);
  const file = dialog.getByLabel(/^Printout/);
  await file.setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: pdf(6 * 1024 * 1024) });
  await expect(dialog.getByRole('alert').filter({ hasText: 'Printouts must be an image or a PDF under 5 MB.' })).toBeVisible();
  await dialog.getByLabel('Body fat (%)', { exact: true }).fill('20');
  await dialog.getByRole('button', { name: 'Save scan' }).click();
  await expect(dialog).toBeVisible();
  await file.setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') });
  await expect(dialog.getByRole('alert').filter({ hasText: 'Printouts must be an image or a PDF under 5 MB.' })).toBeVisible();
  await file.setInputFiles({ name: 'ok.pdf', mimeType: 'application/pdf', buffer: pdf() });
  await expect(dialog.getByText('Printouts must be an image or a PDF under 5 MB.')).toHaveCount(0);
});

test('a client-entered weight can be deleted but not edited: Add a new scan instead', async ({ page }) => {
  const c = await newClient();
  await seedScan(c.id, 2, { weight_kg: 80 }, { source: 'client' });
  await signInAsCoach(page);
  await page.goto(`/clients/${c.id}/body`);
  const row = history(page).getByRole('row').filter({ hasText: 'Logged by client' });
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: /^Edit scan of/ })).toHaveCount(0);
  await row.getByRole('button', { name: /^Add a new scan instead/ }).click();
  await expect(page.getByRole('dialog', { name: 'Add a scan' })).toBeVisible();
});

test('coach home lists an overdue client, and Add scan opens the form', async ({ page }) => {
  const due = await newClient(40);
  const fresh = await newClient(40);
  await seedScan(fresh.id, 5, { body_fat_pct: 20 });
  const old = await newClient(60);
  await seedScan(old.id, 45, { body_fat_pct: 20 });
  // Only the client's own weight entry in the last days: it does not count as a scan, so they are still listed.
  const selfLogged = await newClient(40);
  await seedScan(selfLogged.id, 2, { weight_kg: 80 }, { source: 'client' });
  const removed = await newClient(40);
  const gone = await admin.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', removed.id);
  if (gone.error) throw gone.error;
  await signInAsCoach(page);
  await page.goto('/home');
  const group = page.getByRole('region', { name: 'Needs attention' });
  await expect(group).toBeVisible();
  // "Scan due" narrows the list to clients due a scan, with that as the reason (other reasons count as "+n more").
  await group.getByRole('button', { name: /^Scan due \d+$/ }).click();
  const showAll = group.getByRole('button', { name: /^Show all \d+$/ });
  if (await showAll.count()) await showAll.click();
  await expect(group.locator('li').filter({ hasText: due.last })).toContainText('No body scan yet');
  await expect(group.locator('li').filter({ hasText: old.last })).toContainText(/Last body scan 4\d days ago/);
  await expect(group.locator('li').filter({ hasText: fresh.last })).toHaveCount(0);
  await expect(group.locator('li').filter({ hasText: selfLogged.last })).toContainText('No body scan yet');
  await expect(group.locator('li').filter({ hasText: removed.last })).toHaveCount(0);

  await group.locator('li').filter({ hasText: due.last }).getByRole('link', { name: /^Add a scan for/ }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${due.id}`));
  await expect(page.getByRole('dialog', { name: 'Add a scan' })).toBeVisible();
  await expect(page).not.toHaveURL(/scan=1/);
});

test('a save whose answer never arrives keeps the uploaded printout (it may have been saved)', async ({ page }) => {
  const c = await newClient();
  const dialog = await openForm(page, c.id);
  await dialog.getByLabel('Body fat (%)', { exact: true }).fill('20');
  await dialog.getByLabel(/^Printout/).setInputFiles({ name: 'inbody.pdf', mimeType: 'application/pdf', buffer: pdf() });
  // The browser loses the connection when it sends the save (the server action call).
  await page.route(`**/clients/${c.id}/body*`, (route) => (route.request().headers()['next-action'] ? route.abort() : route.continue()));
  await dialog.getByRole('button', { name: 'Save scan' }).click();
  await expect(dialog.getByRole('alert')).toContainText("Couldn't save the scan");
  await expect.poll(async () => (await admin.storage.from('scan-attachments').list(`${workspaceId}/${c.id}`)).data?.length).toBe(1);
  // Nothing removes it afterwards either.
  await page.waitForTimeout(1000);
  const left = await admin.storage.from('scan-attachments').list(`${workspaceId}/${c.id}`);
  expect(left.data).toHaveLength(1);
  created.files.push(`${workspaceId}/${c.id}/${left.data![0]!.name}`);
});

test('scans only outside the chosen range say so and Show all brings the chart back', async ({ page }) => {
  const c = await newClient();
  await seedScan(c.id, 400, { body_fat_pct: 24 });
  await seedScan(c.id, 380, { body_fat_pct: 23 });
  await seedScan(c.id, 3, { body_fat_pct: 21 });
  await signInAsCoach(page);
  await page.goto(`/clients/${c.id}/body`);
  await expect(page.getByRole('group', { name: /^Body fat chart/ })).toHaveCount(0);
  await expect(page.getByText('Not enough scans in this range for a chart.')).toBeVisible();
  await page.getByRole('button', { name: 'Show all' }).click();
  const chart = page.getByRole('group', { name: /^Body fat chart/ });
  await expect(chart).toBeVisible();
  // One tab stop; the arrow keys move between the three points.
  await chart.focus();
  const read = page.locator('[class*="chartRead"]');
  const before = await read.innerText();
  await chart.press('ArrowLeft');
  await expect(read).not.toHaveText(before);
});

test.describe('scan history on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('each scan is a card with its values in two columns and Edit / Delete behind ⋯', async ({ page }) => {
    test.slow();
    const c = await newClient();
    await seedScan(c.id, 12, { weight_kg: 70, body_fat_pct: 27 }, { source: 'client' });
    await seedScan(c.id, 5, { weight_kg: 69.4, body_fat_pct: 26.2, smm_kg: 27.9, visceral_fat: 6 });
    await signInAsCoach(page);
    await page.goto(`/clients/${c.id}/body`);

    // No table on a phone: a list of cards, newest first.
    expect(page.viewportSize()!.width).toBeLessThan(600);
    await expect(history(page)).toBeHidden();
    const cards = page.getByRole('list', { name: 'Scan history, newest first' }).getByRole('listitem');
    await expect(cards).toHaveCount(2);
    const newest = cards.nth(0);
    await expect(newest).toContainText('Entered by you');
    await expect(newest).toContainText('Weight');
    await expect(newest).toContainText('69.4 kg');
    // The change from the scan before: in full on the first value, short after it.
    await expect(newest).toContainText('−0.6 since');
    await expect(newest).toContainText('−0.8');
    await expect(cards.nth(1)).toContainText(`Entered by Body ${c.last}`);

    // Values sit in two columns: Weight and Body fat side by side.
    const weight = (await newest.getByText('Weight', { exact: true }).boundingBox())!;
    const fat = (await newest.getByText('Body fat', { exact: true }).boundingBox())!;
    expect(Math.abs(weight.y - fat.y)).toBeLessThan(4);
    expect(fat.x).toBeGreaterThan(weight.x + 100);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

    // ⋯ holds Edit and Delete (no small links on the card).
    await expect(newest.getByRole('button', { name: /^(Edit|Delete) scan of/ })).toHaveCount(0);
    const more = newest.getByRole('button', { name: /^More for the .+ scan$/ });
    const moreBox = (await more.boundingBox())!;
    expect(moreBox.height).toBeGreaterThanOrEqual(44);
    expect(moreBox.width).toBeGreaterThanOrEqual(44);
    await more.tap();
    await expect(newest.getByRole('menuitem')).toHaveText(['Edit scan', 'Delete scan…']);
    await newest.getByRole('menuitem', { name: 'Edit scan' }).tap();
    await expect(page.getByRole('dialog', { name: 'Edit scan' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Edit scan' }).getByRole('button', { name: 'Cancel' }).tap();

    // The client's own entry offers a new scan instead of Edit.
    await cards.nth(1).getByRole('button', { name: /^More for the .+ scan$/ }).tap();
    await expect(cards.nth(1).getByRole('menuitem')).toHaveText(['Add a new scan instead', 'Delete scan…']);
    await page.keyboard.press('Escape');

    // Delete still asks first.
    await more.tap();
    await newest.getByRole('menuitem', { name: 'Delete scan…' }).tap();
    const dialog = page.getByRole('dialog', { name: 'Delete this scan?' });
    await dialog.getByRole('button', { name: 'Cancel' }).tap();
    await expect(cards).toHaveCount(2);
    await more.tap();
    await newest.getByRole('menuitem', { name: 'Delete scan…' }).tap();
    await dialog.getByRole('button', { name: 'Delete scan' }).tap();
    await expect(page.getByText('Scan deleted.')).toBeVisible();
    await expect(cards).toHaveCount(1);
  });

  test('a tablet keeps the table', async ({ page }) => {
    const c = await newClient();
    await seedScan(c.id, 3, { weight_kg: 71 });
    await page.setViewportSize({ width: 820, height: 1180 });
    await signInAsCoach(page);
    await page.goto(`/clients/${c.id}/body`);
    await expect(history(page)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Scan history, newest first' })).toBeHidden();
  });
});
