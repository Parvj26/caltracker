import { devices, expect, test, type Page } from '@playwright/test';
import { demoWorkspace, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// The Workouts list's ⋯: Preview, Rename and Delete… on iPad and desktop (beside Assign and Duplicate); on an iPhone,
// Assign and ⋯, which opens a sheet from the bottom with Preview, Duplicate, Rename and Delete…. Delete asks first and
// refuses a workout a program still uses. Each test seeds its own workouts and removes what is left.

const admin = serviceClient();
const created = { workouts: [] as string[], programs: [] as string[] };
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});
test.afterAll(async () => {
  if (created.programs.length) await admin.from('programs').delete().in('id', created.programs);
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
});

async function seed(prefix: string): Promise<{ id: string; name: string }> {
  const name = `${prefix} ${unique()}`;
  const id = await seedLibraryWorkout(admin, workspaceId, name);
  created.workouts.push(id);
  return { id, name };
}

async function openList(page: Page, name: string) {
  await page.goto(`/workouts?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('table', { name: 'Workouts' }).getByRole('link', { name, exact: true })).toBeVisible();
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [device, size] of [
  ['iPad portrait', { width: 820, height: 1180 }],
  ['iPad landscape', { width: 1180, height: 820 }],
  ['desktop', { width: 1440, height: 900 }],
] as const) {
  test(`on ${device} ⋯ sits beside Assign and Duplicate and holds Preview, Rename and Delete…`, async ({ page }) => {
    await page.setViewportSize(size);
    const w = await seed('Menu');
    await signInAsCoach(page);
    await openList(page, w.name);
    const row = page.getByRole('row').filter({ hasText: w.name });
    await expect(row.getByRole('button', { name: `Assign ${w.name}` })).toBeVisible();
    await expect(row.getByRole('button', { name: `Duplicate ${w.name}` })).toBeVisible();
    const more = row.getByRole('button', { name: `More actions for ${w.name}` });
    const box = (await more.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await more.click();
    const menu = page.getByRole('menu', { name: `More actions for ${w.name}` });
    await expect(menu.getByRole('menuitem')).toHaveText(['Preview', 'Rename', 'Delete…']);
    expect(await noSidewaysScroll(page)).toBe(true);

    // Preview: read-only, its exercises with their sets.
    await menu.getByRole('menuitem', { name: 'Preview' }).click();
    const preview = page.getByRole('dialog', { name: w.name });
    await expect(preview.getByRole('list', { name: 'Exercises' }).getByRole('listitem')).toHaveCount(1);
    await expect(preview.getByText('Barbell Squat')).toBeVisible();
    await expect(preview.getByRole('textbox')).toHaveCount(0);
    await preview.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(preview).toBeHidden();
    await expect(more).toBeFocused();
  });
}

test('Rename saves the new name and keeps the exercises', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('Rename');
  await signInAsCoach(page);
  await openList(page, w.name);
  await page.getByRole('button', { name: `More actions for ${w.name}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename workout' });
  const field = dialog.getByRole('textbox', { name: 'Name' });
  await expect(field).toHaveValue(w.name);

  await field.fill('   ');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeVisible();

  const renamed = `${w.name} renamed`;
  await field.fill(renamed);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('table', { name: 'Workouts' }).getByRole('link', { name: renamed, exact: true })).toBeVisible();

  const row = await admin.from('workouts').select('name, workout_blocks(workout_exercises(id))').eq('id', w.id).single();
  expect(row.data?.name).toBe(renamed);
  expect(row.data?.workout_blocks.flatMap((b) => b.workout_exercises)).toHaveLength(1);
});

test('Delete… asks first, then removes an unused workout from the library', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('Delete');
  await signInAsCoach(page);
  await openList(page, w.name);
  const more = page.getByRole('button', { name: `More actions for ${w.name}` });

  // Cancel keeps it.
  await more.click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const ask = page.getByRole('alertdialog', { name: `Delete “${w.name}”?` });
  await expect(ask).toContainText("It's removed from your library. Workouts already on clients' calendars and their logged history stay.");
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toBeHidden();
  expect((await admin.from('workouts').select('id').eq('id', w.id)).data).toHaveLength(1);

  await more.click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await ask.getByRole('button', { name: 'Delete workout' }).click();
  await expect(ask).toBeHidden();
  await expect(page.getByRole('table', { name: 'Workouts' }).getByRole('link', { name: w.name, exact: true })).toHaveCount(0);
  expect((await admin.from('workouts').select('id').eq('id', w.id)).data).toHaveLength(0);
});

