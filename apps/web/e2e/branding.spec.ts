import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  CLIENT_CSV_MAX_ROWS,
  EMAIL_HEADERS,
  FIRST_NAME_HEADERS,
  LAST_NAME_HEADERS,
  NAME_HEADERS,
  parseClientCsv,
} from '@caltracker/shared';

test('sign-in page is branded', async ({ page }) => {
  await page.goto('/sign-in');
  const logo = page.getByRole('img', { name: 'CalTracker' }).first();
  await expect(logo).toBeVisible();
  // The mark (a "C" progress ring) sits next to the lowercase wordmark.
  await expect(logo.locator('svg')).toHaveCount(1);
  await expect(logo).toContainText('caltracker');
  await expect(page.getByText('Welcome back, coach!')).toBeVisible();

  const lime = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ct-lime').trim(),
  );
  expect(lime).toBe('#C8F169');

  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(bodyFont).toContain('Bricolage');

  const button = page.getByRole('button', { name: 'Sign in' });
  await expect(button).toHaveCSS('background-color', 'rgb(18, 18, 18)');
  const boxShadow = await button.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(boxShadow).toContain('rgb(200, 241, 105)');
});

test('"Forgot password?" on sign-in is a 44 px tap target', async ({ page }) => {
  await page.goto('/sign-in');
  const box = await page.getByRole('link', { name: 'Forgot password?' }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

for (const [width, height] of [[1024, 768], [1180, 820], [1280, 800]] as const) {
  test(`brand panel preview tiles fit inside the panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/sign-in');
    const panel = await page.locator('[data-auth-panel]').boundingBox();
    expect(panel).not.toBeNull();
    const tiles = page.locator('[data-preview-tile]');
    await expect(tiles).toHaveCount(3);
    for (const tile of await tiles.all()) {
      const box = await tile.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(panel!.x);
      expect(box!.y).toBeGreaterThanOrEqual(panel!.y);
      expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(panel!.y + panel!.height);
    }
  });
}

const OLD_ERROR_RED = 'rgb(176, 0, 32)';
const PAGES = [
  { name: 'forgot-password', path: '/forgot-password', signInAs: null },
  { name: 'set-password', path: '/set-password', signInAs: 'coach@demo.local', heading: 'Set your password' },
  { name: 'auth confirm', path: '/auth/confirm?token_hash=x&type=recovery', signInAs: null, button: 'Continue' },
  { name: 'not-a-coach', path: '/not-a-coach', signInAs: 'client@demo.local' },
  { name: 'invite (not found)', path: '/invite/not-a-real-token', signInAs: null },
] as const;

for (const p of PAGES) {
  test(`${p.name} page is branded`, async ({ page }) => {
    if (p.signInAs) {
      await page.goto('/sign-in');
      await page.getByLabel('Email').fill(p.signInAs);
      await page.getByLabel('Password').fill('demo-password-123');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).not.toHaveURL(/sign-in/);
    }
    await page.goto(p.path);
    await expect(page).toHaveURL(new RegExp(p.path.split('?')[0]!));
    if ('heading' in p) await expect(page.getByRole('heading', { name: p.heading })).toBeVisible();
    if ('button' in p) await expect(page.getByRole('button', { name: p.button })).toBeVisible();
    await expect(page.getByLabel('CalTracker').first()).toBeVisible();
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(bodyFont).toContain('Bricolage');
    const hasOldRed = await page.evaluate(
      (red) => [...document.querySelectorAll('*')].some((el) => getComputedStyle(el).color === red),
      OLD_ERROR_RED,
    );
    expect(hasOldRed).toBe(false);
  });
}

async function signInAsDemoCoach(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('coach@demo.local');
  await page.getByLabel('Password').fill('demo-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto('/clients');
}

test('coach shell: sidebar nav marks Clients as the current page and the page uses token card borders', async ({ page }) => {
  await signInAsDemoCoach(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Clients', 'Workouts', 'Programs', 'Exercises']) {
    await expect(nav.getByRole('link', { name })).toBeVisible();
  }
  const clients = nav.getByRole('link', { name: 'Clients' });
  await expect(clients).toHaveAttribute('aria-current', 'page');
  await expect(clients).toHaveCSS('background-color', 'rgb(18, 18, 18)');
  await expect(clients).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(nav.getByRole('link', { name: 'Exercises' })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  const cardBorders = await page.evaluate(() => {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--ct-border').trim();
    const probe = document.createElement('i');
    probe.style.color = token;
    document.body.append(probe);
    const tokenRgb = getComputedStyle(probe).color;
    probe.remove();
    return [...document.querySelectorAll('main *')].filter((el) => {
      const s = getComputedStyle(el);
      return s.borderTopStyle === 'solid' && s.borderTopWidth === '2px' && s.borderTopColor === tokenRgb;
    }).length;
  });
  // The Clients table is the page's card (Past clients adds another when there are any).
  expect(cardBorders).toBeGreaterThanOrEqual(1);
});

test('coach shell collapses to a labelled icon rail below 1200 px (iPad portrait)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await signInAsDemoCoach(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const sidebar = page.locator('[data-coach-sidebar]');
  expect((await sidebar.boundingBox())!.width).toBe(56);
  for (const name of ['Clients', 'Workouts', 'Programs', 'Exercises']) {
    const link = nav.getByRole('link', { name });
    await expect(link).toHaveAttribute('aria-label', name);
    const box = (await link.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  // Mouse users get the name as a tooltip.
  await expect(nav.getByRole('link', { name: 'Workouts' })).toHaveAttribute('title', 'Workouts');
});

test('on a short screen the icon rail scrolls, so Profile and Sign out stay reachable', async ({ page }) => {
  // About what an iPad in landscape split view or a 200% zoom leaves.
  await page.setViewportSize({ width: 1024, height: 420 });
  await signInAsDemoCoach(page);
  const sidebar = page.locator('[data-coach-sidebar]');
  expect(await sidebar.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport();
  await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();
});

test('coach shell keeps the full sidebar on iPad landscape and laptop', async ({ page }) => {
  await signInAsDemoCoach(page);
  for (const [width, height] of [[1366, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    expect((await page.locator('[data-coach-sidebar]').boundingBox())!.width).toBeGreaterThan(150);
  }
});

test('clients page: clients show round initials avatars', async ({ page }) => {
  await signInAsDemoCoach(page);
  const clients = page.getByRole('table', { name: 'Clients', exact: true });
  const demo = clients.getByRole('row').filter({ hasText: 'Demo Client' });
  await expect(demo.locator('[data-avatar]')).toHaveText('DC');
  await expect(demo.locator('[data-avatar]')).toHaveCSS('border-radius', '999px');
  // "+ Invite client" sits in the page header, above the list, so it is always in view on a laptop.
  const invite = page.getByRole('button', { name: 'Invite client', exact: true });
  expect((await invite.boundingBox())!.y).toBeLessThan((await clients.boundingBox())!.y);
  await expect(invite).toBeInViewport();
});

test('bulk CSV invite is its own tab of the invite window, explains itself and offers an example file', async ({ page }) => {
  await signInAsDemoCoach(page);
  // The invite window opens on One client; the CSV upload is the second tab.
  await page.getByRole('button', { name: 'Invite client', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a client' });
  const tab = dialog.getByRole('tab', { name: 'Many (CSV)' });
  await expect(tab).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('input[type="file"][aria-labelledby="csv-heading"]')).toBeHidden();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Invite many clients from a spreadsheet (CSV)' })).toBeVisible();
  await expect(page.locator('input[type="file"][aria-labelledby="csv-heading"]')).toBeVisible();
  await expect(
    page.getByText('Bring your client list from Everfit or Excel: one row per client with first name, last name and email.'),
  ).toBeVisible();
  for (const header of [...FIRST_NAME_HEADERS, ...LAST_NAME_HEADERS, ...NAME_HEADERS, ...EMAIL_HEADERS]) {
    await expect(page.locator('[data-csv-headers]').getByText(header, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Last name column (optional), any of:')).toBeVisible();
  await expect(page.getByText('Or one name column, split at the first space:')).toBeVisible();
  await expect(page.getByText(`Up to ${CLIENT_CSV_MAX_ROWS} clients per file.`)).toBeVisible();

  const link = page.getByRole('link', { name: 'Download example CSV' });
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const text = readFileSync(await download.path(), 'utf8');
  expect(text.split('\n')[0]).toBe('First name,Last name,Email');
  const parsed = parseClientCsv(text);
  expect(parsed.errors).toEqual([]);
  expect(parsed.rows).toHaveLength(2);
});

// One test (one sign-in): local Supabase allows 30 sign-ins per 5 minutes and the suite is close to that.
test('exercise library: list, detail and new-exercise form use the UI kit', async ({ page }) => {
  await signInAsDemoCoach(page);
  await page.goto('/exercises');
  await expect(page.getByLabel('Search exercises')).toBeVisible();
  const group = page.getByRole('group', { name: 'Tracking type' });
  const chips = group.getByRole('button');
  await expect(chips).toHaveCount(5); // weight and reps, reps only, time, distance, weight and time
  for (const chip of await chips.all()) {
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await group.getByRole('button', { name: 'Time', exact: true }).click();
  await expect(page).toHaveURL(/tracking=time/);
  await expect(page.getByRole('group', { name: 'Tracking type' }).getByRole('button', { name: 'Time', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: 'New custom exercise' })).toHaveCSS('background-color', 'rgb(18, 18, 18)');
  expect((await page.getByLabel('Search exercises').boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Detail page, reached from the preview.
  await page.goto('/exercises?q=Barbell Squat');
  await page.getByRole('option', { name: 'Barbell Squat', exact: true }).click();
  await page.getByRole('region', { name: 'Exercise preview' }).getByRole('link', { name: 'Details' }).click();
  const link = page.getByRole('link', { name: 'Watch form on YouTube' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByLabel('Pinned YouTube video')).toHaveCSS('background-color', 'rgb(244, 244, 244)');

  // New-exercise form.
  await page.goto('/exercises/new');
  for (const l of ['Name', 'Tracking type', 'Instructions (one step per line)']) {
    expect((await page.getByLabel(l).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Create exercise' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('⚠');
});

test('the browser tab and home-screen icons are the CalTracker mark, served without signing in', async ({ request }) => {
  const html = await (await request.get('/sign-in')).text();
  const icon = /<link rel="icon" href="([^"]+)"/.exec(html)?.[1];
  const apple = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(html)?.[1];
  expect(icon, 'favicon link').toBeTruthy();
  expect(apple, 'apple-touch-icon link').toBeTruthy();
  const svg = await request.get(icon!, { maxRedirects: 0 });
  expect(svg.status()).toBe(200);
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  expect(await svg.text()).toContain('#C8F169');
  const png = await request.get(apple!, { maxRedirects: 0 });
  expect(png.status()).toBe(200);
  expect(png.headers()['content-type']).toContain('image/png');
});
