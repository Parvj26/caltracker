import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { signInAsCoach } from './helpers';

// The coach website on an iPhone (393 x 659, touch). Three things that make a phone feel broken:
// - the page scrolls sideways (something is wider than the screen);
// - Safari zooms in when a field under 16 px gets focus;
// - a control is shorter than 44 px, Apple's smallest comfortable tap target.
// Read-only: it only opens pages and dialogs, never saves.
// iPhone 15 sizes and touch, on Chromium like the rest of the suite (the browser can't be chosen per spec).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone } = devices['iPhone 15'];
test.use({ ...iphone, viewport: { width: 393, height: 659 } });

// The seeded demo client (supabase/seed.sql).
const CLIENT = '/clients/00000000-0000-4000-8000-0000000000c2';

const ROUTES = [
  '/home',
  '/clients',
  CLIENT,
  `${CLIENT}/training`,
  `${CLIENT}/body`,
  `${CLIENT}/food`,
  `${CLIENT}/documents`,
  `${CLIENT}/settings`,
  '/workouts',
  '/workouts/new',
  '/programs',
  '/programs/new',
  '/exercises',
  '/exercises/new',
  '/meals',
  '/meals/new',
  '/messages',
  '/messages/00000000-0000-4000-8000-0000000000c2',
  '/activity',
  '/community',
  '/community/reports',
  '/profile',
];

/** Visible text fields under 16 px (Safari zooms in on focus), as "label 15px". */
async function smallFields(page: Page, within?: Locator): Promise<string[]> {
  const scope = within ?? page.locator('body');
  return scope.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>(
      'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]),select,textarea',
    )]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden';
      })
      .map((el) => [el, parseFloat(getComputedStyle(el).fontSize)] as const)
      .filter(([, size]) => size < 16)
      .map(([el, size]) => `${el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.getAttribute('name') ?? el.tagName} ${size}px`),
  );
}

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${innerWidth}px screen`).toBeLessThanOrEqual(innerWidth);
}

/** Every matching visible control is at least 44 px tall (and, with `wide`, 44 px wide). */
async function expectTappable(controls: Locator, { wide = false } = {}) {
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    // Inline links report one box per line; the tap area is the line box, padding included.
    const box = await control.evaluate((el) => {
      const rects = [...el.getClientRects()];
      return { w: Math.max(...rects.map((r) => r.width)), h: Math.max(...rects.map((r) => r.height)) };
    });
    const name = (await control.getAttribute('aria-label')) ?? (await control.innerText()).trim();
    expect(box.h, `"${name}" is ${Math.round(box.h)}px tall`).toBeGreaterThanOrEqual(44);
    if (wide) expect(box.w, `"${name}" is ${Math.round(box.w)}px wide`).toBeGreaterThanOrEqual(44);
  }
}

test.beforeEach(async ({ page }) => {
  await signInAsCoach(page);
});

test('no coach page scrolls sideways or has a field that makes Safari zoom', async ({ page }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    if (scrollWidth > innerWidth) problems.push(`${route}: ${scrollWidth}px wide`);
    for (const f of await smallFields(page)) problems.push(`${route}: ${f}`);
  }
  expect(problems).toEqual([]);
});

test('the rail legal links and the clients list are easy to tap', async ({ page }) => {
  await page.goto('/clients');
  await expectTappable(page.getByRole('navigation', { name: 'Legal' }).getByRole('link'), { wide: true });
  const table = page.getByRole('table', { name: 'Clients' });
  await expect(table.getByRole('link').first()).toBeVisible();
  await expectTappable(table.getByRole('link'));
});

test('client overview links, calendar controls and other small links are easy to tap', async ({ page }) => {
  await page.goto(CLIENT);
  await expectTappable(page.getByRole('link', { name: 'See bests and stickers' }));
  await expectTappable(page.getByRole('link', { name: /^(Add scan|All scans|See all scans)$/ }));

  await page.goto(`${CLIENT}/training`);
  await expectTappable(page.getByRole('navigation', { name: 'Calendar view' }).getByRole('link'));
  await expectTappable(page.getByRole('link', { name: /^(Previous|Next) / }), { wide: true });

  await page.goto('/messages/00000000-0000-4000-8000-0000000000c2');
  await expectTappable(page.getByRole('link', { name: /^(Calendar|Client page)$/ }));

  await page.goto('/community/reports');
  await expectTappable(page.getByRole('link', { name: '← Community' }));

  await page.goto('/home');
  await expectTappable(page.getByRole('link', { name: 'Plan workouts in Programs' }));
});

test('the client tabs show that they scroll', async ({ page }) => {
  await page.goto(CLIENT);
  const tabs = page.getByRole('navigation', { name: 'Client sections' });
  await expect(tabs).toHaveAttribute('data-more-after', '');
  await tabs.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(tabs).not.toHaveAttribute('data-more-after', '');
  await expect(tabs).toHaveAttribute('data-more-before', '');
});

test('the invite window fits, has no zooming fields and big enough choices', async ({ page }) => {
  await page.goto('/clients');
  await page.getByRole('button', { name: '+ Invite client' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a client' });
  await expect(dialog).toBeVisible();
  await expectNoSidewaysScroll(page);
  expect(await smallFields(page, dialog)).toEqual([]);
  await expectTappable(dialog.getByRole('tab'));
  await expectTappable(dialog.getByRole('button', { name: /^(Program|Single workout|Nothing yet)$/ }));
});

test('the Add scan window has no zooming fields', async ({ page }) => {
  await page.goto(`${CLIENT}/body`);
  await page.getByRole('button', { name: 'Add scan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a scan' });
  await expect(dialog).toBeVisible();
  await expectNoSidewaysScroll(page);
  expect(await smallFields(page, dialog)).toEqual([]);
});

test('the meal editor and the message composer have no zooming fields and big enough buttons', async ({ page }) => {
  await page.goto('/meals/new');
  await expect(page.getByRole('button', { name: 'Add photo' })).toBeVisible();
  expect(await smallFields(page, page.locator('main'))).toEqual([]);
  await expectTappable(page.getByRole('button', { name: 'Add photo' }));

  await page.goto('/messages/00000000-0000-4000-8000-0000000000c2');
  const composer = page.getByRole('textbox', { name: 'Message' });
  await expect(composer).toBeVisible();
  expect(await smallFields(page, page.locator('main'))).toEqual([]);
  await expectNoSidewaysScroll(page);
});

test('a tap on a link shows the loading bar straight away', async ({ page }) => {
  await page.goto('/clients');
  // Hold the next page back so the bar has time to show.
  await page.route(/\/programs/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  // On an iPhone the menu is the floating button's sheet of tiles.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Programs' }).click();
  await expect(page.getByTestId('nav-progress')).toBeVisible({ timeout: 1000 });
  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByTestId('nav-progress')).toBeHidden();
  // Going back to the page the tap was made on doesn't bring the bar back.
  await page.unrouteAll();
  await page.goBack();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('nav-progress')).toHaveCount(0);
});
