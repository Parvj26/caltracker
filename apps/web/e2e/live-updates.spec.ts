import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { serviceClient, signInAsCoach } from './helpers';

// Live updates for the coach: the phone saves through save_workout_log (as the signed-in client), and the coach's open
// page updates by itself, without a reload. Each test seeds its own client in the demo workspace.
const admin = serviceClient();
const PASSWORD = 'client-password-123';
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { workouts: string[]; users: string[] } = { workouts: [], users: [] };
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
});

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
  const phone = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await phone.auth.signInWithPassword({ email, password: PASSWORD });
  if (signedIn.error) throw signedIn.error;
  return { id: u.data.user.id, phone };
}

/** One workout as the phone keeps it: a squat with `sets` sets, the first `done` of them ticked off. */
function makeLog(workoutId: string | null, name: string, sets: number) {
  const ids = { log: crypto.randomUUID(), block: crypto.randomUUID(), exercise: crypto.randomUUID(), sets: Array.from({ length: sets }, () => crypto.randomUUID()) };
  const startedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  let revision = 0;
  return {
    id: ids.log,
    async save(phone: SupabaseClient<Database>, done: number, status: 'in_progress' | 'completed' = 'in_progress') {
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
        autoFinished: false,
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
                  actualReps: i < done ? 8 : null,
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

test('Home shows Training now when a client starts, then Done once they finish', async ({ page }) => {
  const last = `Home${unique()}`;
  const client = await newClient(last);
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: client.id, scheduled_on: isoDay(new Date()), name: 'Live push' }).select('id').single();
  if (w.error) throw w.error;
  created.workouts.push(w.data.id);

  await signInAsCoach(page);
  await page.goto('/home');
  const row = page.locator('#today li').filter({ hasText: last });
  await expect(row).toContainText('Not started');
  await waitUntilLive(page);

  const log = makeLog(w.data.id, 'Live push', 2);
  await log.save(client.phone, 0);
  await expect(row).toContainText('Training now', LIVE);
  await log.save(client.phone, 2, 'completed');
  await expect(row).toContainText('Done ✓', LIVE);
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
  await expect(feed).toBeVisible(LIVE);
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
