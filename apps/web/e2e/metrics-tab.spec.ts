import { expect, test, type Page } from '@playwright/test';
import { deleteCoach, newCoachWithClient, signInAs } from './assign-helpers';
import { serviceClient } from './helpers';

// The client's Metrics tab (Body cards, + Log metric) and one metric's page (chart, entries, edit and delete), at
// phone, iPad and desktop sizes. Each test makes its own coach (in kg) and client, so tests can run side by side.
const admin = serviceClient();
const MS_DAY = 86_400_000;
const isoDay = (n: number) => new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() - n * MS_DAY));
type Coach = Awaited<ReturnType<typeof newCoachWithClient>>;

async function newCoach(): Promise<Coach> {
  const c = await newCoachWithClient(admin, 'Metrics');
  const u = await admin.from('profiles').update({ units: 'kg' }).eq('id', c.coachId);
  if (u.error) throw u.error;
  return c;
}

async function seedEntry(c: Coach, o: { key: string; value: number; ago: number; by?: 'coach' | 'client'; source?: 'manual' | 'apple_health' }) {
  const source = o.source ?? 'manual';
  const r = await admin.from('body_metrics').insert({
    workspace_id: c.workspaceId,
    client_id: c.clientId,
    metric_key: o.key,
    value: o.value,
    measured_on: isoDay(o.ago),
    source,
    entered_by_role: source === 'apple_health' ? 'client' : (o.by ?? 'coach'),
    external_id: source === 'apple_health' ? `hk-${Math.random()}` : null,
  });
  if (r.error) throw r.error;
}

const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, columns: 1 },
  { name: 'iPad', viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true, columns: 2 },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, columns: 3 },
] as const;

async function noSidewaysScroll(page: Page) {
  const [sw, w] = await page.evaluate(() => [document.scrollingElement!.scrollWidth, innerWidth]);
  expect(sw).toBeLessThanOrEqual(w + 1);
}

const cards = (page: Page) => page.getByRole('list', { name: 'Body metrics' });

