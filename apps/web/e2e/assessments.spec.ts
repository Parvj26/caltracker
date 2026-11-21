import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace, freshClient } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// Movement assessments, step 1 (boards AS1, AS2, AS3, AS6): the "Limitations & injuries" tab, starting an Initial,
// running tests with Normal / Slight / Severe per side, finishing (through step 2's Findings and Exercises) with the
// Movement score, and picking a draft up
// again. At phone (touch), iPad (touch) and desktop sizes. Each test makes its own client.
// ASSESS_SHOTS=<dir> also saves screenshots there, to compare with the boards.

const admin = serviceClient();
const created: string[] = [];
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

async function newClient(first: string): Promise<{ id: string; name: string }> {
  const last = `Assess${Date.now() % 100000}`;
  const id = await freshClient(admin, workspaceId, first, last);
  created.push(id);
  return { id, name: `${first} ${last}` };
}

async function shot(page: Page, name: string) {
  const dir = process.env.ASSESS_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

/** One side of a checkpoint: its Normal / Slight / Severe group. */
const rating = (page: Page, checkpoint: string, side?: 'left' | 'right') =>
  page.getByRole('group', { name: side ? `${checkpoint}, ${side}` : checkpoint, exact: true });

async function expectNoSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** Opens the start pop-up from the tab and starts an Initial with these tests. */
async function startInitial(page: Page, tests: string[], size: string) {
  await page.getByRole('button', { name: 'Start Initial' }).click();
  const dialog = page.getByRole('dialog', { name: 'Initial · pick tests' });
  await expect(dialog).toBeVisible();
  // Nothing picked yet: Start says why it can't go on.
  await expect(dialog.getByRole('button', { name: 'Start · 0 tests' })).toHaveAttribute('aria-disabled', 'true');
  // Smart search (typos too).
  await dialog.getByRole('searchbox', { name: 'Search tests' }).fill('sqaut');
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await dialog.getByRole('searchbox', { name: 'Search tests' }).fill('');
  await expect(dialog.getByRole('checkbox')).toHaveCount(9);
  for (const t of tests) await dialog.getByRole('checkbox', { name: t, exact: true }).check();
  await shot(page, `${size}-AS2-pick-tests`);
  await dialog.getByRole('button', { name: `Start · ${tests.length} tests` }).click();

  const before = page.getByRole('dialog', { name: 'Before the tests' });
  await expect(before.getByText('Shoes on. Look at the feet standing.')).toBeVisible();
  await expect(before.getByRole('radiogroup', { name: 'Left foot arch' }).getByRole('radio', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
  await before.getByRole('radiogroup', { name: 'Left foot arch' }).getByRole('radio', { name: 'Flat' }).click();
  await shot(page, `${size}-AS2-before-the-tests`);
  await before.getByRole('button', { name: 'Start tests' }).click();
  await expect(page).toHaveURL(/\/assessments\/[0-9a-f-]{36}$/);
}

/** After the last test: Findings (step 2), then Exercises, then "Finish without a workout" → the summary. */
async function finishWithoutWorkout(page: Page) {
  await expect(page.getByTestId('assessment-findings')).toBeVisible();
  await page.getByTestId('pick-exercises').click();
  await expect(page.getByTestId('assessment-exercises')).toBeVisible();
  await page.getByTestId('finish-without-workout').click();
}

const SIZES = [
  { size: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { size: 'ipad', use: { viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true } },
  { size: 'desktop', use: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false } },
] as const;

for (const { size, use } of SIZES) {
  test.describe(`assessments at ${size}`, () => {
    test.use(use);

    test('start an Initial, run two tests with a mix of severities, finish, and see the score', async ({ page }) => {
      test.slow();
      const client = await newClient('Vera');
      await signInAsCoach(page);
      await page.goto(`/clients/${client.id}`);
      const tabs = page.getByRole('navigation', { name: 'Client sections' });
      await tabs.getByRole('link', { name: 'Limitations & injuries' }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/limitations$`));
      await expect(page).toHaveTitle(new RegExp(`^Limitations & injuries · ${client.name} · Clients`));

      // First time: Cycle 1, Initial not done yet, both retests waiting; the flags card (step 4) is beside it.
      const card = page.getByTestId('assessments-card');
      await expect(card.getByText('Cycle 1')).toBeVisible();
      await expect(page.getByTestId('slot-initial')).toContainText('Not done yet');
      await expect(page.getByTestId('slot-retest_1')).toContainText('After Initial');
      await expect(page.getByTestId('slot-retest_2')).toContainText('Optional');
      await expect(page.getByRole('heading', { name: 'Limitations & injuries', level: 2 })).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `${size}-AS1-first-time`);

      await startInitial(page, ['Overhead squat', 'Shoulder mobility'], size);

      // Test 1: overhead squat.
      await expect(page.getByRole('heading', { level: 1, name: 'Overhead squat' })).toBeVisible();
      await expect(page.getByText('test 1 of 2')).toBeVisible();
      await expect(page.getByText('Squat slowly a few times')).toBeVisible();
      // Normal is pre-selected on every line.
      await expect(rating(page, 'Cave in (valgus)', 'left').getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
      await rating(page, 'Cave in (valgus)', 'left').getByRole('button', { name: 'Severe' }).click();
      await rating(page, 'Cave in (valgus)', 'right').getByRole('button', { name: 'Slight' }).click();
      // Tapping Slight again goes back to Normal; tap it once more to keep Slight.
      const heelsL = rating(page, 'Heels lift', 'left');
      await heelsL.getByRole('button', { name: 'Slight' }).click();
      await expect(page.getByText('Heel-lift follow-up')).toBeVisible();
      await heelsL.getByRole('button', { name: 'Slight' }).click();
      await expect(heelsL.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('Heel-lift follow-up')).toHaveCount(0);
      await heelsL.getByRole('button', { name: 'Slight' }).click();
      await page.getByRole('group', { name: 'Heel-lift follow-up' }).getByRole('button', { name: 'Better' }).click();
      // The side view: behind a switch on a phone, beside the front view on bigger screens.
      if (size === 'phone') {
        await expect(rating(page, 'Arms fall forward', 'left')).toBeHidden();
        await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Side' }).click();
      }
      await rating(page, 'Arms fall forward', 'left').getByRole('button', { name: 'Severe' }).click();
      await page.getByRole('textbox', { name: 'Note' }).fill('Calves felt tight');
      await expect(page.getByText('Draft saved')).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `${size}-AS3-overhead-squat`);
      await page.getByRole('button', { name: 'Next test' }).click();

      // Test 2: shoulder mobility (measured).
      await expect(page.getByRole('heading', { level: 1, name: 'Shoulder mobility' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Shoulder mobility gap · top hand, left' }).fill('14');
      await page.getByRole('textbox', { name: 'Shoulder mobility gap · top hand, right' }).fill('99');
      await expect(page.getByText('Enter a number from 0 to 60.')).toBeVisible();
      await page.getByRole('textbox', { name: 'Shoulder mobility gap · top hand, right' }).fill('11');
      await rating(page, 'Shoulder hikes up', 'left').getByRole('button', { name: 'Slight' }).click();
      await page.getByRole('button', { name: 'Discomfort left' }).click();
      await expect(page.getByRole('button', { name: 'Discomfort left' })).toHaveAttribute('aria-pressed', 'true');
      await shot(page, `${size}-AS3-shoulder-mobility`);
      await page.getByRole('button', { name: 'Review findings' }).click();
      await finishWithoutWorkout(page);

      // The summary: 30 − 6 = 24 of 30 on the squat (80), 3 of 4 on the shoulders (75), 27 of 34 overall (79, Good).
      await expect(page.getByTestId('assessment-summary')).toBeVisible();
      await expect(page.getByTestId('movement-score')).toHaveText('79');
      const score = page.getByTestId('score-card');
      await expect(score.getByText('Good')).toBeVisible();
      await expect(score.getByRole('list', { name: 'Score per test' }).getByRole('listitem')).toHaveText([/Overhead squat\s*80/, /Shoulder mobility\s*75/]);
      const observed = page.getByRole('list', { name: 'Observed' });
      await expect(observed.getByRole('listitem').first()).toContainText('Knees cave in');
      await expect(observed.getByRole('listitem').first()).toContainText('L · Severe');
      await expect(observed.getByRole('listitem').first()).toContainText('R · Slight');
      await expect(observed).toContainText('Heels lift');
      await expect(observed).toContainText('Shoulder hikes up');
      await expect(page.getByRole('row', { name: /Shoulder mobility gap/ })).toContainText('14 cm');
      await expect(page.getByRole('row', { name: /Foot arch/ })).toContainText('Flat');
      await expect(page.getByText('Heel-lift follow-up: Better')).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `${size}-AS6-summary`);

      // Back on the tab: Initial done with its score, Retest 1 due four weeks later, the findings card.
      await page.getByRole('link', { name: `Back to ${client.name} · Limitations & injuries` }).click();
      await expect(page.getByTestId('slot-initial')).toContainText('score 79');
      await expect(page.getByTestId('slot-retest_1')).toContainText('Due');
      await expect(page.getByRole('button', { name: 'Start Retest 1' })).toBeVisible();
      await expect(page.getByTestId('latest-findings')).toContainText('Knees cave in');
      await shot(page, `${size}-AS1-retest-due`);

      // A retest starts from the Initial's tests.
      await page.getByRole('button', { name: 'Start Retest 1' }).click();
      const pick = page.getByRole('dialog', { name: 'Retest 1 · pick tests' });
      await expect(pick.getByRole('checkbox', { name: 'Overhead squat', exact: true })).toBeChecked();
      await expect(pick.getByRole('checkbox', { name: 'Shoulder mobility', exact: true })).toBeChecked();
      await expect(pick.getByRole('checkbox', { name: 'Push-up', exact: true })).not.toBeChecked();
      await expect(pick.getByText('Front + side · shoes on · as Initial')).toBeVisible();
      await shot(page, `${size}-AS2-retest`);
      await pick.getByRole('button', { name: 'Cancel' }).click();
      await expect(pick).toBeHidden();
    });

    test('a draft is saved as the coach goes, and resumes where it was left', async ({ page }) => {
      test.slow();
      const client = await newClient('Rhea');
      await signInAsCoach(page);
      await page.goto(`/clients/${client.id}/limitations`);
      await startInitial(page, ['Single-leg squat', 'Push-up'], size);

      await expect(page.getByRole('heading', { level: 1, name: 'Single-leg squat' })).toBeVisible();
      await rating(page, 'Knee caves in', 'right').getByRole('button', { name: 'Severe' }).click();
      await page.getByRole('button', { name: 'Next test' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Push-up' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Type done' }).fill('Incline, hands on bench');
      await rating(page, 'Hips sag').getByRole('button', { name: 'Slight' }).click();
      await expect(page.getByText('Draft saved')).toBeVisible();

      // Close: the draft stays, and the tab offers to resume it.
      await page.getByRole('button', { name: 'Close (your draft is kept)' }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/limitations$`));
      await expect(page.getByTestId('slot-initial')).toContainText('In progress');
      await page.getByRole('link', { name: 'Resume Initial' }).click();

      // It opens on the test not finished yet, with what was entered.
      await expect(page.getByRole('heading', { level: 1, name: 'Push-up' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Type done' })).toHaveValue('Incline, hands on bench');
      await expect(rating(page, 'Hips sag').getByRole('button', { name: 'Slight' })).toHaveAttribute('aria-pressed', 'true');
      // A reload keeps it too.
      await page.reload();
      await expect(rating(page, 'Hips sag').getByRole('button', { name: 'Slight' })).toHaveAttribute('aria-pressed', 'true');

      // Stop test keeps what was entered; the summary shows it, and a stopped test isn't scored.
      await page.getByRole('button', { name: 'Stop test' }).click();
      await finishWithoutWorkout(page);
      await expect(page.getByTestId('assessment-summary')).toBeVisible();
      // Only the single-leg squat counts: 10 lines, R knee severe → 18 of 20 = 90.
      await expect(page.getByTestId('movement-score')).toHaveText('90');
      await expect(page.getByTestId('score-card')).toContainText('Not scored: Push-up (stopped).');
      await expect(page.getByRole('list', { name: 'Observed' })).toContainText('Hips sag');
    });
  });
}
