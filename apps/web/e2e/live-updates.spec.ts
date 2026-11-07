import { expect, test, type Page } from '@playwright/test';
import { REALTIME_SUBSCRIBE_STATES, createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { serviceClient, signInAsCoach } from './helpers';

// Live updates for the coach: the phone saves through save_workout_log (as the signed-in client), and the coach's open
// page updates by itself, without a reload. Each test seeds its own client in the demo workspace.
const admin = serviceClient();
const PASSWORD = 'client-password-123';
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { workouts: string[]; users: string[]; workspaces: string[] } = { workouts: [], users: [], workspaces: [] };
let workspaceId: string;
let squatId: string;

test.beforeAll(async () => {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
  const ex = await admin.from('exercises').select('id').eq('name', 'Barbell Squat').is('workspace_id', null).limit(1).single();
  if (ex.error) throw ex.error;
  squatId = ex.data.id;
});

test.afterAll(async () => {
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
  // Deleting the user takes their logs with them.
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  if (created.workspaces.length) await admin.from('workspaces').delete().in('id', created.workspaces);
});

/** A Supabase client signed in as a real user with the anon key, as the phone and the website are. */
async function signedInAs(email: string, password: string): Promise<SupabaseClient<Database>> {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY is not set (see e2e/global-setup.ts).');
  const client = createClient<Database>(process.env.SUPABASE_URL!, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return client;
}

/** A client in the demo workspace, plus a Supabase client signed in as them (the phone). */
async function newClient(lastName: string): Promise<{ id: string; phone: SupabaseClient<Database> }> {
  const email = `live-${unique()}@example.com`;
  const u = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: 'Live', last_name: lastName },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  return { id: u.data.user.id, phone: await signedInAs(email, PASSWORD) };
}

/** One workout as the phone keeps it: a squat with `sets` sets, the first `done` of them ticked off. */
function makeLog(workoutId: string | null, name: string, sets: number) {
  const ids = { log: crypto.randomUUID(), block: crypto.randomUUID(), exercise: crypto.randomUUID(), sets: Array.from({ length: sets }, () => crypto.randomUUID()) };
  const startedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  let revision = 0;
  return {
    id: ids.log,
    async save(
      phone: SupabaseClient<Database>,
      done: number,
      status: 'in_progress' | 'completed' = 'in_progress',
      { autoFinished = false, reps = 8 }: { autoFinished?: boolean; reps?: number } = {},
    ) {
      revision += 1;
      const now = new Date().toISOString();
      const doc = {
        id: ids.log,
        workoutId,
        name,
        status,
        startedAt,
        finishedAt: status === 'completed' ? now : null,
        lastActivityAt: now,
        autoFinished,
        revision,
        notes: null,
        sections: [],
        blocks: [
          {
            id: ids.block,
            kind: 'straight',
            sectionId: null,
            pickedExerciseId: null,
            exercises: [
              {
                id: ids.exercise,
                exerciseId: squatId,
                exerciseName: 'Barbell Squat',
                trackingType: 'weight_reps',
                plannedWorkoutExerciseId: null,
                swappedFromExerciseId: null,
                note: null,
                sets: ids.sets.map((id, i) => ({
                  id,
                  setType: 'normal',
                  target: { repsMin: 8, repsMax: 8, weightKg: 60, durationS: null, distanceM: null, toFailure: false, restSeconds: 90 },
                  actualReps: i < done ? reps : null,
                  actualWeightKg: i < done ? 60 : null,
                  actualDurationS: null,
                  actualDistanceM: null,
                  completedAt: i < done ? now : null,
                })),
              },
            ],
          },
        ],
      };
      const r = await phone.rpc('save_workout_log', { p_doc: doc });
      if (r.error) throw r.error;
      expect(r.data).toMatchObject({ applied: true });
    },
  };
}

/** Waits until the page's Realtime channel has joined, then marks the document so a full reload would be noticed. */
async function waitUntilLive(page: Page) {
  await expect(page.locator('[data-live="live"]')).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
}

async function expectNoReload(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
}

const LIVE = { timeout: 5_000 };
// Home and Activity wait up to 8 s while other tests keep changing logs in the same demo workspace (maxWaitMs).
const LIVE_BUSY = { timeout: 10_000 };
const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);

