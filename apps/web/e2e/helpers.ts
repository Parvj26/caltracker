import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

/** The web app under test (same port as playwright.config.ts: E2E_WEB_PORT, 3000 by default). */
export const WEB_URL = `http://localhost:${process.env.E2E_WEB_PORT ?? '3000'}`;

/** Local Supabase's mail catcher (Mailpit). MAILPIT_URL overrides it, e.g. on the CI port range. */
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

export const COACH_EMAIL = 'coach@demo.local';

/** Where the setup project (auth.setup.ts) saves the demo coach's signed-in cookies. Git-ignored. */
export const COACH_STATE = join(__dirname, '.auth', 'coach.json');

/** Signs in through the real sign-in form (the setup project, and specs that test signing in itself). */
export async function signInThroughForm(page: Page, email = COACH_EMAIL, password = 'demo-password-123') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/**
 * Starts this page signed in as the demo coach, on the Clients page. Reuses the session the setup project saved once
 * per run instead of filling the sign-in form in every test (sign-in.spec covers the form itself). Falls back to the
 * form when the saved session is missing, e.g. a run with --no-deps.
 * Never sign this shared session out: signing out ends it for every test in the run. Sign-out tests use their own.
 */
export async function signInAsCoach(page: Page) {
  if (existsSync(COACH_STATE)) {
    const state = JSON.parse(readFileSync(COACH_STATE, 'utf8')) as { cookies: Parameters<BrowserContext['addCookies']>[0] };
    await page.context().clearCookies();
    await page.context().addCookies(state.cookies);
  } else {
    await signInThroughForm(page);
  }
  // Most specs start from the Clients page (home.spec covers the landing page itself).
  await page.goto('/clients');
}

/** Service-role client: test fixtures and cleanup only, never app code. */
export function serviceClient(): SupabaseClient<Database> {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const out = execSync('supabase status -o env', { encoding: 'utf8' });
    const get = (name: string) => out.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm'))?.[1];
    url = get('API_URL');
    key = get('SERVICE_ROLE_KEY');
  }
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or run local Supabase.');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/** One set row of the builder, e.g. setRow(page, 'Barbell Squat', 'set 1') or 'drop after set 3'. */
export function setRow(page: Page, exercise: string, row: string): Locator {
  return page.getByRole('group', { name: `${exercise} ${row}`, exact: true });
}

/**
 * Opens the picker from `button` and picks one exercise by its exact name. "+ Exercise" picks several (tap each, then
 * "Add N exercises"); the swap picker adds the one exercise straight away.
 */
export async function pickExercise(page: Page, buttonName: string, exercise: string) {
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search exercises').fill(exercise);
  await dialog.getByRole('option', { name: exercise, exact: true }).click();
  if (buttonName === '+ Exercise') await dialog.getByRole('button', { name: 'Add 1 exercise', exact: true }).click();
  else await dialog.getByRole('button', { name: 'Add to workout', exact: true }).click();
  await expect(dialog).toBeHidden();
}

const SECTION_PRESETS = ['Warm-Up', 'Core', 'Main', 'Finisher', 'Cool-down'];

/** Adds a section at the end of the builder: a preset by its name, anything else through "Custom…". */
export async function addSection(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Section', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Add a section', exact: true });
  if (SECTION_PRESETS.includes(name)) {
    await menu.getByRole('button', { name, exact: true }).click();
  } else {
    await menu.getByRole('button', { name: 'Custom…', exact: true }).click();
    await menu.getByLabel('Custom section name').fill(name);
    await menu.getByRole('button', { name: 'Add section', exact: true }).click();
  }
  await expect(menu).toBeHidden();
  await expect(page.getByRole('group', { name: `Section ${name}`, exact: true })).toBeVisible();
}

/** Builds and saves a 1-block workout through the UI: Barbell Squat, 3 sets of 8 at 60 (coach's units, kg by default). */
export async function createWorkout(page: Page, name: string): Promise<void> {
  await page.goto('/workouts/new');
  await page.getByLabel('Workout name').fill(name);
  await pickExercise(page, '+ Exercise', 'Barbell Squat');
  for (const n of [1, 2, 3]) {
    const row = setRow(page, 'Barbell Squat', `set ${n}`);
    await row.getByLabel('Reps', { exact: true }).fill('8');
    await row.getByLabel(/^Weight/).fill('60');
  }
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Saved')).toBeVisible();
}

/** One day of the program grid, e.g. programCell(page, 1, 4) is "Week 1, Day 4". */
export function programCell(page: Page, week: number, day: number): Locator {
  return page.getByRole('group', { name: `Week ${week}, Day ${day}`, exact: true });
}

/**
 * Creates a program through the UI, then puts library workouts on it with each cell's "+" button (the keyboard and
 * touch path). Ends on the program page with every change saved.
 */
