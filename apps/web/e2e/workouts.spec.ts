import { expect, test } from '@playwright/test';
import { pickExercise, serviceClient, setRow, signInAsCoach } from './helpers';

// Workout library and builder (phase 2 Task 14). The pounds test uses its own coach in its own workspace, so it never
// changes the shared demo coach's units while other files run alongside it.

const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test('build a workout with warm-up, drop and superset, then reload and delete it', async ({ page }) => {
  const name = `Upper A ${unique()}`;
  await signInAsCoach(page);
  await page.goto('/workouts');
  await page.getByRole('link', { name: 'New workout' }).click();
  await expect(page).toHaveURL(/\/workouts\/new$/);

  // Saving with no name says so next to the field.
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter a name.' })).toBeVisible();
  await expect(page.getByLabel('Workout name')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Workout name').fill(name);

  // Straight sets: 3 x 8-10 @ 60 kg, then a warm-up first and a drop to failure after set 3.
  await pickExercise(page, '+ Exercise', 'Barbell Squat');
  for (const n of [1, 2, 3]) {
    const row = setRow(page, 'Barbell Squat', `set ${n}`);
    await row.getByRole('button', { name: 'Range' }).click();
    await row.getByLabel('Min reps').fill('8');
    await row.getByLabel('Max reps').fill('10');
    await row.getByLabel('Weight (kg)').fill('60');
  }
  // A kg coach keeps the precision they typed (not rounded to 61.3).
  const set3Weight = setRow(page, 'Barbell Squat', 'set 3').getByLabel('Weight (kg)');
  await set3Weight.fill('61.25');
  await set3Weight.blur();
  await expect(set3Weight).toHaveValue('61.25');
  await page.getByRole('button', { name: '+ Set', exact: true }).click();
  await setRow(page, 'Barbell Squat', 'set 1').getByLabel('Set type').selectOption('warmup');
  await expect(setRow(page, 'Barbell Squat', 'warm-up set')).toBeVisible();
  await setRow(page, 'Barbell Squat', 'set 3').getByRole('button', { name: '+ Drop' }).click();
  const drop = setRow(page, 'Barbell Squat', 'drop after set 3');
  await drop.getByLabel('To failure').check();
  await expect(drop.getByLabel(/^Rest/)).toHaveCount(0);

  // Superset of Pushups + Pullups, 3 rounds by default.
  await page.getByRole('button', { name: '+ Superset / circuit' }).click();
  const picker = page.getByRole('dialog', { name: 'Add a superset / circuit' });
  await picker.getByLabel('Search exercises').fill('Pushups');
  await picker.getByRole('button', { name: 'Pushups', exact: true }).click();
  await picker.getByLabel('Search exercises').fill('Pullups');
  await picker.getByRole('button', { name: 'Pullups', exact: true }).click();
  await picker.getByRole('button', { name: 'Add 2 exercises' }).click();
  await expect(page.getByText('Superset / circuit · 3 rounds')).toBeVisible();

  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Workout name')).toHaveValue(name);
  await expect(setRow(page, 'Barbell Squat', 'warm-up set').getByLabel('Set type')).toHaveValue('warmup');
  // After the warm-up was added first, the old set 3 (61.25 kg) is set 2 and its copy (+ Set) is set 3.
  for (const [n, kg] of [[1, '60'], [2, '61.25'], [3, '61.25']] as const) {
    const row = setRow(page, 'Barbell Squat', `set ${n}`);
    await expect(row.getByLabel('Min reps')).toHaveValue('8');
    await expect(row.getByLabel('Max reps')).toHaveValue('10');
    await expect(row.getByLabel('Weight (kg)')).toHaveValue(kg);
  }
  await expect(drop).toBeVisible();
  await expect(drop.getByText('↳')).toBeVisible();
  await expect(drop.getByLabel('To failure')).toBeChecked();
  await expect(page.getByText('Superset / circuit · 3 rounds')).toBeVisible();
  for (const ex of ['Pushups', 'Pullups']) {
    for (const n of [1, 2, 3]) await expect(setRow(page, ex, `set ${n}`)).toBeVisible();
  }

  // It is in the library list.
  await page.goto('/workouts');
  await expect(page.getByRole('link', { name })).toBeVisible();
  await page.getByRole('link', { name }).click();

  // Delete warns about programs first.
  await page.getByRole('button', { name: 'Delete workout' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
  await expect(dialog.getByText("Used in 0 programs. Deleting removes it from them. Clients' calendars keep their copies.")).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/workouts$/);
  await expect(page.getByRole('link', { name })).toHaveCount(0);
});

test.describe('pounds round trip', () => {
  const email = `lb-coach-${unique()}@example.test`;
  const password = 'lb-coach-password-123';
  const name = `Pounds ${unique()}`;
  let coachId: string | undefined;
  let workspaceId: string | undefined;

  test.beforeAll(async () => {
    const user = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: 'Pound', last_name: 'Coach' },
    });
    if (user.error) throw user.error;
    coachId = user.data.user.id;
    const ws = await admin.from('workspaces').insert({ name: `Pounds Gym ${unique()}` }).select('id').single();
    if (ws.error) throw ws.error;
    workspaceId = ws.data.id;
    const member = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: coachId, role: 'owner' });
    if (member.error) throw member.error;
    const units = await admin.from('profiles').update({ units: 'lb' }).eq('id', coachId);
    if (units.error) throw units.error;
  });

  test.afterAll(async () => {
    if (workspaceId) {
      await admin.from('workouts').delete().eq('workspace_id', workspaceId);
      await admin.from('workspaces').delete().eq('id', workspaceId);
    }
    if (coachId) await admin.auth.admin.deleteUser(coachId);
  });

  test('135 lb is still 135 lb after save and reload', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await page.goto('/workouts/new');
    await page.getByLabel('Workout name').fill(name);
    await pickExercise(page, '+ Exercise', 'Barbell Squat');
    const row = setRow(page, 'Barbell Squat', 'set 1');
    await row.getByLabel('Reps', { exact: true }).fill('5');
    await row.getByLabel('Weight (lb)').fill('135');
    await page.getByRole('button', { name: 'Save workout' }).click();
    await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Saved')).toBeVisible();

    await page.reload();
    await expect(setRow(page, 'Barbell Squat', 'set 1').getByLabel('Weight (lb)')).toHaveValue('135');

    // Stored in kilograms.
    const id = page.url().split('/').pop()!;
    const { data } = await admin.from('workout_sets').select('target_weight_kg, position').eq('workout_id', id).order('position');
    expect(Number(data![0]!.target_weight_kg)).toBeCloseTo(61.235, 3);
  });
});
