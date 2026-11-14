import { expect, test, type Page } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';

// iPhone-width coach menu (round 2, "Option B"): below the 600 px tablet breakpoint the side rail gives way to a tab
// bar fixed to the bottom (Home, Clients, Messages, Programs, More). More opens the rest of the menu as a bottom sheet
// of big tiles. iPad and desktop keep the side menu.

const IPHONE = { width: 390, height: 844 };
const TABS = ['Home', 'Clients', 'Messages', 'Programs', 'More'];
const TILES = ['Workouts', 'Exercises', 'Meals', 'Activity', 'Community', 'Help', 'Profile'];
const LIME = 'rgb(200, 241, 105)';
// A seeded demo client (supabase/seed.sql).
const CLIENT_ID = '00000000-0000-4000-8000-0000000000c2';

const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Tabs' });
const more = (page: Page) => tabBar(page).getByRole('button', { name: 'More' });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'More' });
const tabNames = (page: Page) =>
  tabBar(page)
    .locator('a, button')
    .evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/, \d+ unread$/, '').trim()));

test.describe('on an iPhone', () => {
  test.use({ viewport: IPHONE, hasTouch: true, isMobile: true });

  test('a tab bar sits at the bottom instead of the side rail', async ({ page }) => {
    await signInAsCoach(page);
    await expect(page.locator('[data-coach-sidebar]')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
    await expect(tabBar(page)).toBeVisible();
    expect(await tabNames(page)).toEqual(TABS);
    const bar = (await tabBar(page).boundingBox())!;
    expect(bar.x).toBe(0);
    expect(bar.width).toBe(IPHONE.width);
    expect(bar.y + bar.height).toBe(IPHONE.height);
    expect(bar.height).toBe(64);
    for (const tab of await tabBar(page).locator('a, button').all()) {
      const box = (await tab.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
    // Page content uses the full width, and nothing pushes the page wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(IPHONE.width);
    const main = (await page.locator('#main-content').boundingBox())!;
    expect(main.x).toBe(0);
    expect(main.width).toBe(IPHONE.width);
  });

  test('the tab for the current page is highlighted', async ({ page }) => {
    await signInAsCoach(page);
    const clients = tabBar(page).getByRole('link', { name: 'Clients' });
    await expect(clients).toHaveAttribute('aria-current', 'page');
    await expect(clients.locator('span').first()).toHaveCSS('background-color', LIME);
    await expect(tabBar(page).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page');
    await tabBar(page).getByRole('link', { name: 'Programs' }).click();
    await expect(page).toHaveURL(/\/programs$/);
    await expect(tabBar(page).getByRole('link', { name: 'Programs' })).toHaveAttribute('aria-current', 'page');
    await expect(clients).not.toHaveAttribute('aria-current', 'page');
  });

  test('More opens the other pages as a sheet of tiles above the tab bar', async ({ page }) => {
    await signInAsCoach(page);
    await more(page).click();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(more(page).locator('span').first()).toHaveCSS('background-color', LIME);
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();
    const tiles = dialog.locator('a[aria-label]:visible');
    expect(await tiles.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(TILES);
    for (const tile of await tiles.all()) {
      expect(Math.round((await tile.boundingBox())!.height)).toBe(96);
    }
    // Three tiles to a row, running on across both groups (Help sits beside Community).
    const boxes = await Promise.all([0, 2, 3, 4, 5, 6].map(async (i) => (await tiles.nth(i).boundingBox())!));
    const [first, third, fourth, fifth, help, profile] = boxes as [typeof boxes[0], typeof boxes[0], typeof boxes[0], typeof boxes[0], typeof boxes[0], typeof boxes[0]];
    expect(third.y).toBe(first.y);
    expect(fourth.y).toBeGreaterThan(first.y);
    expect(help.y).toBe(fifth.y);
    expect(profile.y).toBeGreaterThan(help.y);
    // The sheet ends where the tab bar starts, and the bar stays in front.
    const sheetBox = (await dialog.boundingBox())!;
    const bar = (await tabBar(page).boundingBox())!;
    expect(Math.round(sheetBox.y + sheetBox.height)).toBe(Math.round(bar.y));
    await expect(dialog.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy' })).toBeVisible();
    await expect(dialog.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Terms' })).toBeVisible();
    // Sign out lives on Profile now.
    await expect(dialog.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  });

  test('a tile navigates and closes the sheet, and More is then the current tab', async ({ page }) => {
    await signInAsCoach(page);
    await more(page).click();
    await sheet(page).getByRole('link', { name: 'Workouts' }).click();
    await expect(page).toHaveURL(/\/workouts$/);
    await expect(sheet(page)).toBeHidden();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(more(page).locator('span').first()).toHaveCSS('background-color', LIME);
    await more(page).click();
    await expect(sheet(page).getByRole('link', { name: 'Workouts' })).toHaveAttribute('aria-current', 'page');
  });

  test('Escape, the backdrop and More itself close the sheet; focus returns to More', async ({ page }) => {
    await signInAsCoach(page);
    await more(page).click();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await expect(more(page)).toBeFocused();

    await more(page).click();
    await expect(sheet(page)).toBeVisible();
    // The dimmed area above the sheet.
    await page.mouse.click(IPHONE.width / 2, 40);
    await expect(sheet(page)).toBeHidden();
    await expect(more(page)).toBeFocused();

    await more(page).click();
    await expect(sheet(page)).toBeVisible();
    await more(page).click();
    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\/clients$/);
  });

  test('Tab stays inside the open sheet and More', async ({ page }) => {
    await signInAsCoach(page);
    await more(page).focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toBeVisible();
    const inside = () =>
      page.evaluate(() => {
        const active = document.activeElement;
        return !!active && (document.getElementById('coach-menu')!.contains(active) || active.getAttribute('aria-controls') === 'coach-menu');
      });
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      expect(await inside()).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await inside()).toBe(true);
  });

  test('nothing at the bottom of a long page hides behind the tab bar, which stays put while scrolling', async ({ page }) => {
    test.slow();
    await signInAsCoach(page);
    await page.goto('/workouts');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Make the page long, however many workouts the run has made, ending in a marker.
    await page.locator('#main-content').evaluate((el) => {
      const pad = document.createElement('div');
      pad.style.height = '3000px';
      const end = document.createElement('p');
      end.id = 'page-end';
      end.textContent = 'The end';
      el.append(pad, end);
    });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(tabBar(page)).toBeInViewport({ ratio: 1 });
    const end = (await page.locator('#page-end').boundingBox())!;
    const bar = (await tabBar(page).boundingBox())!;
    expect(end.y + end.height).toBeLessThanOrEqual(bar.y);
    // Scrolling back up a little doesn't move it either (no tucking away).
    await page.evaluate(() => window.scrollBy(0, -300));
    expect((await tabBar(page).boundingBox())!.y).toBe(bar.y);
    // Toasts and bottom bars lift by --coach-menu-room: exactly the bar's height.
    const room = await page.locator('#main-content').evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;height:var(--coach-menu-room)';
      el.append(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    });
    expect(room).toBe(bar.height);
  });

  test('on a chat the tab bar is hidden and the message box reaches the bottom', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto(`/messages/${CLIENT_ID}`);
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await expect(tabBar(page)).toBeHidden();
  });

  test('on the workout editor the save bar is at the top, clear of the tab bar', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/workouts/new');
    const save = (await page.getByRole('button', { name: 'Save workout' }).boundingBox())!;
    const bar = (await tabBar(page).boundingBox())!;
    expect(save.y + save.height).toBeLessThan(bar.y);
  });
});

test.describe('the Messages tab shows the unread count', () => {
  test.use({ viewport: IPHONE, hasTouch: true, isMobile: true });
  const admin = serviceClient();
  let clientId: string | undefined;

  test.afterEach(async () => {
    // Deleting the user removes their conversation and messages with it.
    if (clientId) await admin.auth.admin.deleteUser(clientId);
    clientId = undefined;
  });

  test('a new message from a client shows on the Messages tab', async ({ page }) => {
    test.slow();
    const { data: ws, error } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
    if (error) throw error;
    const created = await admin.auth.admin.createUser({
      email: `tabbar-${Date.now()}${Math.floor(Math.random() * 1e5)}@example.com`,
      password: 'client-password-123',
      email_confirm: true,
      user_metadata: { first_name: 'Tabby', last_name: 'Unread' },
    });
    if (created.error) throw created.error;
    clientId = created.data.user.id;
    const member = await admin.from('workspace_members').insert({ workspace_id: ws.id, user_id: clientId, role: 'client' });
    if (member.error) throw member.error;
    const convo = await admin.from('conversations').insert({ workspace_id: ws.id, client_id: clientId }).select('id').single();
    if (convo.error) throw convo.error;
    const sent = await admin.from('messages').insert({ conversation_id: convo.data.id, workspace_id: ws.id, sender_id: clientId, body: 'Hi coach' });
    if (sent.error) throw sent.error;

    await signInAsCoach(page);
    const messages = tabBar(page).getByRole('link', { name: /^Messages/ });
    await expect(messages).toHaveAttribute('aria-label', /^Messages, \d+ unread$/);
    // The red number matches the count in the name (read together: other tests may change the total meanwhile).
    const { label, badge } = await messages.evaluate((el) => ({
      label: el.getAttribute('aria-label') ?? '',
      badge: el.querySelector('[data-tab-badge]')?.textContent ?? '',
    }));
    const count = Number(/(\d+) unread/.exec(label)![1]);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(badge).toBe(count > 99 ? '99+' : String(count));
    await expect(messages.locator('[data-tab-badge]')).toHaveCSS('background-color', 'rgb(179, 38, 30)');
  });
});

for (const [device, size] of [['iPad', { width: 820, height: 1180 }], ['desktop', { width: 1440, height: 900 }]] as const) {
  test(`on ${device} the side menu stays and there is no tab bar`, async ({ page }) => {
    await page.setViewportSize(size);
    await signInAsCoach(page);
    await expect(page.locator('[data-coach-sidebar]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workouts' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Messages/ })).toBeVisible();
    await expect(tabBar(page)).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'More' })).toHaveCount(0);
  });
}
