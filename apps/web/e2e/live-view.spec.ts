import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  addSection,
  addStraightBlock,
  addSuperset,
  completeSetWith,
  emptyWorkout,
  startLogFromWorkout,
  toKg,
  type Database,
  type WorkoutDoc,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { seedLog, seedSectionedWorkout, serviceClient } from './helpers';

// The coach's live view of a workout in progress, and the Training now tabs for switching between people training at
// the same time (including the coach's own session). Each test has its own coach and workspace, so the tabs only ever
// show that test's clients (the demo workspace has other tests' workouts in progress).
const admin = serviceClient();
const PASSWORD = 'live-view-password-123';
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { users: string[]; workspaces: string[] } = { users: [], workspaces: [] };
const SCREENSHOTS = process.env.LIVE_VIEW_SCREENSHOTS;

test.afterAll(async () => {
  for (const id of created.workspaces) await admin.from('workspaces').delete().eq('id', id);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

async function newUser(firstName: string, lastName: string): Promise<{ id: string; email: string }> {
  const email = `live-view-${firstName.toLowerCase()}-${unique()}@example.com`;
  const u = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName } });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  return { id: u.data.user.id, email };
}

/** A coach (in pounds) with their own workspace, signed in on `page`. */
async function newCoach(page: Page): Promise<{ id: string; workspaceId: string }> {
  const coach = await newUser('Coach', `Live${unique()}`);
  const ws = await admin.from('workspaces').insert({ name: `Live View Gym ${unique()}` }).select('id').single();
  if (ws.error) throw ws.error;
  created.workspaces.push(ws.data.id);
  const owner = await admin.from('workspace_members').insert({ workspace_id: ws.data.id, user_id: coach.id, role: 'owner' });
  if (owner.error) throw owner.error;
  const units = await admin.from('profiles').update({ units: 'lb' }).eq('id', coach.id);
  if (units.error) throw units.error;
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(coach.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
  return { id: coach.id, workspaceId: ws.data.id };
}

/** A client of the workspace, plus a Supabase client signed in as them (their phone). */
async function newClient(workspaceId: string, firstName: string, lastName: string) {
  const user = await newUser(firstName, lastName);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: user.id, role: 'client' });
  if (m.error) throw m.error;
  const phone = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await phone.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (signedIn.error) throw signedIn.error;
  return { id: user.id, phone };
}

const uuid = () => crypto.randomUUID();

async function pick(name: string) {
  const r = await admin.from('exercises').select('id, name, tracking_type').eq('name', name).is('workspace_id', null).limit(1).single();
  if (r.error) throw r.error;
  return { id: r.data.id, name: r.data.name, trackingType: r.data.tracking_type };
}

/** Targets by tracking type: weighted sets `lb` × 12, reps-only 12, timed 30 s. */
function withTargets(doc: WorkoutDoc, lbByName: Record<string, number>): WorkoutDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => ({
      ...b,
      exercises: b.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s) => ({
          ...s,
          targetRepsMin: e.trackingType === 'weight_reps' || e.trackingType === 'reps' ? 12 : null,
          targetRepsMax: e.trackingType === 'weight_reps' || e.trackingType === 'reps' ? 12 : null,
          targetWeightKg: e.trackingType === 'weight_reps' ? toKg(lbByName[e.exerciseName] ?? 10, 'lb') : null,
          targetDurationS: e.trackingType === 'time' ? 30 : null,
        })),
      })),
    })),
  };
}

/** The mockup's workout: Warm-Up, a Core superset, Resistance Training (straight + superset), Finisher. */
async function upperCore(name: string): Promise<WorkoutDoc> {
  const [rope, plank, pushups, butterfly, curl, squat, stretch] = await Promise.all(
    ['Rope Jumping', 'Plank', 'Pushups', 'Butterfly', 'Dumbbell Bicep Curl', 'Barbell Squat', 'Hamstring Stretch'].map(pick),
  );
  let d = emptyWorkout(uuid, name);
  d = addSection(d, 'Warm-Up', uuid);
  d = addStraightBlock(d, rope!, uuid, 1);
  d = addSection(d, 'Core (Activation)', uuid);
  d = addSuperset(d, [plank!, pushups!], uuid, 3);
  d = addSection(d, 'Resistance Training', uuid);
  d = addStraightBlock(d, butterfly!, uuid, 3);
  d = addSuperset(d, [curl!, squat!], uuid, 3);
  d = addSection(d, 'Finisher', uuid);
  d = addStraightBlock(d, stretch!, uuid, 2);
  return withTargets(d, { Butterfly: 20, 'Dumbbell Bicep Curl': 8, 'Barbell Squat': 20 });
}

/** Puts the workout on the client's calendar today (empty: only its id matters), so the log follows a plan and can be taken over. */
async function onCalendar(page: Page, workspaceId: string, clientId: string, workout: WorkoutDoc) {
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
  const w = await admin.from('workouts').insert({ id: workout.id, workspace_id: workspaceId, client_id: clientId, scheduled_on: today, name: workout.name });
  if (w.error) throw w.error;
}

