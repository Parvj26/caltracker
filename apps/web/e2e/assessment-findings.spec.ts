import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace, freshClient } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// Movement assessments, step 2 (boards AS4, AS5, AS5b): after the tests the coach reviews the findings (confirm,
// reject, change, add marks on the list and the body map), picks corrective exercises per confirmed muscle (their own
// first), makes the suggested workout, edits it in the normal builder and assigns it to the client's calendar.
// The coach's own corrective exercise is seeded here (the Corrective library screens are a separate PR).
// ASSESS_SHOTS=<dir> also saves screenshots there, to compare with the boards.

const admin = serviceClient();

// One worker runs the three sizes in turn: beforeAll / afterAll run per worker, so parallel sizes would each seed a
// DNS Star into the shared demo workspace and delete it when done. Every coach-owned corrective is picked first, so
// one size would pick another's DNS Star; once that was deleted, saving the picks failed (the exercise check in
// assessment_exercise_picks' policy, shown as "You can't assess this client").
test.describe.configure({ mode: 'default' });
const createdUsers: string[] = [];
const createdExercises: string[] = [];
let workspaceId: string;
let dnsName: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
  // "DNS Star", the coach's own: activate / strengthen glute medius, both sides, 2 × 5 each side.
  dnsName = `DNS Star ${crypto.randomUUID().slice(0, 8)}`;
  const ex = await admin.from('exercises').insert({ workspace_id: workspaceId, source: 'custom', name: dnsName, tracking_type: 'reps' }).select('id').single();
  if (ex.error) throw ex.error;
  createdExercises.push(ex.data.id);
  const c = await admin
    .from('corrective_exercises')
    .insert({ workspace_id: workspaceId, exercise_id: ex.data.id, direction: 'under', default_sets: 2, default_reps: 5, each_side: true })
    .select('id')
    .single();
  if (c.error) throw c.error;
  const m = await admin.from('corrective_exercise_muscles').insert([
    { corrective_id: c.data.id, workspace_id: workspaceId, muscle_id: 'glute_medius', side: 'L' },
    { corrective_id: c.data.id, workspace_id: workspaceId, muscle_id: 'glute_medius', side: 'R' },
  ]);
  if (m.error) throw m.error;
});

test.afterAll(async () => {
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  // Removing the exercise takes its corrective tags with it (cascade).
  for (const id of createdExercises) await admin.from('exercises').delete().eq('id', id);
});

async function newClient(first: string): Promise<{ id: string; name: string }> {
  const last = `Find${Date.now() % 100000}`;
  const id = await freshClient(admin, workspaceId, first, last);
  createdUsers.push(id);
  return { id, name: `${first} ${last}` };
}

