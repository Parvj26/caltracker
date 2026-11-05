import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { expect, type Locator, type Page } from '@playwright/test';

export const COACH_EMAIL = 'coach@demo.local';

export async function signInAsCoach(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(COACH_EMAIL);
  await page.getByLabel('Password').fill('demo-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/clients$/);
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

/** Opens the picker from `button` and picks one exercise by its exact name. */
export async function pickExercise(page: Page, buttonName: string, exercise: string) {
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search exercises').fill(exercise);
  await dialog.getByRole('button', { name: exercise, exact: true }).click();
  await expect(dialog).toBeHidden();
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