/** Full-page screenshot for the PR, once the exercise photos have loaded. */
async function shoot(page: Page, name: string) {
  if (!SCREENSHOTS) return;
  await page.evaluate(() => document.querySelectorAll('img').forEach((i) => (i.loading = 'eager')));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 10_000 });
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage: true });
}

/** A workout in progress on a client's phone, saved through save_workout_log exactly as the phone saves it. */
function phoneLog(phone: SupabaseClient<Database>, workout: WorkoutDoc, startedAt: string) {
  let doc: WorkoutLogDoc = { ...startLogFromWorkout(workout, uuid, startedAt), revision: 1 };
  const save = async () => {
    const r = await phone.rpc('save_workout_log', { p_doc: doc as never });
    if (r.error) throw r.error;
    expect(r.data).toMatchObject({ applied: true });
  };
  return {
    get id() {
      return doc.id;
    },
    save,
    /** Ticks `count` more sets of the exercise (in order), each with these numbers (pounds), one second apart. */
    tick(exercise: string, count: number, { lb, reps, seconds }: { lb?: number; reps?: number; seconds?: number } = {}) {
      const ex = doc.blocks.flatMap((b) => b.exercises).find((e) => e.exerciseName === exercise)!;
      for (const s of ex.sets.filter((x) => x.completedAt === null).slice(0, count)) {
        const at = new Date(Date.now() - 1000 * (60 - doc.revision)).toISOString();
        doc = completeSetWith(
          doc,
          s.id,
          {
            weightKg: lb !== undefined ? toKg(lb, 'lb') : s.target.weightKg,
            reps: reps ?? s.target.repsMax,
            durationS: seconds ?? s.target.durationS,
            distanceM: null,
          },
          at,
        );
      }
      return this;
    },
  };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function waitUntilLive(page: Page) {
  await expect(page.locator('[data-live="live"]')).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
}
const expectNoReload = async (page: Page) =>
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);

/** A sideways swipe on the page, as a finger would make it (dx < 0: to the next person). */
async function swipe(page: Page, dx: number, dy = 0) {
  await page.evaluate(
    ({ dx, dy }) => {
      const el = document.querySelector('[data-training-now]')!;
      const at = (x: number, y: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [at(600, 400)], changedTouches: [at(600, 400)], bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [at(600 + dx, 400 + dy)], bubbles: true }));
    },
    { dx, dy },
  );
}

const LIVE = { timeout: 5_000 };

test.use({ viewport: { width: 1194, height: 1400 }, hasTouch: true });

test('the live view shows the whole workout, where the client is, and updates as they tick sets', async ({ page }) => {
  const coach = await newCoach(page);
  const client = await newClient(coach.workspaceId, 'Vaishali', 'Kohli');
  const workout = await upperCore('VK - 2 Upper/Core');
  await onCalendar(page, coach.workspaceId, client.id, workout);
  const log = phoneLog(client.phone, workout, ago(32));
  log.tick('Rope Jumping', 1).tick('Plank', 3).tick('Pushups', 3).tick('Butterfly', 2);
  log.tick('Butterfly', 1, { lb: 25 }).tick('Dumbbell Bicep Curl', 1).tick('Barbell Squat', 1).tick('Dumbbell Bicep Curl', 1, { lb: 10 });
  await log.save();

  await page.goto(`/clients/${client.id}/logs/${log.id}`);
  await expect(page.getByText('LIVE · VAISHALI KOHLI')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'VK - 2 Upper/Core' })).toBeVisible();
  const progress = page.getByRole('list', { name: 'Progress' });
  await expect(progress).toContainText('13 of 18 sets');
  await expect(page.getByTestId('elapsed')).toHaveText(/^3[2-4]:\d\d$/);
  // No tabs: only one person is training.
  await expect(page.getByRole('tablist')).toHaveCount(0);

  // The whole workout, section by section.
  for (const section of ['Warm-Up', 'Core (Activation)', 'Resistance Training', 'Finisher']) {
    await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^${section.replace(/[()]/g, '\\$&')}`) })).toBeVisible();
  }
  await expect(page.getByRole('heading', { level: 2, name: /Resistance Training/ })).toContainText('ON NOW');
  await expect(page.getByRole('heading', { level: 2, name: 'Warm-Up' })).not.toContainText('ON NOW');
  const curl = page.getByRole('listitem', { name: 'Dumbbell Bicep Curl' });
  await expect(curl).toContainText('VAISHALI IS HERE');
  await expect(curl).toContainText('✓ 8 lb × 12, ✓ 10 lb × 12');
  await expect(curl).toContainText('· 8 lb × 12');
  await expect(curl).toContainText(/Set 2 ticked .* · \+2 lb on plan/);
  await expect(curl).toContainText('2/3');
  await expect(page.getByText('SUPERSET · ROUND 2 OF 3')).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Butterfly' })).toContainText('✓ 20 lb × 12, ✓ 20 lb × 12, ✓ 25 lb × 12');
  await expect(page.getByRole('listitem', { name: 'Hamstring Stretch' })).toContainText('×2');
  await expect(page.getByRole('listitem', { name: 'Rope Jumping' })).toContainText('Done');
  await shoot(page, 'live-view');

  // The phone ticks the last curl: it flashes, and the client moves on to the squat.
  await waitUntilLive(page);
  log.tick('Dumbbell Bicep Curl', 1, { lb: 10 });
  await log.save();
  await expect(curl).toContainText('3/3', LIVE);
  await expect(curl).toHaveAttribute('data-flash', 'true');
  await expect(progress).toContainText('14 of 18 sets');
  await expect(page.getByRole('listitem', { name: 'Barbell Squat' })).toContainText('VAISHALI IS HERE');
  await expect(curl).not.toContainText('IS HERE');
  await expectNoReload(page);

  // Take over: the coach now logs it (the existing take-over flow), from the latest copy.
  await page.getByRole('button', { name: 'Take over' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/log/${workout.id}$`));
  await expect(page.getByRole('button', { name: 'Finish session' })).toBeVisible();
  await expect(page.getByText(/14 of 18 sets done · Logged by you/)).toBeVisible();
});