async function shot(page: Page, name: string) {
  const dir = process.env.ASSESS_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

async function expectNoSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

const rating = (page: Page, checkpoint: string, side?: 'left' | 'right') =>
  page.getByRole('group', { name: side ? `${checkpoint}, ${side}` : checkpoint, exact: true });

const region = (page: Page, key: string) => page.locator(`[data-testid="findings-map"] [data-region="${key}"]:visible`).first();

const SIZES = [
  { size: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { size: 'ipad', use: { viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true } },
  { size: 'desktop', use: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false } },
] as const;

for (const { size, use } of SIZES) {
  test.describe(`assessment findings at ${size}`, () => {
    test.use(use);

    test('review findings, edit marks, pick exercises, make the suggested workout and put it on the calendar', async ({ page }) => {
      test.slow();
      const client = await newClient('Vaishali');
      await signInAsCoach(page);
      await page.goto(`/clients/${client.id}/limitations`);

      // A quick Initial: the overhead squat with knees caving in (L severe, R slight) and a heel lift on the left.
      await page.getByRole('button', { name: 'Start Initial' }).click();
      const pick = page.getByRole('dialog', { name: 'Initial · pick tests' });
      await pick.getByRole('checkbox', { name: 'Overhead squat', exact: true }).check();
      await pick.getByRole('button', { name: 'Start · 1 test' }).click();
      await page.getByRole('dialog', { name: 'Before the tests' }).getByRole('button', { name: 'Start tests' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Overhead squat' })).toBeVisible();
      await rating(page, 'Cave in (valgus)', 'left').getByRole('button', { name: 'Severe' }).click();
      await rating(page, 'Cave in (valgus)', 'right').getByRole('button', { name: 'Slight' }).click();
      await rating(page, 'Heels lift', 'left').getByRole('button', { name: 'Slight' }).click();
      await expect(page.getByText('Draft saved')).toBeVisible();
      await page.getByRole('button', { name: 'Review findings' }).click();

      // ---------- Findings (AS4) ----------
      await expect(page.getByTestId('assessment-findings')).toBeVisible();
      await expect(page).toHaveURL(/\/findings$/);
      await expect(page.getByRole('list', { name: 'Observed' })).toContainText('Knees cave in');
      const gluteMed = page.getByTestId('mark-glute_medius-under');
      await expect(gluteMed).toContainText('from Knees cave in');
      await expect(page.getByTestId('mark-adductors-over')).toBeVisible();
      await expect(page.getByTestId('mark-calves-over')).toContainText('Heels lift');
      await expect(page.getByText('Ankle mobility')).toBeVisible();
      await shot(page, `${size}-AS4-findings-suggested`);

      // Confirm glute medius both sides; reject TFL on the right; change adductors to Normal.
      await gluteMed.getByRole('button', { name: 'Confirm left Glute medius' }).click();
      await gluteMed.getByRole('button', { name: 'Confirm right Glute medius' }).click();
      await expect(gluteMed.getByRole('button', { name: 'Confirm left Glute medius' })).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('mark-tfl-over').getByRole('button', { name: 'Reject right TFL' }).click();
      await page.getByTestId('mark-adductors-over').getByRole('button', { name: 'Change Adductors' }).click();
      await page.getByRole('group', { name: 'Adductors: change to' }).getByRole('button', { name: /Normal/ }).click();
      await expect(page.getByTestId('mark-adductors-normal')).toBeVisible();
      // Tick "Also check".
      await page.getByRole('checkbox', { name: /Ankle mobility/ }).check();

      // The body map: only confirmed sides are coloured; tap a region to mark it.
      if (size === 'phone') await page.getByRole('button', { name: 'Body map', exact: true }).click();
      await expect(region(page, 'glute_medius.L')).toHaveAttribute('data-state', 'under');
      await expect(region(page, 'calves.L')).toHaveAttribute('data-state', 'unmarked');
      await page.getByRole('radio', { name: /^Left calf/ }).first().click();
      const picker = page.getByTestId('map-picker');
      await expect(picker).toContainText('Calves · L');
      await shot(page, `${size}-AS4-map-picker`);
      await picker.getByRole('button', { name: /Possibly overactive/ }).click();
      await expect(region(page, 'calves.L')).toHaveAttribute('data-state', 'over');
      await expectNoSidewaysScroll(page);
      await shot(page, `${size}-AS4-map`);
      if (size === 'phone') await page.getByRole('button', { name: 'List', exact: true }).click();

      // "+ Add muscle": upper traps on the left, possibly overactive.
      await page.getByRole('button', { name: '+ Add muscle' }).click();
      const add = page.getByRole('dialog', { name: 'Add a muscle' });
      await add.getByLabel('Muscle group').selectOption('upper_traps');
      await add.getByRole('radio', { name: 'L', exact: true }).click();
      await add.getByTestId('add-muscle-save').click();
      await expect(add).toBeHidden();
      await expect(page.getByTestId('mark-upper_traps-over')).toContainText('added by you');
      await expect(page.getByText('Draft saved')).toBeVisible();
      await shot(page, `${size}-AS4-findings-reviewed`);

      // Saved as a draft: a reload keeps every decision.
      await page.reload();
      await expect(page.getByTestId('mark-glute_medius-under').getByRole('button', { name: 'Confirm right Glute medius' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('mark-tfl-over').getByRole('button', { name: 'Reject right TFL' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('checkbox', { name: /Ankle mobility/ })).toBeChecked();

      // ---------- Exercises (AS5) ----------
      await page.getByTestId('pick-exercises').click();
      await expect(page.getByTestId('assessment-exercises')).toBeVisible();
      const gmGroup = page.getByTestId('ex-group-glute_medius-under');
      const dns = gmGroup.getByRole('button', { name: new RegExp(dnsName) });
      await expect(dns).toContainText('Yours');
      await expect(dns).toContainText('2 × 5 each side');
      // The coach's own are picked before the first pick.
      await expect(dns).toHaveAttribute('aria-pressed', 'true');
      // Other specs may have their own corrective exercises in the demo workspace right now (and delete them when
      // done): keep only this test's own picked among the coach's.
      const others = page.locator('[data-testid^="ex-group-"] button[aria-pressed="true"]').filter({ hasText: 'Yours' }).filter({ hasNotText: dnsName });
      while ((await others.count()) > 0) {
        const n = await others.count();
        await others.first().click();
        await expect(others).toHaveCount(n - 1);
      }
      await expect(page.getByTestId('ex-group-calves-over')).toBeVisible();
      await expect(page.getByTestId('ex-group-upper_traps-over')).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `${size}-AS5-exercises`);
      // Untick and tick again (autosaves).
      await dns.click();
      await expect(dns).toHaveAttribute('aria-pressed', 'false');
      await dns.click();
      await expect(dns).toHaveAttribute('aria-pressed', 'true');

      // ---------- Suggested workout in the builder (AS5b) ----------
      await page.getByTestId('make-suggested').click();
      const sheet = page.getByRole('dialog', { name: 'Suggested workout' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText(dnsName).filter({ visible: true }).first()).toBeVisible();
      await expect(sheet.getByRole('textbox', { name: /name/i }).first()).toHaveValue('Corrective – Vaishali');
      await shot(page, `${size}-AS5b-builder`);
      await sheet.getByRole('button', { name: 'Assign to client' }).first().click();
      const day = page.getByRole('dialog', { name: `Assign to ${client.name}` });
      await expect(day).toBeVisible();
      await shot(page, `${size}-AS5b-assign`);
      await day.getByTestId('assign-day-confirm').click();

      // On the client's calendar, and in the database with the dose filled in.
      await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/training`));
      await expect(page.getByText('Corrective – Vaishali').first()).toBeVisible();
      const saved = await admin
        .from('workouts')
        .select('id, name, workout_blocks (workout_exercises (exercise_id, each_side, workout_sets (target_reps_min, rest_seconds)))')
        .eq('client_id', client.id)
        .eq('name', 'Corrective – Vaishali')
        .single();
      expect(saved.error).toBeNull();
      const dnsRow = saved.data!.workout_blocks.flatMap((b) => b.workout_exercises).find((e) => e.exercise_id === createdExercises[0]);
      expect(dnsRow?.each_side).toBe(true);
      expect(dnsRow?.workout_sets.map((s) => [s.target_reps_min, s.rest_seconds])).toEqual([
        [5, 45],
        [5, 45],
      ]);
      await shot(page, `${size}-AS5b-on-calendar`);

      // The assessment is finished: the summary shows the confirmed findings, and they are locked.
      const a = await admin.from('assessments').select('id, status').eq('client_id', client.id).single();
      expect(a.data?.status).toBe('done');
      await page.goto(`/clients/${client.id}/assessments/${a.data!.id}`);
      const findings = page.getByTestId('summary-findings');
      await expect(findings.getByTestId('confirmed-findings')).toContainText('Glute medius · L R');
      await expect(findings.getByTestId('confirmed-findings')).toContainText('Upper traps · L');
      await expect(findings.getByTestId('confirmed-findings')).not.toContainText('TFL');
      await expect(page.getByTestId('report-priorities')).toContainText('Glute medius · L R');
      await expect(page.getByTestId('report-suggested').getByRole('link', { name: 'Open in builder' })).toBeVisible();
      await shot(page, `${size}-AS6-summary-findings`);
      await findings.getByRole('link', { name: 'Findings' }).click();
      await expect(page.getByText('This assessment is finished, so its findings are locked.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Confirm left Glute medius' })).toHaveCount(0);
    });
  });
}
