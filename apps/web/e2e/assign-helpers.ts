import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import type { Locator, Page } from '@playwright/test';

// Fixtures for the faster-assigning specs: fresh clients (so no other test's workouts are on their days), library
// workouts and programs seeded straight into the tables, and a click counter for the main paths.

export const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** The demo workspace's id. */
export async function demoWorkspace(admin: SupabaseClient<Database>): Promise<string> {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  return ws.data.id;
}

/** A new current client of the workspace. Delete with admin.auth.admin.deleteUser(id). */
export async function freshClient(admin: SupabaseClient<Database>, workspaceId: string, firstName: string, lastName: string): Promise<string> {
  const user = await admin.auth.admin.createUser({
    email: `assign-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });
  if (user.error) throw user.error;
  const member = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: user.data.user.id, role: 'client' });
  if (member.error) throw member.error;
  return user.data.user.id;
}

/** A library workout with one block (Barbell Squat, 2 sets of 8 at 20 kg). */
export async function seedLibraryWorkout(admin: SupabaseClient<Database>, workspaceId: string, name: string): Promise<string> {
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, name }).select('id').single();
  if (w.error) throw w.error;
  const ex = await admin.from('exercises').select('id').eq('name', 'Barbell Squat').is('workspace_id', null).limit(1).single();
  if (ex.error) throw ex.error;
  const b = await admin.from('workout_blocks').insert({ workout_id: w.data.id, workspace_id: workspaceId, position: 0 }).select('id').single();
  if (b.error) throw b.error;
  const e = await admin
    .from('workout_exercises')
    .insert({ block_id: b.data.id, workout_id: w.data.id, workspace_id: workspaceId, position: 0, exercise_id: ex.data.id })
    .select('id')
    .single();
  if (e.error) throw e.error;
  const s = await admin.from('workout_sets').insert(
    [0, 1].map((position) => ({
      workout_exercise_id: e.data.id,
      workout_id: w.data.id,
      workspace_id: workspaceId,
      position,
      target_reps_min: 8,
      target_reps_max: 8,
      target_weight_kg: 20,
    })),
  );
  if (s.error) throw s.error;
  return w.data.id;
}

/** A program with the given slots. Delete it (and its assignments) by name afterwards. */
export async function seedProgram(
  admin: SupabaseClient<Database>,
  workspaceId: string,
  name: string,
  weeks: number,
  slots: { week: number; day: number; workoutId: string }[],
): Promise<string> {
  const p = await admin.from('programs').insert({ workspace_id: workspaceId, name, weeks }).select('id').single();
  if (p.error) throw p.error;
  if (slots.length) {
    const s = await admin.from('program_workouts').insert(
      slots.map((x, position) => ({ program_id: p.data.id, workspace_id: workspaceId, week: x.week, day: x.day, workout_id: x.workoutId, position })),
    );
    if (s.error) throw s.error;
  }
  return p.data.id;
}

/** Counts the clicks a path takes: use `clicks.on(locator)` for every click of the path being measured. */
export function clickCounter() {
  let n = 0;
  return {
    on: async (target: Locator) => {
      n += 1;
      await target.click();
    },
    get count() {
      return n;
    },
  };
}

/* ---------- Plain YYYY-MM-DD maths (UTC only, never local time) ---------- */
const MS_DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(toMs(d) + n * MS_DAY).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(toMs(d)).getUTCDay() || 7; // Monday 1 ... Sunday 7
export const nextMonday = (today: string) => addDays(today, 8 - weekday(today));

/** Today in the browser's own time zone (what the app uses). */
export const browserToday = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));

export const COACH_PASSWORD = 'coach-password-123';

/**
 * A new coach with their own workspace and one client, for tests that depend on what this coach did before (their
 * Recent workouts, their last program). Delete the users and workspace afterwards.
 */
export async function newCoachWithClient(admin: SupabaseClient<Database>, tag: string) {
  const mk = async (email: string, first: string, last: string, password: string) => {
    const u = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: first, last_name: last } });
    if (u.error) throw u.error;
    return u.data.user.id;
  };
  const email = `${tag.toLowerCase()}-coach-${unique()}@example.com`;
  const coachId = await mk(email, 'Cora', 'Coach', COACH_PASSWORD);
  const ws = await admin.from('workspaces').insert({ name: `${tag} ${unique()}` }).select('id').single();
  if (ws.error) throw ws.error;
  const m = await admin.from('workspace_members').insert({ workspace_id: ws.data.id, user_id: coachId, role: 'owner' });
  if (m.error) throw m.error;
  const clientLast = `${tag}${unique()}`;
  const clientId = await mk(`${tag.toLowerCase()}-client-${unique()}@example.com`, 'Cleo', clientLast, 'client-password-123');
  const c = await admin.from('workspace_members').insert({ workspace_id: ws.data.id, user_id: clientId, role: 'client' });
  if (c.error) throw c.error;
  return { email, coachId, workspaceId: ws.data.id, clientId, clientName: `Cleo ${clientLast}` };
}

export async function deleteCoach(admin: SupabaseClient<Database>, c: { coachId: string; clientId: string; workspaceId: string }) {
  await admin.from('workspaces').delete().eq('id', c.workspaceId);
  await admin.auth.admin.deleteUser(c.clientId);
  await admin.auth.admin.deleteUser(c.coachId);
}

export async function signInAs(page: Page, email: string, password = COACH_PASSWORD) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/home$/);
}
