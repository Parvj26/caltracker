import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { LOG_TREE_SELECT, addDays, completeSet, logRowToDoc, setLogNotes, type Database, type LogTreeRow } from '@caltracker/shared';
import { COACH_EMAIL, seedLog, seedSectionedWorkout, serviceClient, signInAsCoach } from './helpers';

// Coach session logging (docs/superpowers/specs/2026-11-06-coach-session-logging-design.md): the coach logs a client's
// workout from the website, and only one person logs a workout at a time. Each test uses its own client, because a
// client can have only one workout in progress.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { logs: string[]; workouts: string[]; users: string[]; workspaces: string[] } = { logs: [], workouts: [], users: [], workspaces: [] };
let workspaceId: string;
let coachId: string;

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const coach = data.users.find((u) => u.email === COACH_EMAIL);
  if (!coach) throw new Error('Demo coach not found; run pnpm db:reset.');
  coachId = coach.id;
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
});

test.afterAll(async () => {
  const logs = await admin.from('workout_logs').select('id').in('workout_id', created.workouts);
  const ids = [...created.logs, ...(logs.data ?? []).map((l) => l.id)];
  if (ids.length) await admin.from('workout_logs').delete().in('id', ids);
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
  for (const id of created.workspaces) await admin.from('workspaces').delete().eq('id', id);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const browserToday = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));

/** Signs a client in as their phone would (anon key + password), for the phone's own save_workout_log. */
async function phoneOf(email: string) {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    const out = execSync('supabase status -o env', { encoding: 'utf8' });
    const get = (name: string) => out.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm'))?.[1];
    url = get('API_URL');
    key = get('ANON_KEY');
  }
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY, or run local Supabase.');
  const phone = createClient<Database>(url, key, { auth: { persistSession: false } });
  const { error } = await phone.auth.signInWithPassword({ email, password: 'client-password-123' });
  if (error) throw error;
  return phone;
}

