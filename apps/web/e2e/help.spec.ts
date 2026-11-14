import { expect, test } from '@playwright/test';
import { signInAsCoach } from './helpers';

// Help (round 2): a page of five short how-tos that open in place, and support's address to copy or email. It replaced
// a mailto-only link, which showed an error on an iPhone without the Mail app.

const HOW_TOS = ['Invite a client', 'Assign a program', 'Log a session in person', 'Message a client', 'Add a body scan'];

test('the sidebar opens Help, and a how-to opens in place', async ({ page }) => {
  await signInAsCoach(page);
  await page.locator('[data-coach-sidebar]').getByRole('link', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible();
  const list = page.getByRole('list', { name: 'How-tos' });
  for (const name of HOW_TOS) await expect(list.getByText(name, { exact: true })).toBeVisible();
  const steps = page.getByText('Open Programs and tap Assign on the program.');
  await expect(steps).toBeHidden();
  await list.getByText('Assign a program', { exact: true }).click();
  await expect(steps).toBeVisible();
  await page.getByRole('link', { name: 'Go to Programs' }).click();
  await expect(page).toHaveURL(/\/programs$/);
});

test('the support email is copyable and the mail link names the page the coach came from', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signInAsCoach(page);
  await page.locator('[data-coach-sidebar]').getByRole('link', { name: 'Help' }).click();
  await expect(page.getByText('support@caltracker.app', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Email address copied.' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('support@caltracker.app');

  const mail = page.getByRole('link', { name: 'Open in my mail app' });
  await expect(mail).toHaveAttribute('href', /^mailto:support@caltracker\.app\?subject=CalTracker%20help&body=/);
  // The browser and page are filled in once the page hydrates (the server renders the link without them).
  await expect(mail).toHaveAttribute('href', /Page%3A%20/);
  const body = new URL((await mail.getAttribute('href'))!).searchParams.get('body')!;
  expect(body).toContain('App: Coach website');
  expect(body).toMatch(/Version: \S+/);
  expect(body).toMatch(/Device: Mozilla\//);
  expect(body).toMatch(/Page: http:\/\/localhost:\d+\/clients$/);
});

test.describe('on an iPhone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Help is a tile in the More sheet', async ({ page }) => {
    await signInAsCoach(page);
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Help' }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible();
    // Nothing wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
});