test('with two people training, tabs switch between watching one and logging the other', async ({ page }) => {
  const coach = await newCoach(page);
  const vaishali = await newClient(coach.workspaceId, 'Vaishali', 'Kohli');
  const parv = await newClient(coach.workspaceId, 'Parv', 'Jain');

  // Vaishali trains on her phone; the coach logs Parv's workout as a session.
  const vkWorkout = await upperCore('VK - 2 Upper/Core');
  await onCalendar(page, coach.workspaceId, vaishali.id, vkWorkout);
  const watched = phoneLog(vaishali.phone, vkWorkout, ago(32));
  watched.tick('Rope Jumping', 1).tick('Plank', 2);
  await watched.save();
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
  const parvWorkout = await seedSectionedWorkout(admin, { workspaceId: coach.workspaceId, clientId: parv.id, name: 'Parv legs', scheduledOn: today, sections: [], blocks: [{ exercises: ['Barbell Squat'] }] });
  const session = await seedLog(admin, {
    workspaceId: coach.workspaceId, clientId: parv.id, name: 'Parv legs', plannedWorkoutId: parvWorkout, status: 'in_progress', startedAt: ago(20), sets: 3, notDone: 2, loggedBy: coach.id,
  });

  await page.goto(`/clients/${vaishali.id}/logs/${watched.id}`);
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  const vTab = tabs.getByRole('tab', { name: /^Vaishali/ });
  const pTab = tabs.getByRole('tab', { name: /^Parv/ });
  await expect(vTab).toHaveAttribute('aria-selected', 'true');
  await expect(vTab).toHaveAccessibleName('Vaishali, 3 of 18 sets');
  await expect(pTab).toHaveAccessibleName('Parv, 1 of 3 sets');
  await shoot(page, 'live-view-two-people');
  await waitUntilLive(page);

  // Tap Parv: his session logger, where the coach ticks a set.
  await pTab.click();
  await expect(pTab).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`with=${session}`));
  const set2 = page.getByRole('button', { name: 'Done: Barbell Squat Set 2 of 3' });
  await set2.click();
  await expect(set2).toHaveAttribute('aria-pressed', 'true');
  await expect(pTab).toHaveAccessibleName('Parv, 2 of 3 sets');
  await shoot(page, 'session-with-tabs');

  // Vaishali ticks a set meanwhile: her tab gets the lime dot until the coach looks.
  watched.tick('Plank', 1);
  await watched.save();
  await expect(vTab.getByTestId('new-tick')).toBeVisible(LIVE);
  await expect(vTab).toHaveAccessibleName('Vaishali, 4 of 18 sets, new set ticked');

  // Swipe right (back to Vaishali); an up-and-down drag does nothing.
  await swipe(page, 30, 300);
  await expect(pTab).toHaveAttribute('aria-selected', 'true');
  await swipe(page, 200);
  await expect(vTab).toHaveAttribute('aria-selected', 'true');
  await expect(vTab.getByTestId('new-tick')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Progress' })).toContainText('4 of 18 sets');

  // Swipe left back to Parv: his tick is still there, and it was saved.
  await swipe(page, -200);
  await expect(pTab).toHaveAttribute('aria-selected', 'true');
  await expect(set2).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await admin.from('log_sets').select('completed_at').eq('log_id', session)).data?.filter((s) => s.completed_at !== null).length)
    .toBe(2);
  await expectNoReload(page);

  // The same tabs on the coach's own session page.
  await page.goto(`/clients/${parv.id}/log/${parvWorkout}`);
  await expect(page.getByRole('tab', { name: /^Parv/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Finish session' })).toBeVisible();
  await page.getByRole('tab', { name: /^Vaishali/ }).click();
  await expect(page.getByText('LIVE · VAISHALI KOHLI')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish session' })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Parv/ }).click();
  await page.getByRole('button', { name: 'Done: Barbell Squat Set 3 of 3' }).click();
  await expect
    .poll(async () => (await admin.from('log_sets').select('completed_at').eq('log_id', session)).data?.filter((s) => s.completed_at !== null).length)
    .toBe(3);
});
