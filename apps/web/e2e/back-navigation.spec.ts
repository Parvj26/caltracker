import { devices, expect, test, type Page } from '@playwright/test';
import { demoWorkspace, freshClient, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';
import { programCell, serviceClient, signInAsCoach, openProgramSettings } from './helpers';

// Back and iOS swipe-back go exactly one step (ui-rules §8): every sheet, pop-up, menu and full-screen editor is one
// step of history, so Back closes it and stays on the page under it; a page with unsaved changes asks "Discard
// changes?" before Back or a link leaves it. page.goBack() stands in for the swipe.
const admin = serviceClient();
const created: { workouts: string[]; programs: string[]; users: string[] } = { workouts: [], programs: [], users: [] };
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});
test.afterAll(async () => {
  if (created.programs.length) await admin.from('programs').delete().in('name', created.programs);
  if (created.workouts.length) await admin.from('workouts').delete().in('name', created.workouts).is('client_id', null);
  if (created.workouts.length) await admin.from('workouts').delete().like('name', 'Back nav % (copy)%').is('client_id', null);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

async function seedWorkout(prefix = 'Back nav') {
  const name = `${prefix} ${unique()}`;
  created.workouts.push(name);
  const id = await seedLibraryWorkout(admin, workspaceId, name);
  return { id, name };
}

const row = (page: Page) => page.getByRole('button', { name: /^Barbell Squat: / });
const editor = (page: Page) => page.getByRole('dialog', { name: 'Barbell Squat', exact: true });
const discard = (page: Page) => page.getByRole('alertdialog', { name: 'Discard changes?' });
const path = (page: Page) => new URL(page.url()).pathname;

/** Opens the workout from the Workouts list with a tap on its link (an in-app navigation, like a coach does). */
async function openFromList(page: Page, w: { id: string; name: string }) {
  await page.goto(`/workouts?q=${encodeURIComponent(w.name)}`);
  await page.getByRole('link', { name: w.name, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/workouts/${w.id}$`));
}

test.describe('iPhone', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  test.use({ ...iphone, viewport: { width: 390, height: 844 } });

  test('Back from the exercise editor returns to the workout, not the Workouts list (the reported bug)', async ({ page }) => {
    const w = await seedWorkout();
    await signInAsCoach(page);
    await openFromList(page, w);
    await row(page).click();
    await expect(editor(page)).toBeVisible();

    await page.goBack();
    await expect(editor(page)).toBeHidden();
    expect(path(page)).toBe(`/workouts/${w.id}`);
    await expect(row(page)).toBeVisible();
    // Focus goes back to the row that opened it.
    await expect(row(page)).toBeFocused();

    // Done closes it too, and then one Back leaves the workout for the list.
    await row(page).click();
    await editor(page).getByRole('button', { name: 'Done' }).click();
    await expect(editor(page)).toBeHidden();
    await expect(row(page)).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/workouts\?q=/);
  });

  test('edits in the editor survive Back; Back from the workout then asks before throwing them away', async ({ page }) => {
    const w = await seedWorkout();
    await signInAsCoach(page);
    await openFromList(page, w);
    await row(page).click();
    await editor(page).getByLabel('Reps', { exact: true }).first().fill('77');
    await page.goBack();
    await expect(editor(page)).toBeHidden();
    expect(path(page)).toBe(`/workouts/${w.id}`);
    await expect(row(page)).toContainText('77');
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    // Back from the workout itself: asked first. Keep editing stays with the edit.
    await page.goBack();
    await expect(discard(page)).toBeVisible();
    await discard(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(discard(page)).toBeHidden();
    expect(path(page)).toBe(`/workouts/${w.id}`);
    await expect(row(page)).toContainText('77');

    // Back again, Discard: on to the list.
    await page.goBack();
    await discard(page).getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/workouts\?q=/);
  });

  test('the More sheet, the exercise ⋯ menu and the picker close on Back; picks not yet added ask first', async ({ page }) => {
    const w = await seedWorkout();
    await signInAsCoach(page);
    await openFromList(page, w);

    await page.getByRole('button', { name: 'More', exact: true }).click();
    const more = page.getByRole('dialog', { name: 'More' });
    await expect(more).toBeVisible();
    await page.goBack();
    await expect(more).toBeHidden();
    expect(path(page)).toBe(`/workouts/${w.id}`);

    // Nested: editor, then its ⋯ menu. Back closes the menu, then the editor.
    await row(page).click();
    await editor(page).getByRole('button', { name: /^More for Barbell Squat|^Options for Barbell Squat|Barbell Squat options/ }).click();
    const menu = editor(page).getByRole('menu');
    await expect(menu).toBeVisible();
    await page.goBack();
    await expect(menu).toBeHidden();
    await expect(editor(page)).toBeVisible();
    await page.goBack();
    await expect(editor(page)).toBeHidden();
    expect(path(page)).toBe(`/workouts/${w.id}`);

    await page.getByRole('button', { name: '+ Exercise', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add exercises' });
    await expect(picker).toBeVisible();
    await page.goBack();
    await expect(picker).toBeHidden();
    expect(path(page)).toBe(`/workouts/${w.id}`);

    await page.getByRole('button', { name: '+ Exercise', exact: true }).click();
    await picker.getByLabel('Search exercises').fill('Barbell Deadlift');
    await picker.getByRole('option', { name: 'Barbell Deadlift', exact: true }).click();
    await expect(picker.getByRole('button', { name: 'Add 1 exercise' })).toBeVisible();
    await page.goBack();
    const ask = picker.getByRole('group', { name: /Discard changes\?/ });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep picking' }).click();
    await expect(picker.getByRole('button', { name: 'Add 1 exercise' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Discard' }).click();
    await expect(picker).toBeHidden();
    expect(path(page)).toBe(`/workouts/${w.id}`);
    await page.goBack();
    await expect(page).toHaveURL(/\/workouts\?q=/);
  });

  test('the Library and More sheets of the tab bar close on Back', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/programs');
    const tabs = page.getByRole('navigation', { name: 'Tabs' });
    await tabs.getByRole('button', { name: 'Library' }).click();
    const sheet = page.getByRole('dialog', { name: 'Library' });
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    expect(path(page)).toBe('/programs');

    await tabs.getByRole('button', { name: 'More' }).click();
    const more = page.getByRole('dialog', { name: 'More' });
    await expect(more).toBeVisible();
    await page.goBack();
    await expect(more).toBeHidden();
    expect(path(page)).toBe('/programs');

    // A choice in the sheet: one Back from the new page returns here (no leftover step for the sheet).
    await tabs.getByRole('button', { name: 'Library' }).click();
    await sheet.getByRole('link', { name: /^Workouts/ }).click();
    await expect(page).toHaveURL(/\/workouts$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/programs$/);
    await expect(sheet).toBeHidden();
  });

  test('program day: the sheet, then Edit workout, then an exercise, unwind one Back at a time', async ({ page }) => {
    const w = await seedWorkout('Day');
    const program = `Back plan ${unique()}`;
    created.programs.push(program);
    const pid = await seedProgram(admin, workspaceId, program, 1, [{ week: 1, day: 1, workoutId: w.id }]);
    await signInAsCoach(page);
    await page.goto(`/programs/${pid}`);
    await programCell(page, 1, 1).getByRole('button', { name: w.name, exact: true }).click();
    const summary = page.getByRole('dialog', { name: w.name, exact: true });
    await summary.getByRole('button', { name: 'Edit workout' }).click();
    const sheet = page.getByRole('dialog', { name: `Edit ${w.name}` });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: /^Barbell Squat: / }).click();
    await expect(editor(page)).toBeVisible();

    await page.goBack();
    await expect(editor(page)).toBeHidden();
    await expect(sheet).toBeVisible();
    expect(path(page)).toBe(`/programs/${pid}`);

    // With an edit, Back from the sheet asks (the sheet's own question), and Keep editing keeps it open.
    await sheet.getByRole('button', { name: /^Barbell Squat: / }).click();
    await editor(page).getByLabel('Reps', { exact: true }).first().fill('66');
    await page.goBack();
    await expect(editor(page)).toBeHidden();
    await page.goBack();
    const ask = page.getByRole('dialog', { name: 'Discard your changes?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep editing' }).click();
    await expect(sheet).toBeVisible();
    await page.goBack();
    await page.getByRole('dialog', { name: 'Discard your changes?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(sheet).toBeHidden();
    expect(path(page)).toBe(`/programs/${pid}`);
  });

  test('a new custom exercise with a name typed asks before Back leaves it', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/exercises');
    await page.goto('/exercises/new');
    await page.getByLabel('Name').fill('Half-typed exercise');
    await page.goBack();
    await expect(discard(page)).toBeVisible();
    await discard(page).getByRole('button', { name: 'Keep editing' }).click();
    expect(path(page)).toBe('/exercises/new');
    await expect(page.getByLabel('Name')).toHaveValue('Half-typed exercise');
    await page.goBack();
    await discard(page).getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/exercises$/);
  });
});

for (const [device, size] of [
  ['iPad portrait', { width: 820, height: 1180 }],
  ['iPad landscape', { width: 1180, height: 820 }],
  ['desktop', { width: 1440, height: 900 }],
] as const) {
  test.describe(device, () => {
    test.use({ viewport: size, ...(device === 'desktop' ? {} : { hasTouch: true }) });

    test(`${device}: unsaved builder edits ask before a sidebar link or Back leaves; the ⋯ menu closes on Back`, async ({ page }) => {
      const w = await seedWorkout();
      await signInAsCoach(page);
      await openFromList(page, w);

      // The workout's ⋯ (iPad portrait folds Duplicate and Delete behind it): Back folds it, the workout stays.
      const more = page.getByRole('button', { name: `More for ${w.name}`, exact: true });
      if (await more.isVisible()) {
        await more.click();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await page.goBack();
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        expect(path(page)).toBe(`/workouts/${w.id}`);
      }

      await page.getByLabel('Workout notes').fill('Half-written note');
      await expect(page.getByText('Unsaved changes')).toBeVisible();
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
      await expect(discard(page)).toBeVisible();
      await discard(page).getByRole('button', { name: 'Keep editing' }).click();
      expect(path(page)).toBe(`/workouts/${w.id}`);
      await expect(page.getByLabel('Workout notes')).toHaveValue('Half-written note');

      await page.goBack();
      await expect(discard(page)).toBeVisible();
      await discard(page).getByRole('button', { name: 'Keep editing' }).click();
      expect(path(page)).toBe(`/workouts/${w.id}`);

      // Discard on a link follows it, and Back from there comes back to the workout (one step).
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
      await discard(page).getByRole('button', { name: 'Discard' }).click();
      await expect(page).toHaveURL(/\/home$/);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/workouts/${w.id}$`));
    });

    test(`${device}: program details ask before leaving with an unsaved name`, async ({ page }) => {
      const program = `Back details ${unique()}`;
      created.programs.push(program);
      const pid = await seedProgram(admin, workspaceId, program, 1, []);
      await signInAsCoach(page);
      await page.goto('/programs');
      await page.goto(`/programs/${pid}`);
      await openProgramSettings(page);
      await page.getByLabel('Program name').fill(`${program} renamed`);
      await page.getByRole('link', { name: /Programs/ }).first().click();
      await expect(discard(page)).toBeVisible();
      await discard(page).getByRole('button', { name: 'Keep editing' }).click();
      expect(path(page)).toBe(`/programs/${pid}`);
      await page.goBack();
      await expect(discard(page)).toBeVisible();
      await discard(page).getByRole('button', { name: 'Discard' }).click();
      await expect(page).toHaveURL(/\/programs$/);
    });
  });
}

