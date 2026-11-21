import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';
import { SIZES } from './ui-audit-rules';

// CW6: a linked superset's "+ Set ▾" adds a set to every exercise (each copies its own last set); ▾ → "Only <name>"
// adds to that one exercise. CW7: slim set rows on every size: the column names once, one row per set, and on touch
// screens the focused box's − / + in the × spot (the row keeps its height, focus stays in the box). At phone, iPad and
// desktop sizes. Screenshots go to CW_SHOTS_DIR when it is set.

const admin = serviceClient();
const SHOTS = process.env.CW_SHOTS_DIR;
const created: string[] = [];
test.afterAll(async () => {
  if (created.length) await admin.from('workouts').delete().in('id', created);
});

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const A = 'Barbell Squat';
const B = 'Barbell Deadlift';

/** A library workout: one superset of A (3 × 12 @ 40 kg, rest 0) and B (3 × 10 @ 20 kg, rest 1:30). */
async function seedSuperset(): Promise<string> {
  const workspaceId = await demoWorkspace(admin);
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, name: `Superset ${unique()}` }).select('id').single();
  if (w.error) throw w.error;
  created.push(w.data.id);
  const blk = await admin.from('workout_blocks').insert({ workout_id: w.data.id, workspace_id: workspaceId, position: 0, kind: 'superset' }).select('id').single();
  if (blk.error) throw blk.error;
  for (const [position, [name, reps, kg, rest]] of ([[A, 12, 40, 0], [B, 10, 20, 90]] as const).entries()) {
    const ex = await admin.from('exercises').select('id').eq('name', name).is('workspace_id', null).limit(1).single();
    if (ex.error) throw ex.error;
    const we = await admin
      .from('workout_exercises')
      .insert({ block_id: blk.data.id, workout_id: w.data.id, workspace_id: workspaceId, position, exercise_id: ex.data.id })
      .select('id')
      .single();
    if (we.error) throw we.error;
    const sets = await admin.from('workout_sets').insert(
      [0, 1, 2].map((p) => ({
        workout_exercise_id: we.data.id,
        workout_id: w.data.id,
        workspace_id: workspaceId,
        position: p,
        target_reps_min: reps,
        target_reps_max: reps,
        target_weight_kg: kg,
        rest_seconds: rest,
      })),
    );
    if (sets.error) throw sets.error;
  }
  return w.data.id;
}

async function savedCounts(id: string): Promise<Record<string, number>> {
  const { data, error } = await admin.from('workout_sets').select('workout_exercises!inner(exercises!inner(name))').eq('workout_id', id);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of data) {
    const n = (r.workout_exercises).exercises.name;
    out[n] = (out[n] ?? 0) + 1;
  }
  return out;
}

/** Opens exercise A: on a phone or iPad portrait its row opens it on its own screen; wider, the pane shows it. */
async function openA(page: Page, id: string) {
  await signInAsCoach(page);
  await page.goto(`/workouts/${id}`);
  const listRow = page.getByRole('button', { name: new RegExp(`^${A}: `) }).locator('visible=true');
  const box = page.getByRole('group', { name: `${A} set 1`, exact: true }).locator('visible=true');
  await expect(box.or(listRow).first()).toBeVisible();
  if (await listRow.count()) await listRow.first().click();
  await expect(box).toBeVisible();
}

async function save(page: Page) {
  // Back to the list first on the phone editor.
  const done = page.getByRole('button', { name: 'Done', exact: true });
  if (await done.isVisible()) await done.click();
  // dispatchEvent: in `next dev` its corner badge sits over the phone's Save.
  await page.getByRole('button', { name: 'Save workout' }).locator('visible=true').first().dispatchEvent('click');
  await expect(page.getByText('Saved').first()).toBeVisible();
}

