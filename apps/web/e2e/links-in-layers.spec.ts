import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace, seedLibraryWorkout, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// A link inside something that covers the page (a pop-up, a sheet, a menu) opens its page in one tap, and Back from
// there returns to the page under it, not to the closed pop-up (docs/design/ui-rules.md §8 "Back and swipe-back go
// exactly one step"). The app's history layers (lib/history-layers.ts) step back over the pop-up's own history entry
// first, then follow the link. Page loads are slowed down (as on a phone's network), so a navigation is still loading
// when the router handles that step back: it must not be thrown away.

const admin = serviceClient();
const created: string[] = [];
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});
test.afterAll(async () => {
  if (created.length) await admin.from('workouts').delete().in('id', created);
});

const IPHONE = { width: 390, height: 844 };
const IPAD = { width: 820, height: 1180 };
const DESKTOP = { width: 1440, height: 900 };
// A seeded demo client (supabase/seed.sql).
const CLIENT_ID = '00000000-0000-4000-8000-0000000000c2';

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.searchParams.has('_rsc'),
    async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    },
  );
});

async function seed(): Promise<{ id: string; name: string }> {
  const name = `Linked ${unique()}`;
  const id = await seedLibraryWorkout(admin, workspaceId, name);
  created.push(id);
  return { id, name };
}

async function openPreview(page: Page, name: string, phone: boolean) {
  await page.goto(`/workouts?q=${encodeURIComponent(name)}`);
  await page.getByRole('button', { name: `More actions for ${name}` }).click();
  if (phone) await page.getByRole('dialog').getByRole('button', { name: 'Preview' }).click();
  else await page.getByRole('menu', { name: `More actions for ${name}` }).getByRole('menuitem', { name: 'Preview' }).click();
  const preview = page.getByRole('dialog', { name });
  await expect(preview.getByText('Barbell Squat')).toBeVisible();
  return preview;
}

for (const [device, size] of [
  ['iPhone', IPHONE],
  ['iPad', IPAD],
  ['desktop', DESKTOP],
] as const) {
  test(`on ${device} Preview's Edit workout opens the builder, and Back returns to the list`, async ({ page }) => {
    await page.setViewportSize(size);
    const w = await seed();
    await signInAsCoach(page);
    const preview = await openPreview(page, w.name, size === IPHONE);
    await preview.getByRole('link', { name: 'Edit workout' }).click();
    await expect(page).toHaveURL(new RegExp(`/workouts/${w.id}$`));
    await expect(page.getByRole('dialog', { name: w.name })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/workouts\?q=/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `More actions for ${w.name}` })).toBeVisible();
  });

  test(`on ${device} the client page's ⋯ link opens its page, and Back returns to the client`, async ({ page }) => {
    await page.setViewportSize(size);
    await signInAsCoach(page);
    await page.goto(`/clients/${CLIENT_ID}`);
    await page.getByRole('button', { name: 'More for this client' }).click();
    await page.getByRole('menuitem', { name: 'Client settings' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${CLIENT_ID}/settings$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/clients/${CLIENT_ID}$`));
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test(`on ${device} "‹ Clients" tapped with the client's ⋯ menu open goes back to the list`, async ({ page }) => {
    await page.setViewportSize(size);
    await signInAsCoach(page);
    await page.goto('/home');
    await page.goto(`/clients/${CLIENT_ID}`);
    await page.getByRole('button', { name: 'More for this client' }).click();
    await expect(page.getByRole('menu', { name: 'More for this client' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Clients' }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/clients/${CLIENT_ID}$`));
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
}

/**
 * No pop-up in the address (AdaptiveDialog) holds a link yet, so the test puts one in: an <a> that, like next/link,
 * cancels the browser's own navigation and asks the app's router to push its address.
 */
async function addRouterLink(page: Page, inside: string, href: string, text: string) {
  await page.locator(inside).evaluate(
    (el, [h, t]) => {
      const a = document.createElement('a');
      a.href = h!;
      a.textContent = t!;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(h!);
      });
      el.append(a);
    },
    [href, text],
  );
}

for (const [device, size] of [
  ['iPhone', IPHONE],
  ['iPad', IPAD],
  ['desktop', DESKTOP],
] as const) {
  test(`on ${device} a link in the Community Members pop-up opens its page, and Back returns to Community`, async ({ page }) => {
    await page.setViewportSize(size);
    await signInAsCoach(page);
    await page.goto('/community');
    await page.getByRole('button', { name: /^Members \(\d+\)$/ }).click();
    const members = page.getByRole('dialog', { name: /^Members/ });
    await expect(members).toBeVisible();
    await expect(page).toHaveURL(/sheet=community-members/);
    await addRouterLink(page, 'dialog[open]', '/clients', 'Open clients');
    await members.getByRole('link', { name: 'Open clients' }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/community$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test.describe('on an iPhone', () => {
  test.use({ viewport: IPHONE, hasTouch: true, isMobile: true });
  const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Tabs' });

  test('a Library sheet choice opens its page, and Back returns to the page under the sheet', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/clients');
    await tabBar(page).getByRole('button', { name: 'Library' }).click();
    await page.getByRole('dialog', { name: 'Library' }).getByRole('link', { name: /^Programs/ }).tap();
    await expect(page).toHaveURL(/\/programs$/);
    await expect(page.getByRole('dialog', { name: 'Library' })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a More sheet tile opens its page, and Back returns to the page under the sheet', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/clients');
    await tabBar(page).getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Community' }).tap();
    await expect(page).toHaveURL(/\/community$/);
    await expect(page.getByRole('dialog', { name: 'More' })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