async function newClient(firstName: string, inWorkspace = workspaceId): Promise<string> {
  const u = await admin.auth.admin.createUser({
    email: `session-${firstName.toLowerCase()}-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: `Session${unique()}` },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: inWorkspace, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  return u.data.user.id;
}

async function plan(clientId: string, name: string, date: string, inWorkspace = workspaceId): Promise<string> {
  const id = await seedSectionedWorkout(admin, { workspaceId: inWorkspace, clientId, name, scheduledOn: date, sections: [], blocks: [{ exercises: ['Barbell Squat'] }] });
  created.workouts.push(id);
  return id;
}

test('the coach logs today\'s workout from the calendar, and it counts as the client\'s, logged by coach', async ({ page }) => {
  await signInAsCoach(page);
  const client = await newClient('Sasha');
  const today = await browserToday(page);
  const name = `Session ${unique()}`;
  const workoutId = await plan(client, name, today);

  await page.goto(`/clients/${client}/training?view=month&from=${today}`);
  await page.locator(`[data-date="${today}"]`).getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Log session' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client}/log/${workoutId}$`));

  await page.getByRole('button', { name: 'Start session' }).click();
  // Saved at once, so the client's phone shows "Your coach is logging this session".
  await expect
    .poll(async () => (await admin.from('workout_logs').select('logged_by, status').eq('workout_id', workoutId).maybeSingle()).data)
    .toEqual({ logged_by: coachId, status: 'in_progress' });

  // The table is pre-filled from the coach's targets (2 × 8 at 20 kg); the coach types 10 reps on set 1 and ticks it.
  await page.getByLabel('REPS, Barbell Squat Set 1 of 2').fill('10');
  const tick1 = page.getByRole('button', { name: 'Done: Barbell Squat Set 1 of 2' });
  await tick1.click();
  await expect(tick1).toHaveAttribute('aria-pressed', 'true');
  // Still editable after the tick.
  await page.getByLabel('REPS, Barbell Squat Set 1 of 2').fill('11');
  await page.getByRole('button', { name: 'Mark all' }).click();
  await expect(page.getByRole('button', { name: 'Done: Barbell Squat Set 2 of 2' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Finish session' }).click();
  // The finished log opens at once; the award is asked for from there, so a slow award never holds Finish up.
  await expect(page).toHaveURL(new RegExp(`/clients/${client}/logs/[0-9a-f-]{36}(\\?award=1)?$`));
  await expect(page.getByText('Logged by coach', { exact: true })).toBeVisible();

  const log = await admin.from('workout_logs').select('id, client_id, logged_by, status').eq('workout_id', workoutId).single();
  if (log.error) throw log.error;
  expect(log.data).toMatchObject({ client_id: client, logged_by: coachId, status: 'completed' });
  const sets = await admin.from('log_sets').select('position, actual_reps, completed_at').eq('log_id', log.data.id).order('position');
  expect(sets.data?.map((s) => [s.actual_reps, s.completed_at !== null])).toEqual([
    [11, true],
    [8, true],
  ]);

  // Activity and the calendar show who logged it.
  await page.goto(`/activity?client=${client}`);
  await expect(page.getByRole('row', { name: new RegExp(name) }).getByText('Logged by coach')).toBeVisible();
  await page.goto(`/clients/${client}/training?view=month&from=${today}`);
  const card = page.locator(`[data-date="${today}"]`).getByRole('listitem').filter({ hasText: name });
  await expect(card.getByRole('link', { name: `Done: view the ${name} log` })).toBeVisible();
  await expect(card.getByText('Logged by coach', { exact: true })).toBeVisible();

  // Its plan is locked now that it is done, but the coach can still fix the logged results.
  await card.getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit results' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client}/logs/${log.data.id}$`));
  await page.getByLabel('Set 1 reps').fill('9');
  await page.getByRole('button', { name: 'Save corrections' }).click();
  await expect(page.getByText('Edited by coach')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await admin.from('log_sets').select('actual_reps').eq('log_id', log.data.id).order('position').limit(1).single()).data?.actual_reps)
    .toBe(9);
  await expect.poll(async () => (await admin.from('workout_logs').select('logged_by').eq('id', log.data.id).single()).data?.logged_by).toBe(coachId);
});

test('while the client logs on the phone the coach watches, views, then takes over', async ({ page }) => {
  await signInAsCoach(page);
  const client = await newClient('Parv');
  const today = await browserToday(page);
  const name = `Phone ${unique()}`;
  const workoutId = await plan(client, name, today);
  const logId = await seedLog(admin, {
    workspaceId, clientId: client, name, plannedWorkoutId: workoutId, status: 'in_progress', startedAt: ago(10), sets: 3, notDone: 2, loggedBy: client,
  });
  created.logs.push(logId);

  await page.goto(`/clients/${client}/log/${workoutId}`);
  await expect(page.getByText('Parv is logging this now on their phone')).toBeVisible();
  await expect(page.getByText(/1 of 3 sets done/)).toBeVisible();
  await page.getByRole('button', { name: 'View only' }).click();
  await expect(page.getByRole('region', { name: 'What they have logged so far' })).toBeVisible();

  await page.getByRole('button', { name: 'Take over' }).click();
  await expect(page.getByRole('button', { name: 'Finish session' })).toBeVisible();
  const row = await admin.from('workout_logs').select('logged_by').eq('id', logId).single();
  expect(row.data?.logged_by).toBe(coachId);
  // The page now logs it, and says so.
  await expect(page.getByText(/Logged by you/)).toBeVisible();

  // Hand it back: the client's phone holds it again.
  await page.getByRole('button', { name: 'Hand back to Parv' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client}/training$`));
  await expect.poll(async () => (await admin.from('workout_logs').select('logged_by').eq('id', logId).single()).data?.logged_by).toBe(client);
});

test('a set the phone ticked just before the take over is kept, with the coach\'s own set on top', async ({ page }) => {
  await signInAsCoach(page);
  const client = await newClient('Kai');
  const email = (await admin.auth.admin.getUserById(client)).data.user!.email!;
  const today = await browserToday(page);
  const name = `Final ${unique()}`;
  const workoutId = await plan(client, name, today);
  const logId = await seedLog(admin, {
    workspaceId, clientId: client, name, plannedWorkoutId: workoutId, status: 'in_progress', startedAt: ago(10), sets: 3, notDone: 2, loggedBy: client,
  });
  created.logs.push(logId);
  const row = await admin.from('workout_logs').select(LOG_TREE_SELECT).eq('id', logId).single();
  if (row.error) throw row.error;
  const before = logRowToDoc(row.data as unknown as LogTreeRow);

  await page.goto(`/clients/${client}/log/${workoutId}`);
  await page.getByRole('button', { name: 'Take over' }).click();
  await expect(page.getByRole('button', { name: 'Finish session' })).toBeVisible();

  // The phone had ticked set 2 and written a note, and uploads them only now (its final save): applied once.
  const phone = await phoneOf(email);
  const set2 = before.blocks[0]!.exercises[0]!.sets[1]!.id;
  const phoneDoc = setLogNotes(completeSet(before, set2, new Date().toISOString()), 'Knee felt fine', new Date().toISOString());
  const saved = await phone.rpc('save_workout_log', { p_doc: phoneDoc as never });
  expect(saved.error).toBeNull();
  expect(saved.data).toMatchObject({ applied: true, loggedByOther: true });

  // The coach ticks set 3 on the older copy: the save is stale, so the page takes the server copy (with the phone's
  // set and note) and re-applies the coach's tick on top.
  await page.getByRole('button', { name: 'Done: Barbell Squat Set 3 of 3' }).click();
  await expect(page.getByText(/This session changed somewhere else/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done: Barbell Squat Set 2 of 3' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Done: Barbell Squat Set 3 of 3' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Session note (the client sees it)')).toHaveValue('Knee felt fine');
  await expect
    .poll(async () => (await admin.from('log_sets').select('completed_at').eq('log_id', logId)).data?.filter((x) => x.completed_at !== null).length)
    .toBe(3);
  const after = await admin.from('workout_logs').select('logged_by, notes').eq('id', logId).single();
  expect(after.data).toEqual({ logged_by: coachId, notes: 'Knee felt fine' });
});

test('a later day\'s workout can\'t be started, even from a direct link', async ({ page }) => {
  await signInAsCoach(page);
  const client = await newClient('Lee');
  const today = await browserToday(page);
  const later = await plan(client, `Later ${unique()}`, addDays(today, 3));
  await page.goto(`/clients/${client}/log/${later}`);
  await expect(page.getByText('This workout is on a later day. You can log it with Lee on the day, or afterwards if it is missed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start session' })).toHaveCount(0);
  // Tomorrow passes the server's loose check (time zones), so the browser refuses it.
  const tomorrow = await plan(client, `Tomorrow ${unique()}`, addDays(today, 1));
  await page.goto(`/clients/${client}/log/${tomorrow}`);
  await expect(page.getByText(/This workout is on a later day/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start session' })).toHaveCount(0);
  expect((await admin.from('workout_logs').select('id').in('workout_id', [later, tomorrow])).data).toEqual([]);
});

test('another client\'s workout, another workspace\'s client and a past client have no session page', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  const mine = await newClient('Mia');
  const other = await newClient('Ola');
  const othersWorkout = await plan(other, `Other ${unique()}`, today);
  expect((await page.goto(`/clients/${mine}/log/${othersWorkout}`))?.status()).toBe(404);

  const ws = await admin.from('workspaces').insert({ name: `Elsewhere ${unique()}` }).select('id').single();
  if (ws.error) throw ws.error;
  created.workspaces.push(ws.data.id);
  const stranger = await newClient('Sam', ws.data.id);
  const foreign = await plan(stranger, `Foreign ${unique()}`, today, ws.data.id);
  expect((await page.goto(`/clients/${stranger}/log/${foreign}`))?.status()).toBe(404);
});