for (const { size, use } of SIZES) {
  test.describe(size, () => {
    test.use(use);

    test('CW6: + Set on a superset adds one to every exercise; ▾ Only adds to one', async ({ page }) => {
      const id = await seedSuperset();
      await openA(page, id);
      await shot(page, `cw6-${size}-superset-open`);
      await expect(page.getByRole('button', { name: `Add a set to ${A}`, exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'More ways to add a set' }).locator('visible=true').first().click();
      const only = page.getByRole('menuitem', { name: new RegExp(`^Only ${A} \\(\\w+\\)$`) });
      await expect(only).toBeVisible();
      await shot(page, `cw6-${size}-menu-open`);
      await only.click();
      await expect(page.getByRole('group', { name: `${A} set 4`, exact: true }).locator('visible=true')).toBeVisible();
      await save(page);
      expect(await savedCounts(id)).toEqual({ [A]: 4, [B]: 3 });

      const id2 = await seedSuperset();
      await openA(page, id2);
      await page.getByRole('button', { name: 'Add a set to every exercise in the superset' }).locator('visible=true').first().click();
      const fourth = page.getByRole('group', { name: `${A} set 4`, exact: true }).locator('visible=true');
      await expect(fourth).toBeVisible();
      // A copy of A's own last set (12 reps @ 40 kg), not B's.
      await expect(fourth.getByLabel('Reps')).toHaveValue('12');
      await expect(fourth.getByLabel('Weight (kg)')).toHaveValue('40');
      await shot(page, `cw6-${size}-after-round`);
      await save(page);
      expect(await savedCounts(id2)).toEqual({ [A]: 4, [B]: 4 });
    });

    test('CW7: slim rows: column names once; − / + only for the focused box, focus kept, row height kept', async ({ page }) => {
      const id = await seedSuperset();
      await openA(page, id);
      const set2 = page.getByRole('group', { name: `${A} set 2`, exact: true }).locator('visible=true');
      const weight = set2.getByLabel('Weight (kg)');
      const height = (await set2.boundingBox())!.height;
      // No − / + anywhere until a box has focus; × is in its slot.
      await expect(page.getByRole('button', { name: 'More weight' }).locator('visible=true')).toHaveCount(0);
      await expect(set2.getByRole('button', { name: 'Remove set 2' })).toBeVisible();
      await shot(page, `cw7-${size}-rows`);
      await weight.click();
      if (size === 'desktop') {
        // A desktop with a mouse has no − / +.
        await expect(set2.getByRole('button', { name: 'More weight' })).toBeHidden();
        await expect(set2.getByRole('button', { name: 'Remove set 2' })).toBeVisible();
      } else {
        await expect(set2.getByRole('button', { name: 'More weight' })).toBeVisible();
        await expect(set2.getByRole('button', { name: 'Remove set 2' })).toBeHidden();
        await shot(page, `cw7-${size}-weight-focused`);
        await set2.getByRole('button', { name: 'More weight' }).click();
        await expect(weight).toBeFocused();
        await expect(weight).toHaveValue('42.5');
        await set2.getByRole('button', { name: 'Less weight' }).click();
        await set2.getByRole('button', { name: 'Less weight' }).click();
        await expect(weight).toHaveValue('37.5');
        await expect(weight).toBeFocused();
        expect(Math.abs((await set2.boundingBox())!.height - height)).toBeLessThanOrEqual(1);
        // Reps: its own − / +.
        await set2.getByLabel('Reps').click();
        await expect(set2.getByRole('button', { name: 'More reps' })).toBeVisible();
        await expect(set2.getByRole('button', { name: 'More weight' })).toHaveCount(0);
      }
      // Rest (B has it): only the quick picks, no − / +.
      expect(height).toBeGreaterThan(0);
    });

    test('CW7: the Rest box shows the quick picks in the slim row', async ({ page }) => {
      const id = await seedSuperset();
      await signInAsCoach(page);
      await page.goto(`/workouts/${id}`);
      const listRow = page.getByRole('button', { name: new RegExp(`^${B}: `) }).locator('visible=true');
      const card = page.getByRole('button', { name: new RegExp(B) }).locator('visible=true');
      await expect(listRow.or(card).first()).toBeVisible();
      if (await listRow.count()) await listRow.first().click();
      else await card.first().click();
      const set1 = page.getByRole('group', { name: `${B} set 1`, exact: true }).locator('visible=true');
      await set1.getByLabel('Rest (m:ss)').click();
      const picks = page.getByRole('group', { name: 'Quick rest' });
      await expect(picks).toBeVisible();
      await expect(set1.getByRole('button', { name: /^(More|Less|Fewer)/ })).toHaveCount(0);
      await picks.getByRole('button', { name: '1:00' }).click();
      await expect(set1.getByLabel('Rest (m:ss)')).toBeFocused();
      await expect(set1.getByLabel('Rest (m:ss)')).toHaveValue('1:00');
      await shot(page, `cw7-${size}-rest-picks`);
    });

    test('an empty workout says "No exercises yet." once, with "+ Exercise" only in its bar', async ({ page }) => {
      await signInAsCoach(page);
      await page.goto('/workouts/new');
      await expect(page.getByText('No exercises yet.').locator('visible=true')).toBeVisible();
      await expect(page.getByRole('button', { name: '+ Add exercises' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '+ Exercise', exact: true }).locator('visible=true')).toHaveCount(1);
      await shot(page, `empty-${size}`);
    });

    if (size === 'phone') {
      test('CW7: four sets and the add bar fit a phone screen with Safari’s bars', async ({ page }) => {
        // Safari's top and bottom bars leave about 750 of 844 points.
        await page.setViewportSize({ width: 390, height: 750 });
        const id = await seedSuperset();
        await openA(page, id);
        await page.getByRole('button', { name: 'Add a set to every exercise in the superset' }).click();
        const set4 = page.getByRole('group', { name: `${A} set 4`, exact: true });
        await expect(set4).toBeVisible();
        const bar = (await page.getByRole('button', { name: 'Done', exact: true }).boundingBox())!;
        const last = (await set4.boundingBox())!;
        expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
        await shot(page, `cw7-phone-four-sets`);
      });
    }
  });
}