for (const size of SIZES) {
  test.describe(`at ${size.name}`, () => {
    test.use({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch });

    test('the coach logs a weight, then edits and deletes it on the metric’s page', async ({ page }) => {
      const c = await newCoach();
      try {
        await seedEntry(c, { key: 'weight_kg', value: 72, ago: 40 });
        await signInAs(page, c.email);
        await page.goto(`/clients/${c.clientId}/metrics`);
        await expect(page.getByRole('navigation', { name: 'Client sections' }).getByRole('link', { name: 'Metrics' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
        // Phone: plain rows; iPad: 2 columns of cards; desktop: 3.
        const columns = await cards(page).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        expect(columns).toBe(size.columns);
        await expect(cards(page).getByRole('button', { name: /^Resting heart rate\s+Not logged yet/ })).toBeVisible();

        await page.getByRole('button', { name: '+ Log metric' }).click();
        const dialog = page.getByRole('dialog', { name: 'Log a metric' });
        await expect(dialog.getByRole('button', { name: 'Weight', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.getByText(/^Last: 72\.0 kg on .+ \(logged by you\)$/)).toBeVisible();
        await dialog.getByLabel('Weight').fill('70.4');
        await dialog.getByRole('button', { name: 'Save weight' }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('status').getByText('Weight saved.')).toBeVisible();
        const card = cards(page).getByRole('link', { name: /^Weight\s+70\.4\s*kg\s+−1\.6 kg over 1 year\s+Today · logged by you$/ });
        await expect(card).toBeVisible();
        await noSidewaysScroll(page);

        await card.click();
        await expect(page).toHaveURL(new RegExp(`/clients/${c.clientId}/metrics/body/weight_kg$`));
        await expect(page.getByRole('heading', { level: 1, name: 'Weight' })).toBeVisible();
        await expect(page.getByTestId('line-chart')).toBeVisible();
        const entries = page.getByTestId('metric-entries');
        await expect(entries.getByRole('listitem')).toHaveCount(2);
        await noSidewaysScroll(page);

        await page.getByRole('button', { name: /^More for 70\.4 kg on / }).click();
        await page.getByRole('menuitem', { name: 'Edit entry' }).click();
        const edit = page.getByRole('dialog', { name: 'Edit weight' });
        await edit.getByLabel('Weight').fill('69.9');
        await edit.getByRole('button', { name: 'Save weight' }).click();
        await expect(edit).toBeHidden();
        await expect(entries.getByText('69.9 kg', { exact: true })).toBeVisible();

        await page.getByRole('button', { name: /^More for 69\.9 kg on / }).click();
        await page.getByRole('menuitem', { name: 'Delete entry…' }).click();
        const confirm = page.getByRole('alertdialog', { name: 'Delete this weight entry?' });
        await confirm.getByRole('button', { name: 'Delete entry' }).click();
        await expect(confirm).toBeHidden();
        await expect(entries.getByRole('listitem')).toHaveCount(1);
        const left = await admin.from('body_metrics').select('value').eq('client_id', c.clientId);
        expect(left.data?.map((r) => Number(r.value))).toEqual([72]);

        await page.getByRole('link', { name: /’s metrics$/ }).click();
        await expect(page).toHaveURL(new RegExp(`/clients/${c.clientId}/metrics$`));
      } finally {
        await deleteCoach(admin, c);
      }
    });
  });
}

test('each card says who logged its latest value; the client’s own entries can’t be edited here', async ({ page }) => {
  const c = await newCoach();
  try {
    await seedEntry(c, { key: 'weight_kg', value: 71, ago: 1, by: 'client' });
    await seedEntry(c, { key: 'body_fat_pct', value: 22, ago: 3, source: 'apple_health' });
    await signInAs(page, c.email);
    await page.goto(`/clients/${c.clientId}/metrics?range=3m`);
    await expect(cards(page).getByRole('link', { name: /^Weight\s+71\.0\s*kg\s+Yesterday · logged by Cleo$/ })).toBeVisible();
    await expect(cards(page).getByRole('link', { name: /^Body fat\s+22\.0\s*%\s+.+ · from Apple Health$/ })).toBeVisible();
    // The range is in the address and the card link keeps it.
    await expect(page.getByRole('list', { name: 'Range' }).getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true');
    await cards(page).getByRole('link', { name: /^Weight\s/ }).click();
    await expect(page).toHaveURL(/\/metrics\/body\/weight_kg\?range=3m$/);
    await expect(page.getByTestId('metric-entries').getByText('71.0 kg', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^More for / })).toHaveCount(0);
  } finally {
    await deleteCoach(admin, c);
  }
});

test('Log metric checks the value and date inline, asks before discarding, and reopens from the address', async ({ page }) => {
  const c = await newCoach();
  try {
    await signInAs(page, c.email);
    await page.goto(`/clients/${c.clientId}/metrics`);
    await page.getByRole('button', { name: '+ Log metric' }).click();
    const dialog = page.getByRole('dialog', { name: 'Log a metric' });
    await expect(page).toHaveURL(/[?&]sheet=log-metric/);
    await dialog.getByRole('button', { name: 'Resting heart rate', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Save resting heart rate' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Waist', exact: true }).click();
    await dialog.getByLabel('Waist').fill('9');
    await dialog.getByRole('button', { name: 'Save waist' }).click();
    await expect(dialog.getByText('Enter a waist between 40.0 and 250.0 cm.')).toBeVisible();
    await expect(dialog.getByLabel('Waist')).toHaveAttribute('aria-invalid', 'true');
    await dialog.getByLabel('Waist').fill('81');
    await dialog.getByLabel('Date').fill(isoDay(-3));
    await dialog.getByRole('button', { name: 'Save waist' }).click();
    await expect(dialog.getByText("The date can't be in the future.")).toBeVisible();

    // Unsaved: × asks first.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog.getByText('Discard changes?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await dialog.getByLabel('Date').fill(isoDay(2));
    await dialog.getByRole('button', { name: 'Save waist' }).click();
    await expect(dialog).toBeHidden();
    await expect(cards(page).getByRole('link', { name: /^Waist\s+81\.0\s*cm/ })).toBeVisible();

    // A refresh with ?sheet=log-metric opens it again; Back closes it and stays on the tab.
    await page.goto(`/clients/${c.clientId}/metrics?sheet=log-metric`);
    await expect(page.getByRole('dialog', { name: 'Log a metric' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog', { name: 'Log a metric' })).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/clients/${c.clientId}/metrics$`));

    // "Add a full InBody scan" swaps to the scan form (never one pop-up on another).
    await page.getByRole('button', { name: '+ Log metric' }).click();
    await page.getByRole('dialog', { name: 'Log a metric' }).getByRole('button', { name: /^Add a full InBody scan/ }).click();
    await expect(page.getByRole('dialog', { name: 'Add a scan' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Log a metric' })).toHaveCount(0);
  } finally {
    await deleteCoach(admin, c);
  }
});

test('the old Body address opens the Metrics tab and keeps its query', async ({ page }) => {
  const c = await newCoach();
  try {
    await signInAs(page, c.email);
    await page.goto(`/clients/${c.clientId}/body?range=all`);
    await expect(page).toHaveURL(new RegExp(`/clients/${c.clientId}/metrics\\?range=all$`));
    await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
    await page.goto(`/clients/${c.clientId}/body?scan=1`);
    await expect(page.getByRole('dialog', { name: 'Add a scan' })).toBeVisible();
  } finally {
    await deleteCoach(admin, c);
  }
});

test('a metric entry shows on the Overview body card', async ({ page }) => {
  const c = await newCoach();
  try {
    await seedEntry(c, { key: 'weight_kg', value: 75, ago: 20 });
    await seedEntry(c, { key: 'weight_kg', value: 74.2, ago: 1, by: 'client' });
    await signInAs(page, c.email);
    await page.goto(`/clients/${c.clientId}`);
    const card = page.locator('[aria-labelledby="body-heading"]');
    await expect(card.getByRole('button', { name: /^Weight\s+74\.2 kg\s+−0\.8 kg over last 4 weeks/ })).toBeVisible();
    await card.getByRole('link', { name: '+ Log metric' }).click();
    await expect(page.getByRole('dialog', { name: 'Log a metric' })).toBeVisible();
  } finally {
    await deleteCoach(admin, c);
  }
});
