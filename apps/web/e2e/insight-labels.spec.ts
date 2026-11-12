import { expect, test, type Page } from '@playwright/test';
import { isErrorCode } from '@caltracker/shared';
import { createProgram, serviceClient, setRow, signInAsCoach } from './helpers';
import { demoWorkspace, freshClient, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';

// Clear button names and error codes for PostHog: every key control on the four coach tasks carries its fixed
// data-ph-capture-attribute-label, and every on-screen alert carries a data-error-code from the shared list.
const admin = serviceClient();
const created = { users: [] as string[], workouts: [] as string[], programs: [] as string[] };
let workspaceId: string;

/** Every alert any page showed during the test, by its data-error-code ('' when it had none). */
let alertCodes: string[] = [];

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  if (created.programs.length) {
    await admin.from('program_assignments').delete().in('program_name', created.programs);
    await admin.from('programs').delete().in('name', created.programs);
  }
  if (created.workouts.length) await admin.from('workouts').delete().in('name', created.workouts);
});

test.beforeEach(async ({ page }) => {
  alertCodes = [];
  await page.exposeBinding('__reportAlert', (_source, code: string) => {
    alertCodes.push(code);
  });
  await page.addInitScript(() => {
    const report = (window as unknown as { __reportAlert: (code: string) => void }).__reportAlert;
    const seen = new WeakSet<Element>();
    const scan = () => {
      for (const el of document.querySelectorAll('[role="alert"]')) {
        if (seen.has(el)) continue;
        seen.add(el);
        report(el.getAttribute('data-error-code') ?? '');
      }
    };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] });
  });
});

test.afterEach(() => {
  for (const code of alertCodes) expect(isErrorCode(code), `alert code "${code}" is in the error-code list`).toBe(true);
});

const label = (page: Page, name: string) => page.locator(`[data-ph-capture-attribute-label="${name}"]`);

test('invite: every control is labelled, and a bad email shows its error code', async ({ page }) => {
  await signInAsCoach(page);
  await expect(label(page, 'invite_open')).toBeVisible();
  await label(page, 'invite_open').click();
  const dialog = page.getByRole('dialog', { name: 'Invite a client' });
  await expect(dialog).toBeVisible();
  for (const name of ['invite_send', 'invite_cancel', 'invite_csv_open']) await expect(dialog.locator(`[data-ph-capture-attribute-label="${name}"]`)).toBeVisible();

  await dialog.getByLabel('First name').fill('Zebracanary');
  await dialog.getByLabel('Last name').fill('Testperson');
  await dialog.getByLabel('Email').fill('not-an-email');
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  await expect(dialog.locator('[role=alert][data-error-code="invite_email_invalid"]')).toBeVisible();

  await dialog.getByRole('tab', { name: 'Many (CSV)' }).click();
  await expect(dialog.locator('[data-ph-capture-attribute-label="invite_csv_upload"]')).toBeAttached();
  await dialog.getByRole('tab', { name: 'One client' }).click();
  await label(page, 'invite_cancel').click();
  await expect(dialog).toBeHidden();
});

test('assign: the calendar dialog and the program-page dialog are labelled', async ({ page }) => {
  const tag = unique();
  const workout = `Label W ${tag}`;
  const program = `Label P ${tag}`;
  created.workouts.push(workout);
  created.programs.push(program);
  const clientId = await freshClient(admin, workspaceId, 'Zebracanary', `Testperson${tag}`);
  created.users.push(clientId);
  const workoutId = await seedLibraryWorkout(admin, workspaceId, workout);
  const programId = await seedProgram(admin, workspaceId, program, 1, [{ week: 1, day: 1, workoutId }]);

  await signInAsCoach(page);
  await page.goto(`/clients/${clientId}/training`);
  await label(page, 'assign_open').click();
  const dialog = page.getByRole('dialog', { name: 'Assign a program' });
  await expect(dialog).toBeVisible();
  for (const name of ['assign_pick_program', 'assign_pick_date', 'assign_save', 'assign_cancel']) await expect(dialog.locator(`[data-ph-capture-attribute-label="${name}"]`)).toBeVisible();
  await label(page, 'assign_cancel').click();
  await expect(dialog).toBeHidden();

  await page.goto(`/programs/${programId}`);
  await label(page, 'assign_open').first().click();
  const many = page.getByRole('dialog', { name: `Assign ${program}` });
  await expect(many).toBeVisible();
  await expect(many.locator('[data-ph-capture-attribute-label="assign_pick_client"]').first()).toBeAttached();
  for (const name of ['assign_pick_date', 'assign_save', 'assign_cancel']) await expect(many.locator(`[data-ph-capture-attribute-label="${name}"]`)).toBeVisible();
  await many.locator('[data-ph-capture-attribute-label="assign_cancel"]').click();
  await expect(many).toBeHidden();
});

test('build program: new, name, weeks, workouts and copy week are labelled', async ({ page }) => {
  const name = `Label build ${unique()}`;
  created.programs.push(name);
  await signInAsCoach(page);
  await page.goto('/programs');
  await expect(label(page, 'program_new')).toBeVisible();
  await page.goto('/programs/new');
  await expect(label(page, 'program_name_save')).toBeVisible();
  await createProgram(page, name, 2, []);
  for (const n of ['program_add_week', 'program_save']) await expect(label(page, n)).toBeVisible();
  await expect(label(page, 'program_add_workout').first()).toBeVisible();
  await expect(label(page, 'program_copy_week').first()).toBeVisible();
});

test('workout editor: add exercise, search, pick, sets and save are labelled', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/workouts/new');
  for (const n of ['workout_add_exercise', 'workout_save']) await expect(label(page, n)).toBeVisible();
  await label(page, 'workout_add_exercise').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-ph-capture-attribute-label="workout_exercise_search"]')).toBeVisible();
  await dialog.getByLabel('Search exercises').fill('Barbell Squat');
  const option = dialog.getByRole('option', { name: 'Barbell Squat', exact: true });
  await expect(option).toHaveAttribute('data-ph-capture-attribute-label', 'workout_exercise_pick');
  await option.click();
  await dialog.getByRole('button', { name: 'Add 1 exercise', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(setRow(page, 'Barbell Squat', 'set 1').locator('[data-ph-capture-attribute-label="workout_remove_set"]')).toBeAttached();
  await expect(label(page, 'workout_add_set').first()).toBeVisible();
});