export async function createProgram(
  page: Page,
  name: string,
  weeks: number,
  slots: { week: number; day: number; workoutName: string }[],
): Promise<void> {
  await page.goto('/programs/new');
  await page.getByLabel('Program name').fill(name);
  await page.getByLabel('Weeks', { exact: true }).fill(String(weeks));
  await page.getByRole('button', { name: 'Create program' }).click();
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  for (const slot of slots) {
    await page.getByRole('button', { name: `Add a workout to week ${slot.week}, day ${slot.day}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Add a workout to Week ${slot.week}, Day ${slot.day}` });
    await dialog.getByLabel('Search workouts').fill(slot.workoutName);
    await dialog.getByRole('button', { name: slot.workoutName, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(programCell(page, slot.week, slot.day).getByRole('button', { name: slot.workoutName, exact: true })).toBeVisible();
  }
  if (slots.length > 0) await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
}

export type SeedLogOptions = {
  workspaceId: string;
  clientId: string;
  name: string;
  /** The planned (client calendar) workout this log follows; omit for an unplanned log. */
  plannedWorkoutId?: string | null;
  status?: 'in_progress' | 'completed' | 'discarded';
  /** ISO timestamps. A completed log needs finishedAt. */
  startedAt: string;
  finishedAt?: string | null;
  autoFinished?: boolean;
  /** Completed sets of Barbell Squat at `weightKg` x `reps` (default 3 at 60 x 8 = 1,440 kg). */
  sets?: number;
  weightKg?: number;
  reps?: number;
  /** The last `notDone` sets are unticked (no actuals, not completed). */
  notDone?: number;
  /** Name of the exercise the squat replaced ("Swapped from ..."). */
  swappedFrom?: string;
  /** Name of a second exercise the client added on top of the plan (it has no planned counterpart). */
  addedExercise?: string;
  /** Sections the blocks can point at. */
  sections?: { id: string; name: string }[];
  /** Who logged it (workout_logs.logged_by): the client on the phone, or a coach in a session. Default none. */
  loggedBy?: string;
  /**
   * Replaces the default single squat block. Each exercise gets `sets` sets (default 2); the exercises being done
   * (all of a straight block, only the picked one of a pick-one group) have them ticked. `picked` is the name of
   * the picked option, or null/omitted for a pick-one group nobody has chosen from.
   */
  blocks?: SeedLogBlock[];
};

export type SeedLogBlock = { sectionId?: string; choice?: boolean; picked?: string | null; exercises: string[]; sets?: number };

/**
 * Inserts a finished (or in-progress, or discarded) workout log with one Barbell Squat exercise, straight into the
 * tables with the service role (the phone's save_workout_log needs the client's own session). Returns the log id;
 * delete it with `admin.from('workout_logs').delete().eq('id', id)` (the tree goes with it).
 */
export async function seedLog(admin: SupabaseClient<Database>, o: SeedLogOptions): Promise<string> {
  const status = o.status ?? 'completed';
  const sets = o.sets ?? 3;
  const finishedAt = o.finishedAt ?? (status === 'in_progress' ? null : o.startedAt);
  const exercise = await admin.from('exercises').select('id').eq('name', 'Barbell Squat').is('workspace_id', null).limit(1).single();
  if (exercise.error) throw exercise.error;

  const named = async (name: string) => {
    const r = await admin.from('exercises').select('id').eq('name', name).or(`workspace_id.is.null,workspace_id.eq.${o.workspaceId}`).limit(1).single();
    if (r.error) throw r.error;
    return r.data.id;
  };
  const swappedFromId = o.swappedFrom ? await named(o.swappedFrom) : null;
  const addedId = o.addedExercise ? await named(o.addedExercise) : null;

  const log = await admin
    .from('workout_logs')
    .insert({
      workspace_id: o.workspaceId,
      client_id: o.clientId,
      workout_id: o.plannedWorkoutId ?? null,
      name: o.name,
      status,
      started_at: o.startedAt,
      finished_at: finishedAt,
      last_activity_at: finishedAt ?? o.startedAt,
      auto_finished: o.autoFinished ?? false,
      logged_by: o.loggedBy ?? null,
    })
    .select('id')
    .single();
  if (log.error) throw log.error;
  const logId = log.data.id;

  if (o.blocks) {
    const names = new Map(o.sections?.map((x) => [x.id, x.name]));
    for (const [position, b] of o.blocks.entries()) {
      const blockId = crypto.randomUUID();
      const exIds = b.exercises.map(() => crypto.randomUUID());
      const pickedId = b.choice && b.picked ? exIds[b.exercises.indexOf(b.picked)] : undefined;
      const bi = await admin.from('log_blocks').insert({
        id: blockId, log_id: logId, workspace_id: o.workspaceId, client_id: o.clientId, position,
        kind: b.choice ? 'choice' : 'straight',
        section_id: b.sectionId ?? null, section_name: b.sectionId ? (names.get(b.sectionId) ?? null) : null,
        picked_exercise_id: pickedId ?? null,
      });
      if (bi.error) throw bi.error;
      for (const [k, name] of b.exercises.entries()) {
        const exercise_id = await named(name);
        const le = await admin.from('log_exercises').insert({
          id: exIds[k]!, block_id: blockId, log_id: logId, workspace_id: o.workspaceId, client_id: o.clientId, position: k, exercise_id,
          planned_workout_exercise_id: o.plannedWorkoutId ? crypto.randomUUID() : null,
        });
        if (le.error) throw le.error;
        const live = !b.choice || exIds[k] === pickedId;
        const rows = Array.from({ length: b.sets ?? 2 }, (_, p) => ({
          log_exercise_id: exIds[k]!, log_id: logId, workspace_id: o.workspaceId, client_id: o.clientId, position: p,
          target_reps_min: 8, target_reps_max: 8, target_weight_kg: 20,
          actual_reps: live ? 8 : null, actual_weight_kg: live ? 20 : null, completed_at: live ? (finishedAt ?? o.startedAt) : null,
        }));
        const ss = await admin.from('log_sets').insert(rows);
        if (ss.error) throw ss.error;
      }
    }
    return logId;
  }

  const block = await admin.from('log_blocks').insert({ log_id: logId, workspace_id: o.workspaceId, client_id: o.clientId, position: 0 }).select('id').single();
  if (block.error) throw block.error;
  const ex = await admin
    .from('log_exercises')
    .insert({ block_id: block.data.id, log_id: logId, workspace_id: o.workspaceId, client_id: o.clientId, position: 0, exercise_id: exercise.data.id, swapped_from_exercise_id: swappedFromId, planned_workout_exercise_id: o.plannedWorkoutId ? crypto.randomUUID() : null })
    .select('id')
    .single();
  if (ex.error) throw ex.error;
  if (sets > 0) {
    const rows = Array.from({ length: sets }, (_, position) => {
      const done = position < sets - (o.notDone ?? 0);
      return {
      log_exercise_id: ex.data.id,
      log_id: logId,
      workspace_id: o.workspaceId,
      client_id: o.clientId,
      position,
      target_reps_min: 8,
      target_reps_max: 8,
      target_weight_kg: o.weightKg ?? 60,
      actual_reps: done ? (o.reps ?? 8) : null,
      actual_weight_kg: done ? (o.weightKg ?? 60) : null,
      completed_at: done ? (finishedAt ?? o.startedAt) : null,
      };
    });
    const inserted = await admin.from('log_sets').insert(rows);
    if (inserted.error) throw inserted.error;
  }
  if (addedId) {
    const b2 = await admin.from('log_blocks').insert({ log_id: logId, workspace_id: o.workspaceId, client_id: o.clientId, position: 1 }).select('id').single();
    if (b2.error) throw b2.error;
    const e2 = await admin
      .from('log_exercises')
      .insert({ block_id: b2.data.id, log_id: logId, workspace_id: o.workspaceId, client_id: o.clientId, position: 0, exercise_id: addedId })
      .select('id')
      .single();
    if (e2.error) throw e2.error;
    const s2 = await admin.from('log_sets').insert({
      log_exercise_id: e2.data.id, log_id: logId, workspace_id: o.workspaceId, client_id: o.clientId, position: 0,
      actual_reps: 10, actual_weight_kg: 20, completed_at: finishedAt ?? o.startedAt,
    });
    if (s2.error) throw s2.error;
  }
  return logId;
}

/**
 * Inserts a client's scheduled workout with sections: one block per entry, each exercise with 2 sets of 8 at 20 kg.
 * Delete it with `admin.from('workouts').delete().eq('id', id)`.
 */
export async function seedSectionedWorkout(
  admin: SupabaseClient<Database>,
  o: { workspaceId: string; clientId: string; name: string; scheduledOn: string; sections: { id: string; name: string }[]; blocks: SeedLogBlock[] },
): Promise<string> {
  const w = await admin.from('workouts').insert({ workspace_id: o.workspaceId, client_id: o.clientId, scheduled_on: o.scheduledOn, name: o.name }).select('id').single();
  if (w.error) throw w.error;
  const names = new Map(o.sections.map((x) => [x.id, x.name]));
  for (const [position, b] of o.blocks.entries()) {
    const blk = await admin.from('workout_blocks').insert({
      workout_id: w.data.id, workspace_id: o.workspaceId, client_id: o.clientId, position, kind: b.choice ? 'choice' : 'straight',
      section_id: b.sectionId ?? null, section_name: b.sectionId ? (names.get(b.sectionId) ?? null) : null,
    }).select('id').single();
    if (blk.error) throw blk.error;
    for (const [k, name] of b.exercises.entries()) {
      const ex = await admin.from('exercises').select('id').eq('name', name).or(`workspace_id.is.null,workspace_id.eq.${o.workspaceId}`).limit(1).single();
      if (ex.error) throw ex.error;
      const we = await admin.from('workout_exercises').insert({
        block_id: blk.data.id, workout_id: w.data.id, workspace_id: o.workspaceId, client_id: o.clientId, position: k, exercise_id: ex.data.id,
      }).select('id').single();
      if (we.error) throw we.error;
      const sets = await admin.from('workout_sets').insert(
        [0, 1].map((p) => ({
          workout_exercise_id: we.data.id, workout_id: w.data.id, workspace_id: o.workspaceId, client_id: o.clientId, position: p,
          target_reps_min: 8, target_reps_max: 8, target_weight_kg: 20,
        })),
      );
      if (sets.error) throw sets.error;
    }
  }
  return w.data.id;
}
