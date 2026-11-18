import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace, freshClient, seedLibraryWorkout, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// The one pop-up (AdaptiveDialog, docs/design/ui-rules.md §5 and §8): Back (and iOS swipe-back) closes it and stays on
// the page; with unsaved changes Back, Esc and × ask "Discard changes?" first. A sheet on phones and short windows,
// a centred dialog elsewhere, with its buttons always on screen.
const admin = serviceClient();
const created = { users: [] as string[], workouts: [] as string[] };
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});
test.afterAll(async () => {
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
});

async function seed() {
  const name = `Dialog ${unique()}`;
  const id = await seedLibraryWorkout(admin, workspaceId, name);
  created.workouts.push(id);
  return { id, name };
}

const sheetParam = (page: Page) => new URL(page.url()).searchParams.get('sheet');

test('Back closes the Assign pop-up and stays on Workouts; with clients picked it asks first', async ({ page }) => {
  const w = await seed();
  const last = `Dlg${unique()}`;
  created.users.push(await freshClient(admin, workspaceId, 'Ann', last));
  await signInAsCoach(page);
  await page.goto(`/workouts?q=${encodeURIComponent(w.name)}`);
  const assign = page.getByRole('button', { name: `Assign ${w.name}`, exact: true });
  const dialog = page.getByRole('dialog', { name: `Assign ${w.name}` });

  // Nothing changed: Back just closes it, and the list is still there.
  await assign.click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => sheetParam(page)).toBe(`assign-workout-${w.id}`);
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/workouts');
  expect(sheetParam(page)).toBeNull();
  await expect(assign).toBeFocused();

  // A client picked: Back asks, Keep editing keeps the pick.
  await assign.click();
  await dialog.getByLabel('Search clients').fill(last);
  const pick = dialog.getByRole('checkbox', { name: `Ann ${last}`, exact: true });
  await pick.check();
  await page.goBack();
  const ask = dialog.getByRole('group', { name: /Discard changes\?/ });
  await expect(ask).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(ask).toBeHidden();
  await expect(pick).toBeChecked();
  expect(sheetParam(page)).toBe(`assign-workout-${w.id}`);

  // Esc asks too; Discard closes it and takes its history step with it.
  await page.keyboard.press('Escape');
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => sheetParam(page)).toBeNull();
  expect(new URL(page.url()).pathname).toBe('/workouts');
});

test('focus starts where the work is: Assign on its search box, Rename on Name, Delete on Cancel', async ({ page }) => {
  const w = await seed();
  await signInAsCoach(page);
  await page.goto(`/workouts?q=${encodeURIComponent(w.name)}`);
  await page.getByRole('button', { name: `Assign ${w.name}`, exact: true }).click();
  const assign = page.getByRole('dialog', { name: `Assign ${w.name}` });
  await expect(assign.getByLabel('Search clients')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(assign).toBeHidden();

  const more = page.getByRole('button', { name: `More actions for ${w.name}` }).locator('visible=true');
  await more.click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename workout' });
  await expect(rename.getByLabel('Name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(rename).toBeHidden();

  await more.click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const del = page.getByRole('alertdialog');
  await expect(del.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(del).toBeHidden();
});

test('a leftover ?sheet= in a shared or reloaded link never makes closing leave the page', async ({ page }) => {
  const w = await seed();
  await signInAsCoach(page);
  await page.goto('/home');
  await page.goto(`/workouts?q=${encodeURIComponent(w.name)}&sheet=assign-workout-${w.id}`);
  await page.getByRole('button', { name: `Assign ${w.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Assign ${w.name}` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => sheetParam(page)).toBeNull();
  expect(new URL(page.url()).pathname).toBe('/workouts');
});

test('the disabled Assign button stays focusable and says why', async ({ page }) => {
  const w = await seed();
  await signInAsCoach(page);
  await page.goto(`/workouts?q=${encodeURIComponent(w.name)}`);
  await page.getByRole('button', { name: `Assign ${w.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Assign ${w.name}` });
  const send = dialog.getByRole('button', { name: 'Assign', exact: true });
  await expect(send).toHaveAttribute('aria-disabled', 'true');
  await expect(send).toHaveAccessibleDescription('Pick at least 1 client');
  await send.focus();
  await expect(send).toBeFocused();
});

for (const [label, size, sheet] of [
  ['iPhone', { width: 390, height: 844 }, true],
  ['iPhone SE', { width: 375, height: 667 }, true],
  ['phone landscape', { width: 844, height: 390 }, true],
  ['iPad portrait', { width: 820, height: 1180 }, false],
  ['desktop', { width: 1440, height: 900 }, false],
] as const) {
  test(`on ${label} Rename is a ${sheet ? 'bottom sheet' : 'centred dialog'} with its buttons on screen`, async ({ page }) => {
    await page.setViewportSize(size);
    // Measure the settled position, not the slide-in.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const w = await seed();
    await signInAsCoach(page);
    await page.goto(`/workouts?q=${encodeURIComponent(w.name)}`);
    const more = page.getByRole('button', { name: `More actions for ${w.name}` }).locator('visible=true');
    await more.click();
    if (size.width < 600) await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
    else await page.getByRole('menuitem', { name: 'Rename' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename workout' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    const view = page.viewportSize()!;
    if (sheet) {
      expect(Math.round(box.y + box.height)).toBe(view.height);
      expect(Math.round(box.width)).toBe(view.width);
    } else {
      expect(Math.abs(box.y + box.height / 2 - view.height / 2)).toBeLessThan(4);
      expect(box.width).toBeLessThanOrEqual(560);
    }
    for (const name of ['Save', 'Cancel', 'Close']) {
      const b = (await dialog.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(view.height);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Unchanged name: Back closes it at once.
    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(new URL(page.url()).pathname).toBe('/workouts');
  });
}
