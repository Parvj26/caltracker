import { expect, test } from '@playwright/test';
import { pickExercise, seedLog, serviceClient, setRow, signInAsCoach } from './helpers';

// Coach-added substitutes (spec: docs/superpowers/specs/2026-11-06-substitutes-design.md): the builder adds,
// edits and removes them; the logged workout page says when the client did one.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const createdLogs: string[] = [];

test.afterAll(async () => {
  if (createdLogs.length) await admin.from('workout_logs').delete().in('id', createdLogs);
});

async function pickInDialog(page: import('@playwright/test').Page, exercise: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search exercises').fill(exercise);
  await dialog.getByRole('option', { name: exercise, exact: true }).click();
  await dialog.getByRole('button', { name: 'Add to workout', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('add a substitute to an exercise and to a superset exercise, edit its sets, save, reload and remove it', async ({ page }) => {
  const name = `Back ${unique()}`;
  await signInAsCoach(page);
  await page.goto('/workouts/new');
  await page.getByLabel('Workout name').fill(name);

  await pickExercise(page, '+ Exercise', 'Barbell Squat');
  await setRow(page, 'Barbell Squat', 'set 1').getByLabel('Weight (kg)').fill('60');
  await page.getByRole('button', { name: 'Add a substitute for Barbell Squat' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a substitute for Barbell Squat' })).toBeVisible();
  await pickInDialog(page, 'Barbell Deadlift');

  const sub = page.getByRole('group', { name: 'Substitute: Barbell Deadlift' });
  await expect(sub.getByText('or: Barbell Deadlift')).toBeVisible();
  // Collapsed by default; its sets are a copy of the squat's.
  const subSet1 = setRow(page, 'Barbell Deadlift (substitute)', 'set 1');
  await expect(subSet1).toBeHidden();
  await sub.getByRole('button', { name: 'Edit sets' }).click();
  await expect(subSet1.getByLabel('Weight (kg)')).toHaveValue('60');
  await expect(setRow(page, 'Barbell Deadlift (substitute)', 'set 3')).toBeVisible();
  await subSet1.getByLabel('Weight (kg)').fill('80');
  await page.getByRole('button', { name: 'Add a set to substitute Barbell Deadlift' }).click();
  await expect(setRow(page, 'Barbell Deadlift (substitute)', 'set 4')).toBeVisible();
  // The planned exercise is untouched.
  await expect(setRow(page, 'Barbell Squat', 'set 1').getByLabel('Weight (kg)')).toHaveValue('60');
  await expect(setRow(page, 'Barbell Squat', 'set 4')).toHaveCount(0);

  // Inside a superset too.
  await page.getByRole('button', { name: '+ Superset / circuit' }).click();
  const picker = page.getByRole('dialog', { name: 'Add a superset / circuit' });
  for (const ex of ['Pushups', 'Pullups']) {
    await picker.getByLabel('Search exercises').fill(ex);
    await picker.getByRole('option', { name: ex, exact: true }).click();
  }
  await picker.getByRole('button', { name: 'Add 2 exercises' }).click();
  await page.getByRole('button', { name: 'Add a substitute for Pullups' }).click();
  await pickInDialog(page, 'Cable Crossover');
  await expect(page.getByRole('group', { name: 'Substitute: Cable Crossover' })).toBeVisible();

  // A pick-one group's options get no substitutes.
  await page.getByRole('button', { name: '+ Pick one' }).click();
  const choice = page.getByRole('dialog', { name: 'Add a pick-one group' });
  for (const ex of ['Bodyweight Squat', 'Butterfly']) {
    await choice.getByLabel('Search exercises').fill(ex);
    await choice.getByRole('option', { name: ex, exact: true }).click();
  }
  await choice.getByRole('button', { name: /^Add 2 exercises/ }).click();
  await expect(page.getByRole('button', { name: 'Add a substitute for Butterfly' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').filter({ hasText: '✓ Saved' })).toBeVisible();

  await page.reload();
  const reloaded = page.getByRole('group', { name: 'Substitute: Barbell Deadlift' });
  await expect(reloaded.getByText('or: Barbell Deadlift')).toBeVisible();
  await reloaded.getByRole('button', { name: 'Edit sets' }).click();
  await expect(setRow(page, 'Barbell Deadlift (substitute)', 'set 1').getByLabel('Weight (kg)')).toHaveValue('80');
  await expect(setRow(page, 'Barbell Deadlift (substitute)', 'set 4')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Substitute: Cable Crossover' })).toBeVisible();

  // Remove one and save: it stays gone.
  await page.getByRole('button', { name: 'Remove substitute Cable Crossover' }).click();
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByRole('status').filter({ hasText: '✓ Saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Substitute: Barbell Deadlift' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Substitute: Cable Crossover' })).toHaveCount(0);

  const id = page.url().split('/').pop()!;
  await admin.from('workouts').delete().eq('id', id);
});

test('the logged workout page says when the client did the substitute', async ({ page }) => {
  const users = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (users.error) throw users.error;
  const client = users.data.users.find((u) => u.email === 'client@demo.local')!;
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  const name = `Substituted ${unique()}`;
  const startedAt = new Date(Date.now() - 100 * 60_000).toISOString();
  // The client did Barbell Squat in place of the planned Barbell Deadlift.
  const logId = await seedLog(admin, {
    workspaceId: ws.data.id, clientId: client.id, name, startedAt, finishedAt: new Date(Date.now() - 50 * 60_000).toISOString(),
    swappedFrom: 'Barbell Deadlift',
  });
  createdLogs.push(logId);
  const ids = await admin.from('exercises').select('id, name').in('name', ['Barbell Deadlift', 'Barbell Squat']).is('workspace_id', null);
  if (ids.error) throw ids.error;
  const idOf = (n: string) => ids.data.find((e) => e.name === n)!.id;
  const subId = crypto.randomUUID();
  const target = { repsMin: 8, repsMax: 8, weightKg: 60, durationS: null, distanceM: null, toFailure: false, restSeconds: 90 };
  const up = await admin
    .from('log_exercises')
    .update({
      substitute_id: subId,
      substitute_options: [
        { substituteId: null, exerciseId: idOf('Barbell Deadlift'), exerciseName: 'Barbell Deadlift', trackingType: 'weight_reps', sets: [{ setType: 'normal', target }] },
        { substituteId: subId, exerciseId: idOf('Barbell Squat'), exerciseName: 'Barbell Squat', trackingType: 'weight_reps', sets: [{ setType: 'normal', target }] },
      ],
    })
    .eq('log_id', logId);
  if (up.error) throw up.error;

  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/logs/${logId}`);
  await expect(page.getByText('Did the substitute: Barbell Squat (planned Barbell Deadlift)')).toBeVisible();
  await expect(page.getByText('Swapped from Barbell Deadlift')).toHaveCount(0);
});
