import { expect, test, type Page } from '@playwright/test';
import { addSection, pickExercise, serviceClient, setRow, signInAsCoach } from './helpers';

// Workout library and builder (phase 2 Task 14). The pounds test uses its own coach in its own workspace, so it never
// changes the shared demo coach's units while other files run alongside it.

const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test('build a workout with warm-up, drop and superset, then reload and delete it', async ({ page }) => {
  const name = `Upper A ${unique()}`;
  await signInAsCoach(page);
  await page.goto('/workouts');
  await expect(
    page.getByText(
      "A workout is one session: exercises, sets, reps and rest. Build them here, then add them to programs or straight to a client's calendar.",
    ),
  ).toBeVisible();
  await page.getByRole('link', { name: 'New workout' }).click();
  await expect(page).toHaveURL(/\/workouts\/new$/);

  // Saving with no name says so next to the field.
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter a name.' })).toBeVisible();
  await expect(page.getByLabel('Workout name')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Workout name').fill(name);

  // Straight sets: 3 x 8-10 @ 60 kg, then a warm-up first and a drop to failure after set 3.
  await pickExercise(page, '+ Exercise', 'Barbell Squat');

  // Each exercise's sets have column captions, and the empty boxes say what goes in them.
  const squat = page.getByRole('region', { name: 'Barbell Squat' });
  for (const caption of ['Type', 'Reps', 'Weight', 'Rest', 'Note']) {
    await expect(squat.getByText(caption, { exact: true })).toBeVisible();
  }
  const first = setRow(page, 'Barbell Squat', 'set 1');
  await expect(first.getByPlaceholder('reps', { exact: true })).toBeVisible();
  await expect(first.getByLabel('Weight (kg)')).toHaveAttribute('placeholder', 'kg');
  const toggle = first.getByRole('button', { name: '8–10', exact: true });
  await expect(toggle).toHaveAccessibleDescription('Use a rep range, e.g. 8–10');
  await expect(toggle).toHaveAttribute('title', 'Use a rep range, e.g. 8–10');

  for (const n of [1, 2, 3]) {
    const row = setRow(page, 'Barbell Squat', `set ${n}`);
    await row.getByRole('button', { name: '8–10', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Single', exact: true })).toHaveAccessibleDescription('Use one rep count');
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
  await expect(picker.getByText('A superset needs 2 or more exercises. Search and tap each one.')).toBeVisible();
  await picker.getByLabel('Search exercises').fill('Pushups');
  await picker.getByRole('button', { name: 'Pushups', exact: true }).click();
  // One pick is not a superset yet.
  await expect(picker.getByRole('button', { name: 'Pick at least 2 exercises', exact: true })).toBeDisabled();
  await picker.getByLabel('Search exercises').fill('Pullups');
  await picker.getByRole('button', { name: 'Pullups', exact: true }).click();
  await picker.getByRole('button', { name: 'Add 2 exercises' }).click();
  await expect(page.getByText('Superset / circuit · 3 rounds')).toBeVisible();

  // Unsaved edits are flagged next to the Save button; after saving it says so there too.
  const saveButton = page.getByRole('button', { name: 'Save workout' });
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
  await saveButton.click();
  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
  const savedChip = page.getByRole('status').filter({ hasText: '✓ Saved' });
  await expect(savedChip).toBeVisible();
  const chipBox = (await savedChip.boundingBox())!;
  const buttonBox = (await saveButton.boundingBox())!;
  expect(Math.abs(buttonBox.x - (chipBox.x + chipBox.width))).toBeLessThan(48);
  expect(Math.abs(buttonBox.y + buttonBox.height / 2 - (chipBox.y + chipBox.height / 2))).toBeLessThan(24);
  // After a few seconds it settles to a quiet line.
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible({ timeout: 8000 });

  // Saving an existing workout shows the tick again.
  await page.getByLabel('Workout name').fill(`${name} `);
  await page.getByLabel('Workout name').fill(name);
  await page.getByLabel('Workout notes (optional)').fill('Keep the bar path straight.');
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
  await saveButton.click();
  await expect(savedChip).toBeVisible();

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
    await expect(page).toHaveURL(/\/home$/);
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

// Sections and pick-one groups. Own coach (pounds) and own custom exercises with the trainer's real names, so the
// test does not depend on which built-in exercises the environment imported.
test.describe('sections and pick-one groups', () => {
  const email = `sec-coach-${unique()}@example.test`;
  const password = 'sec-coach-password-123';
  let coachId: string | undefined;
  let workspaceId: string | undefined;

  const tag = unique();
  // Test-unique names: a built-in (or a future one) with the trainer's name would make the exact-name picks ambiguous.
  const X = (base: string) => `${base} ${tag}`;
  const CUSTOM: ReadonlyArray<readonly [string, 'weight_reps' | 'reps']> = [
    ['Arm Circles', 'reps'],
    ['Hanging Leg Raise', 'reps'],
    ['Medicine Ball Sit Up & Overhead Throw', 'weight_reps'],
    ['DB Bench', 'weight_reps'],
    ['Alternating DB Curl', 'weight_reps'],
    ['Lateral Raise', 'weight_reps'],
    ['Seated DB Press', 'weight_reps'],
    ['Lat Pulldown', 'weight_reps'],
    ['Tricep Pushdown', 'weight_reps'],
    ['Medicine Ball Slam', 'weight_reps'],
    ["Farmer's Walk", 'weight_reps'],
  ];

  test.beforeAll(async () => {
    const user = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: 'Section', last_name: 'Coach' },
    });
    if (user.error) throw user.error;
    coachId = user.data.user.id;
    const ws = await admin.from('workspaces').insert({ name: `Section Gym ${unique()}` }).select('id').single();
    if (ws.error) throw ws.error;
    workspaceId = ws.data.id;
    const member = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: coachId, role: 'owner' });
    if (member.error) throw member.error;
    const units = await admin.from('profiles').update({ units: 'lb' }).eq('id', coachId);
    if (units.error) throw units.error;
    const seeded = await admin.from('exercises').insert(
      CUSTOM.map(([name, tracking_type]) => ({ workspace_id: workspaceId!, source: 'custom' as const, name: X(name), tracking_type })),
    );
    if (seeded.error) throw seeded.error;
  });

  test.afterAll(async () => {
    if (workspaceId) {
      await admin.from('workouts').delete().eq('workspace_id', workspaceId);
      await admin.from('workspaces').delete().eq('id', workspaceId);
    }
    if (coachId) await admin.auth.admin.deleteUser(coachId);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/home$/);
    await page.goto('/workouts/new');
  });

  /** Fills reps (and weight, when given) of one set row. */
  async function fillSet(page: Page, exercise: string, n: number, reps: number, weight?: number) {
    const row = setRow(page, exercise, `set ${n}`);
    await row.getByLabel('Reps', { exact: true }).fill(String(reps));
    if (weight !== undefined) await row.getByLabel('Weight (lb)').fill(String(weight));
  }

  async function addSuperset(page: Page, names: string[]) {
    await page.getByRole('button', { name: '+ Superset / circuit' }).click();
    const picker = page.getByRole('dialog', { name: 'Add a superset / circuit' });
    for (const n of names) {
      await picker.getByLabel('Search exercises').fill(n);
      await picker.getByRole('button', { name: n, exact: true }).click();
    }
    await picker.getByRole('button', { name: `Add ${names.length} exercises` }).click();
    await expect(picker).toBeHidden();
  }

  test('builds the Upper / Core workout with sections and a pick-one finisher', async ({ page }) => {
    const name = `Upper / Core ${unique()}`;
    await page.getByLabel('Workout name').fill(name);

    // Warm-Up: Arm Circles, 1 set of 10.
    await addSection(page, 'Warm-Up');
    await pickExercise(page, '+ Exercise', X('Arm Circles'));
    for (const n of [3, 2]) await setRow(page, X('Arm Circles'), `set ${n}`).getByRole('button', { name: 'Remove set' }).click();
    await expect(setRow(page, X('Arm Circles'), 'set 2')).toHaveCount(0);
    await fillSet(page, X('Arm Circles'), 1, 10);

    // Core (Activation): one superset, 3 rounds.
    await addSection(page, 'Core (Activation)');
    await addSuperset(page, [X('Hanging Leg Raise'), X('Medicine Ball Sit Up & Overhead Throw')]);
    await expect(page.getByText('Superset / circuit · 3 rounds')).toBeVisible();
    for (const n of [1, 2, 3]) await fillSet(page, X('Hanging Leg Raise'), n, 10);
    for (const [n, w] of [[1, 10], [2, 12], [3, 14]] as const) await fillSet(page, X('Medicine Ball Sit Up & Overhead Throw'), n, 12, w);

    // Resistance Training: three supersets, the second one uneven (3 + 2 sets).
    await addSection(page, 'Resistance Training');
    await addSuperset(page, [X('DB Bench'), X('Alternating DB Curl')]);
    for (const [n, w, r] of [[1, 35, 12], [2, 45, 12], [3, 55, 10]] as const) await fillSet(page, X('DB Bench'), n, r, w);
    for (const n of [1, 2, 3]) await fillSet(page, X('Alternating DB Curl'), n, 12, 25);

    await addSuperset(page, [X('Lateral Raise'), X('Seated DB Press')]);
    await setRow(page, X('Seated DB Press'), 'set 3').getByRole('button', { name: 'Remove set' }).click();
    await expect(page.getByText('Superset / circuit · 3 + 2 sets')).toBeVisible();
    for (const [n, w] of [[1, 10], [2, 15], [3, 15]] as const) await fillSet(page, X('Lateral Raise'), n, 12, w);
    for (const [n, w] of [[1, 25], [2, 30]] as const) await fillSet(page, X('Seated DB Press'), n, 12, w);

    await addSuperset(page, [X('Lat Pulldown'), X('Tricep Pushdown')]);
    await page.getByRole('button', { name: 'Add a set to Lat Pulldown' }).click();
    await page.getByRole('button', { name: 'Add a set to Tricep Pushdown' }).click();
    for (const [n, w, r] of [[1, 85, 12], [2, 115, 12], [3, 85, 6], [4, 85, 6]] as const) await fillSet(page, X('Lat Pulldown'), n, r, w);
    for (const [n, w, r] of [[1, 70, 12], [2, 80, 12], [3, 90, 10], [4, 70, 6]] as const) await fillSet(page, X('Tricep Pushdown'), n, r, w);

    // Finisher: pick one of Medicine Ball Slam (15 x 12 x 3) or Farmer's Walk.
    await addSection(page, 'Finisher');
    await page.getByRole('button', { name: '+ Pick one', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add a pick-one group' });
    await picker.getByLabel('Search exercises').fill(X('Medicine Ball Slam'));
    await picker.getByRole('button', { name: X('Medicine Ball Slam'), exact: true }).click();
    await expect(picker.getByRole('button', { name: 'Pick at least 2 exercises', exact: true })).toBeDisabled();
    await picker.getByLabel('Search exercises').fill(X("Farmer's Walk"));
    await picker.getByRole('button', { name: X("Farmer's Walk"), exact: true }).click();
    await picker.getByRole('button', { name: 'Add 2 exercises' }).click();
    await expect(page.getByRole('heading', { name: 'Pick one · 2 options' })).toBeVisible();
    for (const n of [1, 2, 3]) await fillSet(page, X('Medicine Ball Slam'), n, 12, 15);

    await page.getByRole('button', { name: 'Save workout' }).click();
    await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('status').filter({ hasText: '✓ Saved' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('textbox', { name: /^Name of section / })).toHaveCount(4);
    const sectionBoxes = page.getByRole('textbox', { name: /^Name of section / });
    expect(await sectionBoxes.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([
      'Warm-Up',
      'Core (Activation)',
      'Resistance Training',
      'Finisher',
    ]);
    // Headings come in order, and the pick-one group sits under Finisher.
    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
    const order = [
      'Warm-Up',
      X('Arm Circles'),
      'Core (Activation)',
      'Superset / circuit · 3 rounds',
      'Resistance Training',
      'Superset / circuit · 3 rounds',
      'Superset / circuit · 3 + 2 sets',
      'Superset / circuit · 4 rounds',
      'Finisher',
      'Pick one · 2 options',
    ];
    let at = -1;
    for (const h of order) {
      at = headings.indexOf(h, at + 1);
      expect(at, `heading "${h}" in order`).toBeGreaterThan(-1);
    }
    expect(headings.at(-1)).toBe('Pick one · 2 options');

    // The uneven superset kept its shape, and the values survived.
    await expect(setRow(page, X('Lateral Raise'), 'set 3')).toBeVisible();
    await expect(setRow(page, X('Seated DB Press'), 'set 3')).toHaveCount(0);
    await expect(setRow(page, X('Seated DB Press'), 'set 2').getByLabel('Weight (lb)')).toHaveValue('30');
    await expect(setRow(page, X('Tricep Pushdown'), 'set 4').getByLabel('Weight (lb)')).toHaveValue('70');
    await expect(setRow(page, X('Medicine Ball Slam'), 'set 3').getByLabel('Weight (lb)')).toHaveValue('15');
    await expect(page.getByRole('button', { name: 'Remove the last round' }).first()).toBeEnabled();

    // Moving the pick-one group (block 6) into Core empties Finisher, so that section goes away.
    await page.getByLabel('Move pick-one group 6 to a section').selectOption({ label: 'Core (Activation)' });
    await expect(page.getByRole('textbox', { name: /^Name of section / })).toHaveCount(3);
  });

  test('saving with an empty section says which section needs an exercise', async ({ page }) => {
    await page.getByLabel('Workout name').fill(`Empty section ${unique()}`);
    await addSection(page, 'Main');
    await pickExercise(page, '+ Exercise', X('Arm Circles'));
    await addSection(page, 'Core');
    const empty = page.getByRole('group', { name: 'Section Core', exact: true });
    await expect(empty.getByText('No exercises yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Save workout' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Add an exercise to Core or remove the section.' })).toBeVisible();
    await empty.getByRole('button', { name: 'Remove Core' }).click();
    await expect(empty).toHaveCount(0);
    await page.getByRole('button', { name: 'Save workout' }).click();
    await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
  });

  test('a workout with no sections looks as it did before', async ({ page }) => {
    await page.getByLabel('Workout name').fill(`Plain ${unique()}`);
    await pickExercise(page, '+ Exercise', X('Arm Circles'));
    await expect(page.getByRole('textbox', { name: /^Name of section / })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: /to a section/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ Section', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save workout' }).click();
    await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
    await page.reload();
    await expect(page.getByRole('textbox', { name: /^Name of section / })).toHaveCount(0);
  });
});