test.describe('iPad portrait exercises', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test('the exercise preview that covers the list goes back to the list on Back', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/exercises');
    await page.getByRole('option').first().click();
    const back = page.getByRole('button', { name: '← Back to list' });
    await expect(back).toBeVisible();
    await page.goBack();
    await expect(back).toBeHidden();
    expect(path(page)).toBe('/exercises');
    await expect(page.getByRole('option').first()).toBeVisible();
  });
});

test.describe('pages that change their own address, and code that navigates, with a layer open', () => {
  test('?add=workout opens Add a workout once: Back closes it, and neither Back nor a reload opens it again', async ({ page }) => {
    const clientId = await freshClient(admin, workspaceId, 'Addy', `Back${unique()}`);
    created.users.push(clientId);
    await signInAsCoach(page);
    await page.goto(`/clients/${clientId}/training?add=workout`);
    const add = page.getByRole('dialog', { name: 'Add a workout' });
    await expect(add).toBeVisible();
    // The page drops ?add= from its address while the dialog is open (the router must not put it back).
    await expect.poll(() => new URL(page.url()).searchParams.get('add')).toBeNull();
    await page.goBack();
    await expect(add).toBeHidden();
    expect(path(page)).toBe(`/clients/${clientId}/training`);
    expect(new URL(page.url()).searchParams.get('add')).toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(add).toBeHidden();
    // One more Back leaves the client (no leftover step for the dialog).
    await page.goBack();
    await expect(page).toHaveURL(/\/clients$/);
  });

  test.describe('iPad portrait', () => {
    test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

    test('Duplicate from the workout ⋯ panel: one Back returns to the original, one more to the list', async ({ page }) => {
      const w = await seedWorkout();
      await signInAsCoach(page);
      await openFromList(page, w);
      await page.getByRole('button', { name: `More for ${w.name}`, exact: true }).click();
      await page.getByRole('button', { name: /^Duplicate/ }).click();
      await expect.poll(() => path(page)).not.toBe(`/workouts/${w.id}`);
      await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/workouts/${w.id}$`));
      await page.goBack();
      await expect(page).toHaveURL(/\/workouts\?q=/);
    });

    test('Delete from the workout ⋯ panel opens the list in its place: Back never shows the deleted workout', async ({ page }) => {
      const w = await seedWorkout();
      await signInAsCoach(page);
      await openFromList(page, w);
      await page.getByRole('button', { name: `More for ${w.name}`, exact: true }).click();
      await page.getByRole('button', { name: 'Delete workout', exact: true }).click();
      const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Delete/ }));
      await confirm.getByRole('button', { name: /^Delete/ }).last().click();
      await expect(page).toHaveURL(/\/workouts$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/workouts\?q=/);
    });
  });

  test('a page opened straight from a link: Discard on Back goes to its list', async ({ page }) => {
    await signInAsCoach(page);
    // A fresh tab with only the form in its history.
    const tab = await page.context().newPage();
    await tab.goto('/exercises/new');
    await tab.getByLabel('Name').fill('Half-typed exercise');
    await tab.goBack();
    await discard(tab).getByRole('button', { name: 'Discard' }).click();
    await expect(tab).toHaveURL(/\/exercises$/);
    await tab.close();
  });
});