test('the log page fills in sets as the client ticks them off, and shows when they finish', async ({ page }) => {
  const client = await newClient(`Log${unique()}`);
  const log = makeLog(null, 'Live leg day', 3);
  await log.save(client.phone, 0);

  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/logs/${log.id}`);
  const facts = page.locator('header ul li');
  await expect(facts.filter({ hasText: /^0 sets$/ })).toBeVisible();
  await expect(page.getByText('In progress', { exact: true })).toBeVisible();
  await waitUntilLive(page);

  await log.save(client.phone, 1);
  await expect(facts.filter({ hasText: /^1 set$/ })).toBeVisible(LIVE);
  await log.save(client.phone, 2);
  await expect(facts.filter({ hasText: /^2 sets$/ })).toBeVisible(LIVE);

  await log.save(client.phone, 3, 'completed');
  await expect(facts.filter({ hasText: /^3 sets$/ })).toBeVisible(LIVE);
  await expect(facts.filter({ hasText: /^Finished / })).toBeVisible(LIVE);
  await expect(page.getByText('In progress', { exact: true })).toHaveCount(0);
  await expectNoReload(page);
});

test('Home shows the client Live (and under Training now) when they start, then Done once they finish', async ({ page }) => {
  const last = `Home${unique()}`;
  const client = await newClient(last);
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: client.id, scheduled_on: isoDay(new Date()), name: 'Live push' }).select('id').single();
  if (w.error) throw w.error;
  created.workouts.push(w.data.id);

  await signInAsCoach(page);
  await page.goto('/home');
  const row = page.locator('#today li[data-today-row]').filter({ hasText: last });
  await expect(row).toContainText('Not started');
  await waitUntilLive(page);

  const log = makeLog(w.data.id, 'Live push', 2);
  await log.save(client.phone, 0);
  await expect(row).toContainText('● Live', LIVE_BUSY);
  const card = page.getByRole('region', { name: 'Training now' }).getByRole('link', { name: new RegExp(`${last} live`) });
  await expect(card).toContainText('0 of 2 sets');
  await log.save(client.phone, 2, 'completed');
  await expect(row).toContainText('✓ Done', LIVE_BUSY);
  await expect(card).toHaveCount(0);
  await expectNoReload(page);
});

test('a finished workout appears on Activity and turns Done on the client calendar', async ({ page }) => {
  const client = await newClient(`Feed${unique()}`);
  const name = `Live feed ${unique()}`;
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: client.id, scheduled_on: isoDay(new Date()), name }).select('id').single();
  if (w.error) throw w.error;
  created.workouts.push(w.data.id);
  const log = makeLog(w.data.id, name, 1);
  await log.save(client.phone, 0);

  await signInAsCoach(page);
  await page.goto('/activity');
  await waitUntilLive(page);
  const feed = page.getByRole('link', { name, exact: true });
  await expect(feed).toHaveCount(0);
  await log.save(client.phone, 1, 'completed');
  await expect(feed).toBeVisible(LIVE_BUSY);
  await expectNoReload(page);

  // A second log on the calendar: it turns Done without a reload.
  const w2 = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: client.id, scheduled_on: isoDay(new Date()), name: `${name} two` }).select('id').single();
  if (w2.error) throw w2.error;
  created.workouts.push(w2.data.id);
  const today = isoDay(new Date());
  await page.goto(`/clients/${client.id}?month=${today.slice(0, 7)}`);
  const item = page.locator(`[data-date="${today}"]`).getByRole('listitem').filter({ hasText: `${name} two` });
  await expect(item).toBeVisible();
  await expect(item.getByRole('link', { name: /Done/ })).toHaveCount(0);
  await waitUntilLive(page);
  const log2 = makeLog(w2.data.id, `${name} two`, 1);
  await log2.save(client.phone, 1, 'completed');
  await expect(item.getByRole('link', { name: /Done/ })).toBeVisible(LIVE);
  await expectNoReload(page);
});

/** Listens, as `who`, for workout_logs changes matching `filter`; returns the ids it heard about. */
async function listen(who: SupabaseClient<Database>, filter: string) {
  const heard: string[] = [];
  const session = await who.auth.getSession();
  await who.realtime.setAuth(session.data.session?.access_token ?? null);
  const channel = who.channel(`test:${unique()}`);
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'workout_logs', filter }, (p) => {
    heard.push((p.new as { id?: string }).id ?? '');
  });
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) resolve();
      else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR || status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) reject(err ?? new Error(status));
    });
  });
  return { heard, stop: () => who.removeChannel(channel) };
}

test('Realtime sends a client\'s change to their coach, not to another client or another workspace\'s coach', async () => {
  const client = await newClient(`Rt${unique()}`);
  const other = await newClient(`RtOther${unique()}`);
  const coach = await signedInAs('coach@demo.local', 'demo-password-123');

  // A coach of another workspace, who tries to listen to the demo workspace.
  const strangerEmail = `live-stranger-${unique()}@example.com`;
  const u = await admin.auth.admin.createUser({ email: strangerEmail, password: PASSWORD, email_confirm: true, user_metadata: { first_name: 'Other', last_name: 'Coach' } });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const ws = await admin.from('workspaces').insert({ name: `Live Other Gym ${unique()}` }).select('id').single();
  if (ws.error) throw ws.error;
  created.workspaces.push(ws.data.id);
  const owner = await admin.from('workspace_members').insert({ workspace_id: ws.data.id, user_id: u.data.user.id, role: 'owner' });
  if (owner.error) throw owner.error;
  const stranger = await signedInAs(strangerEmail, PASSWORD);

  const filter = `workspace_id=eq.${workspaceId}`;
  const coachEars = await listen(coach, filter);
  const otherEars = await listen(other.phone, filter);
  const strangerEars = await listen(stranger, filter);
  try {
    const log = makeLog(null, 'Realtime check', 1);
    await log.save(client.phone, 0);
    await log.save(client.phone, 1);
    await expect.poll(() => coachEars.heard.filter((id) => id === log.id).length, LIVE).toBeGreaterThanOrEqual(2);
    // Realtime delivers to every subscriber at about the same time; give the others a further 2 s to be sure.
    await new Promise((r) => setTimeout(r, 2000));
    expect(otherEars.heard).not.toContain(log.id);
    expect(strangerEars.heard).not.toContain(log.id);
  } finally {
    await coachEars.stop();
    await otherEars.stop();
    await strangerEars.stop();
  }
});

test('a correction opened before a late sync waits until the coach has seen the newer numbers', async ({ page }) => {
  const client = await newClient(`Fix${unique()}`);
  const log = makeLog(null, 'Late sync', 2);
  // Finished automatically with one set ticked: a later sync from the phone still applies.
  await log.save(client.phone, 1, 'completed', { autoFinished: true });

  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/logs/${log.id}`);
  await waitUntilLive(page);
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByLabel('Set 1 reps').fill('9');

  // The phone syncs late: both sets ticked, set 1 at 10 reps.
  await log.save(client.phone, 2, 'completed', { autoFinished: true, reps: 10 });
  await expect(page.getByText('The client updated this workout. Review the latest numbers before saving.')).toBeVisible(LIVE);
  await expect(page.getByRole('button', { name: 'Save corrections' })).toBeDisabled();

  await page.getByRole('button', { name: 'Use latest numbers' }).click();
  await expect(page.getByLabel('Set 1 reps')).toHaveValue('10');
  await expect(page.getByText('The client updated this workout.', { exact: false })).toHaveCount(0);
  await page.getByLabel('Set 2 reps').fill('7');
  await page.getByRole('button', { name: 'Save corrections' }).click();
  await expect(page.getByRole('button', { name: 'Correct', exact: true })).toBeVisible();

  // Set 1 keeps the phone's 10 (not the 8 the coach first saw); only set 2 changed.
  const sets = await admin.from('log_sets').select('actual_reps, position').eq('log_id', log.id).order('position');
  if (sets.error) throw sets.error;
  expect(sets.data.map((r) => r.actual_reps)).toEqual([10, 7]);
  await expectNoReload(page);
});
