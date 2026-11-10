import { expect, test } from '@playwright/test';
import { signInAsCoach } from './helpers';

// The privacy policy and terms are public (linked from the App Store and the sign-in screens), and every surface links
// them. Help & feedback on the coach website opens an email to support with the version, browser and page.

for (const [path, heading, other] of [
  ['/privacy', 'Privacy policy', 'Terms'],
  ['/terms', 'Terms of use', 'Privacy'],
] as const) {
  test(`${path} loads signed out`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(/Last updated .+ · Draft: under review/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'support@caltracker.app' }).first()).toHaveAttribute('href', 'mailto:support@caltracker.app');
    const nav = page.getByRole('navigation', { name: 'Legal' });
    await expect(nav.getByRole('link', { name: other, exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    await expect(page).toHaveTitle(`${heading} · CalTracker`);
  });
}

test('the privacy policy has the short version and every section', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByText('The short version')).toBeVisible();
  for (const h of ['Who we are', 'What we collect', 'Who can see it', 'Services we use', 'Deleting your data', 'Your rights']) {
    await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
  }
});

test('the proxy lets only the legal pages through without a session', async ({ page }) => {
  await page.goto('/privacy-and-more');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/terms/anything');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('the sign-in page links both pages', async ({ page }) => {
  await page.goto('/sign-in');
  const links = page.getByRole('navigation', { name: 'Legal' });
  await expect(links.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expect(links.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  await links.getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
});

test('the coach sidebar has Help & feedback and the legal footer', async ({ page }) => {
  await signInAsCoach(page);
  const sidebar = page.locator('[data-coach-sidebar]');
  const help = sidebar.getByRole('link', { name: 'Help & feedback' });
  await expect(help).toHaveAttribute('href', /^mailto:support@caltracker\.app\?subject=CalTracker%20help&body=/);
  const body = new URL((await help.getAttribute('href'))!).searchParams.get('body')!;
  expect(body).toContain('App: Coach website');
  expect(body).toMatch(/Version: \S+/);
  expect(body).toMatch(/Device: Mozilla\//);
  expect(body).toMatch(/Page: http:\/\/localhost:\d+\/clients$/);
  const footer = sidebar.getByRole('navigation', { name: 'Legal' });
  await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expect(footer.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
});