test('Delete… refuses a workout a program still uses, and the program keeps its day', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('InUse');
  const programId = await seedProgram(admin, workspaceId, `Uses ${unique()}`, 1, [{ week: 1, day: 1, workoutId: w.id }]);
  created.programs.push(programId);
  await signInAsCoach(page);
  await openList(page, w.name);
  await page.getByRole('button', { name: `More actions for ${w.name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const told = page.getByRole('alertdialog', { name: `“${w.name}” is still in use` });
  await expect(told).toContainText('Used in 1 program — remove it from that program first.');
  await expect(told.getByRole('button', { name: 'Delete workout' })).toHaveCount(0);
  await told.getByRole('button', { name: 'OK' }).click();
  await expect(told).toBeHidden();
  expect((await admin.from('workouts').select('id').eq('id', w.id)).data).toHaveLength(1);
  expect((await admin.from('program_workouts').select('id').eq('program_id', programId)).data).toHaveLength(1);
});

test.describe('iPhone', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
  test.use({ ...iphone13 });

  for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
    test(`at ${viewport.width} a row shows Assign and ⋯, which opens a sheet with all four actions`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const w = await seed('Phone');
      await signInAsCoach(page);
      await openList(page, w.name);
      const row = page.getByRole('table', { name: 'Workouts' }).locator('tbody tr').filter({ hasText: w.name });
      await expect(row.getByRole('button', { name: `Assign ${w.name}` })).toBeVisible();
      await expect(row.getByRole('button', { name: `Duplicate ${w.name}` })).toBeHidden();
      const more = row.getByRole('button', { name: `More actions for ${w.name}` });
      await expect(more).toBeVisible();
      const box = (await more.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(await noSidewaysScroll(page)).toBe(true);

      await more.click();
      const sheet = page.getByRole('dialog', { name: w.name });
      const items = sheet.getByRole('button').filter({ hasNotText: 'Close' });
      await expect(items).toHaveText(['Preview', 'Duplicate', 'Rename', 'Delete…']);
      for (const item of await items.all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const sheetBox = (await sheet.boundingBox())!;
      expect(Math.round(sheetBox.y + sheetBox.height)).toBe(viewport.height);

      // Escape closes it; Rename from the sheet opens the rename window.
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await more.click();
      await sheet.getByRole('button', { name: 'Rename' }).click();
      const rename = page.getByRole('dialog', { name: 'Rename workout' });
      await expect(rename.getByRole('textbox', { name: 'Name' })).toHaveValue(w.name);
      await expect(rename.getByRole('button', { name: 'Save' })).toBeInViewport({ ratio: 1 });
      await rename.getByRole('button', { name: 'Cancel' }).click();
      await expect(rename).toBeHidden();

      // Delete… from the sheet asks first.
      await more.click();
      await sheet.getByRole('button', { name: 'Delete…' }).click();
      const ask = page.getByRole('alertdialog', { name: `Delete “${w.name}”?` });
      await expect(ask.getByRole('button', { name: 'Delete workout' })).toBeEnabled();
      await ask.getByRole('button', { name: 'Delete workout' }).click();
      await expect(ask).toBeHidden();
      await expect(row).toHaveCount(0);
    });
  }

  test('Duplicate from the sheet makes the copy and opens it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const w = await seed('PhoneCopy');
    await signInAsCoach(page);
    await openList(page, w.name);
    await page.getByRole('button', { name: `More actions for ${w.name}` }).click();
    await page.getByRole('dialog', { name: w.name }).getByRole('button', { name: 'Duplicate' }).click();
    await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
    const copy = page.url().split('/').pop()!;
    created.workouts.push(copy);
    expect(copy).not.toBe(w.id);
    expect((await admin.from('workouts').select('name').eq('id', copy).single()).data?.name).toBe(`${w.name} (copy)`);
  });
});
