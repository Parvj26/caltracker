import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { demoWorkspace, seedLibraryWorkout, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// Phone fixes, batch 2: cramped windows and forms, small tap targets and caption size (2026-11-11 phone audit).
// Chromium with iPhone sizes and touch (the browser can't be chosen per spec). Each CI shard starts from a fresh
// database, so a test that needs a workout or a post makes its own and removes it afterwards; the rest only open
// pages and windows and save nothing.

const admin = serviceClient();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
const SE = { width: 375, height: 667 };
// The seeded demo client (supabase/seed.sql).
const CLIENT = '/clients/00000000-0000-4000-8000-0000000000c2';

const created = { workouts: [] as string[], users: [] as string[] };
test.afterAll(async () => {
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
  // Deleting a user takes their community posts with them.
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Tabs' });

/** The control's box is at least 44 px tall (and, with `wide`, 44 px wide). */
async function expectTappable(control: Locator, { wide = false } = {}) {
  const box = (await control.boundingBox())!;
  expect(box.height, 'tap target height').toBeGreaterThanOrEqual(44);
  if (wide) expect(box.width, 'tap target width').toBeGreaterThanOrEqual(44);
}

// The iPhone 13's screen is 390 x 844, but Safari's bars leave a 390 x 664 page area (Playwright's iPhone 13 viewport).
const IPHONE13_VIEWPORT = iphone13.viewport;

test.describe('iPhone 13 (390 x 664 page area)', () => {
  test.use({ ...iphone13 });

  test('Assign fills the screen: the client list gets the room and the buttons stay at the bottom', async ({ page }) => {
    const name = `Phone assign ${unique()}`;
    created.workouts.push(await seedLibraryWorkout(admin, await demoWorkspace(admin), name));
    await signInAsCoach(page);
    await page.goto(`/workouts?q=${encodeURIComponent(name)}`);
    await page.getByRole('button', { name: `Assign ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Assign ${name}` });
    await expect(dialog.getByRole('list', { name: 'Clients' })).toBeVisible();

    // Edge to edge: the window's own 640 px / 100dvh - 32 px cap (calendar.module.css) would leave a gap.
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(IPHONE13_VIEWPORT.width);
    expect(Math.round(box.height)).toBe(IPHONE13_VIEWPORT.height);
    // At least four names' worth of list (it showed about two before).
    expect((await dialog.getByRole('list', { name: 'Clients' }).boundingBox())!.height).toBeGreaterThanOrEqual(176);
    for (const button of [dialog.getByRole('button', { name: 'Cancel' }), dialog.getByRole('button', { name: 'Assign', exact: true })]) {
      await expect(button).toBeInViewport({ ratio: 1 });
      await expectTappable(button);
    }
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('a community post keeps Delete behind ⋯, and it still asks first', async ({ page }) => {
    const ws = await demoWorkspace(admin);
    const community = await admin.from('communities').select('id').eq('workspace_id', ws).eq('is_default', true).single();
    if (community.error) throw community.error;
    const email = `phone-community-${unique()}@example.com`;
    const user = await admin.auth.admin.createUser({ email, password: 'client-password-123', email_confirm: true, user_metadata: { first_name: 'Pia', last_name: 'Phone' } });
    if (user.error) throw user.error;
    created.users.push(user.data.user.id);
    const member = await admin.from('workspace_members').insert({ workspace_id: ws, user_id: user.data.user.id, role: 'client' });
    if (member.error) throw member.error;
    const phone = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await phone.auth.signInWithPassword({ email, password: 'client-password-123' });
    if (signedIn.error) throw signedIn.error;
    const body = `Phone post ${unique()}`;
    const made = await phone.rpc('create_community_post', { p_id: crypto.randomUUID(), p_community_id: community.data.id, p_body: body });
    if (made.error) throw made.error;

    await signInAsCoach(page);
    await page.goto('/community');
    const post = page.getByTestId('community-post').filter({ hasText: body });
    await expect(post.getByRole('button', { name: 'Pin', exact: true })).toBeVisible();
    await expect(post.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    const more = post.getByRole('button', { name: 'More for this post' });
    await expectTappable(more, { wide: true });

    // Saying no to the question keeps the post.
    await more.click();
    page.once('dialog', (d) => void d.dismiss());
    await post.getByRole('menuitem', { name: 'Delete post' }).click();
    await expect(post).toHaveCount(1);

    page.once('dialog', (d) => void d.accept());
    await more.click();
    await post.getByRole('menuitem', { name: 'Delete post' }).click();
    await expect(post).toHaveCount(0);
  });

  test('the message Back link is a full 44 x 44 tap target', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto(`/messages/${CLIENT.split('/').at(-1)}`);
    const back = page.getByRole('link', { name: 'Back to all conversations' });
    await expect(back).toBeVisible();
    await expectTappable(back, { wide: true });
  });
});

test.describe('iPhone SE (375 x 667)', () => {
  test.use({ ...iphone13, viewport: SE });

  test('Add a scan fills the screen with Save in reach, and × closes it', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto(`${CLIENT}/body`);
    await page.getByRole('button', { name: 'Add scan' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a scan' });
    await expect(dialog).toBeVisible();
    expect(Math.round((await dialog.boundingBox())!.height)).toBe(SE.height);
    await expect(dialog.getByRole('button', { name: 'Save scan' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
    const close = dialog.getByRole('button', { name: 'Close' });
    await expectTappable(close, { wide: true });
    await close.click();
    await expect(dialog).toBeHidden();
  });

  test('the invite plan choice is three stacked full-width rows', async ({ page }) => {
    await signInAsCoach(page);
    await page.getByRole('button', { name: '+ Invite client' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a client' });
    const boxes = await Promise.all(
      ['Program', 'Single workout', 'Nothing yet'].map(async (n) => (await dialog.getByRole('button', { name: n, exact: true }).boundingBox())!),
    );
    const [program, single, nothing] = boxes as [NonNullable<(typeof boxes)[0]>, NonNullable<(typeof boxes)[0]>, NonNullable<(typeof boxes)[0]>];
    expect(single.x).toBe(program.x);
    expect(nothing.x).toBe(program.x);
    expect(single.width).toBe(program.width);
    expect(single.y).toBeGreaterThanOrEqual(program.y + program.height + 8);
    expect(nothing.y).toBeGreaterThanOrEqual(single.y + single.height + 8);
    for (const b of boxes) expect(b.height).toBeGreaterThanOrEqual(44);
    // Choosing still works the same way.
    await dialog.getByRole('button', { name: 'Program', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Program', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the meal form has 48 px fields and its Save bar stays on screen, with the tab bar out of the way', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/meals/new');
    const form = page.getByRole('form', { name: 'New meal' });
    await form.getByLabel('Name').scrollIntoViewIfNeeded();
    await expect(tabBar(page)).toBeHidden();
    for (const label of ['Name', 'kcal', 'Protein g', 'Carbs g', 'Fat g']) {
      expect((await form.getByLabel(label, { exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    await expect(form.getByRole('button', { name: 'Save' })).toBeInViewport({ ratio: 1 });
    await expect(form.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
  });

  test('Documents has a big Choose a file button', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto(`${CLIENT}/documents`);
    const choose = page.getByText('Choose a file', { exact: true });
    await expect(choose).toBeVisible();
    expect((await choose.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    // The real file field is still there under its name.
    await expect(page.getByLabel('File', { exact: true })).toHaveCount(1);
  });

  test('captions are 13 px on an iPhone', async ({ page }) => {
    await signInAsCoach(page);
    const size = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ct-size-caption').trim());
    expect(size).toBe('13px');
  });

  test('the sign-in Privacy and Terms links are 44 x 44', async ({ page }) => {
    await page.goto('/sign-in');
    const legal = page.getByRole('navigation', { name: 'Legal' });
    for (const name of ['Privacy', 'Terms']) await expectTappable(legal.getByRole('link', { name }), { wide: true });
  });
});

test.describe('iPad (820 x 1180)', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('captions stay 12 px', async ({ page }) => {
    await signInAsCoach(page);
    const size = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ct-size-caption').trim());
    expect(size).toBe('12px');
  });
});
