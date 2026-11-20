import { expect, test } from '@playwright/test';
import { createUser, lit, seedClient, seedCoach, signInAdmin, sql, tag } from './helpers';

// The owner Overview (boards AD1/AD2) and the Coaches page's test-accounts switch (AD3).

test('overview: coaches, growth, product health and usage; test accounts only with the switch', async ({ page }) => {
  const t = tag();
  const real = await seedCoach('Rhea', `Real${t}`, `Real Gym ${t}`);
  const client = await seedClient(real.workspaceId, 'Cleo', `Client${t}`);
  sql(`insert into public.workouts (workspace_id, name, created_by) values (${lit(real.workspaceId)}, 'Push day', ${lit(real.id)})`);
  const fake = await seedCoach('Tess', `Test${t}`, `Test Gym ${t}`);
  sql(`update public.workspaces set is_test = true where id = ${lit(fake.workspaceId)}`);
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInAdmin(page, owner);

  const coaches = page.getByRole('region', { name: /^Coaches · \d+$/ });
  const row = coaches.getByRole('row', { name: new RegExp(`Rhea Real${t}`) });
  await expect(row).toContainText(`Real Gym ${t}`);
  await expect(row).toContainText('1 built · 0 assigned');
  await expect(row).toContainText('1 · no plan yet');
  await expect(row).toContainText('Active');
  await expect(coaches.getByRole('row', { name: new RegExp(`Tess Test${t}`) })).toHaveCount(0);

  const growth = page.getByRole('region', { name: 'Growth · this week' });
  for (const label of ['NEW COACHES', 'CLIENTS ADDED', 'INVITES']) await expect(growth.getByText(label)).toBeVisible();
  await expect(growth).toContainText('joined');
  await expect(page.getByRole('region', { name: 'Product health' })).toBeVisible();
  const usage = page.getByRole('region', { name: 'Usage · this week' });
  for (const label of ['WORKOUTS LOGGED', 'MEALS', 'METRICS', 'NEW CONNECTIONS', 'POSTS', 'MESSAGES']) {
    await expect(usage.getByText(label, { exact: true })).toBeVisible();
  }
  // Totals only: no client names on the Overview.
  await expect(page.getByRole('main').getByText(`Cleo Client${t}`)).toHaveCount(0);
  expect(client.id).toBeTruthy();

  const toggle = page.getByRole('switch', { name: 'Show test accounts' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(page).toHaveURL(/\/overview\?test=1$/);
  await expect(page.getByRole('switch', { name: 'Show test accounts' })).toHaveAttribute('aria-checked', 'true');
  await expect(coaches.getByRole('row', { name: new RegExp(`Tess Test${t}`) })).toBeVisible();

  // The Coaches page hides test workspaces the same way.
  await page.goto('/coaches');
  await expect(page.getByRole('row', { name: new RegExp(`Rhea Real${t}`) })).toContainText('1 built · 0 assigned');
  await expect(page.getByRole('row', { name: new RegExp(`Tess Test${t}`) })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Add a coach' })).toContainText(
    'They get an email to set a password. They start with the standard exercise library.',
  );
  await page.getByRole('switch', { name: 'Show test accounts' }).click();
  await expect(page).toHaveURL(/\/coaches\?test=1$/);
  await expect(page.getByRole('row', { name: new RegExp(`Tess Test${t}`) })).toBeVisible();
});

for (const size of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'iPad', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`overview and coaches fit a ${size.name} screen with no sideways scroll`, async ({ page }) => {
    const t = tag();
    await seedCoach('Wide', `Coach${t}`, `Size Gym ${t}`);
    const owner = await createUser({ role: 'owner', enrolled: true });
    await page.setViewportSize({ width: size.width, height: size.height });
    await signInAdmin(page, owner);
    for (const path of ['/overview', '/coaches']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    }
    // On a phone, Overview coach rows are cards (no table); wider screens get the table.
    await page.goto('/overview');
    const coaches = page.getByRole('region', { name: /^Coaches · \d+$/ });
    if (size.width < 600) {
      await expect(coaches.getByRole('table')).toBeHidden();
      await expect(coaches.getByText('Last active', { exact: true }).first()).toBeVisible();
    } else {
      await expect(coaches.getByRole('table')).toBeVisible();
    }
  });
}
