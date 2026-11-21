import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace, freshClient } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// Regression (QA run, 2026-11-21): browser Back (or the iPhone back swipe) from Findings reopened a cached run screen
// at test 1 with every line Normal, and "Next test" then saved those Normals over the coach's Severe marks. The run
// screen must load the saved draft fresh at the address's test, and a stale screen must never overwrite newer marks.
// At phone (touch), iPad (touch) and desktop sizes. ASSESS_SHOTS=<dir> also saves screenshots.

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
  const last = `Back${Date.now() % 100000}`;
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

const rating = (page: Page, checkpoint: string, side?: 'left' | 'right') =>
  page.getByRole('group', { name: side ? `${checkpoint}, ${side}` : checkpoint, exact: true });

async function startInitial(page: Page, clientId: string, tests: string[]): Promise<string> {
  await page.goto(`/clients/${clientId}/limitations`);
  await page.getByRole('button', { name: 'Start Initial' }).click();
  const dialog = page.getByRole('dialog', { name: 'Initial · pick tests' });
  for (const t of tests) await dialog.getByRole('checkbox', { name: t, exact: true }).check();
  await dialog.getByRole('button', { name: `Start · ${tests.length} tests` }).click();
  await page.getByRole('dialog', { name: 'Before the tests' }).getByRole('button', { name: 'Start tests' }).click();
  await expect(page).toHaveURL(/\/assessments\/[0-9a-f-]{36}$/);
  return page.url().match(/assessments\/([0-9a-f-]{36})/)![1]!;
}

/** Every stored rating of the assessment, as "test:checkpoint:side:severity", sorted; plus each test's status. */
async function savedMarks(assessmentId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('assessment_tests')
    .select('test_key, status, assessment_checkpoint_results (checkpoint_id, side, severity)')
    .eq('assessment_id', assessmentId);
  if (error) throw error;
  return data
    .flatMap((t) => [`${t.test_key}:status:${t.status}`, ...t.assessment_checkpoint_results.map((r) => `${t.test_key}:${r.checkpoint_id}:${r.side}:${r.severity}`)])
    .sort();
}

const SIZES = [
  { size: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { size: 'ipad', use: { viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true } },
  { size: 'desktop', use: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false } },
] as const;

for (const { size, use } of SIZES) {
  test.describe(`assessment Back from Findings at ${size}`, () => {
    test.use(use);

    test('Back from Findings keeps the marks, and Next saves nothing over them', async ({ page }) => {
      test.slow();
      const client = await newClient('Bea');
      await signInAsCoach(page);
      const id = await startInitial(page, client.id, ['Overhead squat', 'Single-leg squat', 'Shoulder mobility']);

      // Test 1: heels lift Severe on both sides (the QA case).
      await expect(page.getByRole('heading', { level: 1, name: 'Overhead squat' })).toBeVisible();
      await rating(page, 'Heels lift', 'left').getByRole('button', { name: 'Severe' }).click();
      await rating(page, 'Heels lift', 'right').getByRole('button', { name: 'Severe' }).click();
      await expect(page.getByText('Draft saved')).toBeVisible();
      await page.getByRole('button', { name: 'Next test' }).click();
      // Test 2: knee caves in, left, Severe.
      await expect(page.getByRole('heading', { level: 1, name: 'Single-leg squat' })).toBeVisible();
      await rating(page, 'Knee caves in', 'left').getByRole('button', { name: 'Severe' }).click();
      await expect(page.getByText('Draft saved')).toBeVisible();
      await page.getByRole('button', { name: 'Next test' }).click();
      // Test 3: shoulder hikes up, right, Slight; then Findings.
      await expect(page.getByRole('heading', { level: 1, name: 'Shoulder mobility' })).toBeVisible();
      await rating(page, 'Shoulder hikes up', 'right').getByRole('button', { name: 'Slight' }).click();
      await expect(page.getByText('Draft saved')).toBeVisible();
      await page.getByRole('button', { name: 'Review findings' }).click();
      await expect(page.getByTestId('assessment-findings')).toBeVisible();
      // Same-sounding findings of two tests carry the test's name.
      await expect(page.getByRole('list', { name: 'Observed' })).toContainText('Knee caves in · Single-leg squat');

      const before = await savedMarks(id);
      expect(before).toEqual(
        expect.arrayContaining([
          'overhead_squat:ohs.heel_rise:L:severe',
          'overhead_squat:ohs.heel_rise:R:severe',
          'single_leg_squat:sls.knee_valgus:L:severe',
          'shoulder_mobility:shm.shoulder_hike:R:slight',
        ]),
      );

      // Browser Back: the run screen at the address's test (3), with its saved mark.
      await page.goBack();
      await expect(page).toHaveURL(/\?test=3$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Shoulder mobility' })).toBeVisible();
      await expect(page.getByText('test 3 of 3')).toBeVisible();
      await expect(rating(page, 'Shoulder hikes up', 'right').getByRole('button', { name: 'Slight' })).toHaveAttribute('aria-pressed', 'true');
      await shot(page, `${size}-back-from-findings`);

      // Going on saves the same marks: nothing changes in the database.
      await page.getByRole('button', { name: 'Review findings' }).click();
      await expect(page.getByTestId('assessment-findings')).toBeVisible();
      expect(await savedMarks(id)).toEqual(before);

      // Back twice more from Findings → test 3 → (history) the earlier tests' screens show their saved marks too.
      await page.goBack();
      await expect(page.getByRole('heading', { level: 1, name: 'Shoulder mobility' })).toBeVisible();
      await page.goto(`/clients/${client.id}/assessments/${id}?test=1`);
      await expect(page.getByRole('heading', { level: 1, name: 'Overhead squat' })).toBeVisible();
      await expect(rating(page, 'Heels lift', 'left').getByRole('button', { name: 'Severe' })).toHaveAttribute('aria-pressed', 'true');
      await expect(rating(page, 'Heels lift', 'right').getByRole('button', { name: 'Severe' })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Next test' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Single-leg squat' })).toBeVisible();
      await expect(rating(page, 'Knee caves in', 'left').getByRole('button', { name: 'Severe' })).toHaveAttribute('aria-pressed', 'true');
      expect(await savedMarks(id)).toEqual(before);
    });

    if (size === 'desktop') {
      test('a screen opened before a newer save cannot write over it', async ({ page, context }) => {
        test.slow();
        const client = await newClient('Cleo');
        await signInAsCoach(page);
        const id = await startInitial(page, client.id, ['Overhead squat', 'Shoulder mobility']);
        await expect(page.getByRole('heading', { level: 1, name: 'Overhead squat' })).toBeVisible();

        // A second tab marks heels lift Severe and saves.
        const other = await context.newPage();
        await other.goto(`/clients/${client.id}/assessments/${id}?test=1`);
        await rating(other, 'Heels lift', 'left').getByRole('button', { name: 'Severe' }).click();
        await expect(other.getByText('Draft saved')).toBeVisible();
        const saved = await savedMarks(id);

        // The first tab still shows Normal everywhere: its next save is refused, not written over the Severe.
        await rating(page, 'Turn out', 'left').getByRole('button', { name: 'Slight' }).click();
        await expect(page.getByText('Reload — this assessment changed since this screen opened.')).toBeVisible();
        await page.getByRole('button', { name: 'Next test' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Overhead squat' })).toBeVisible();
        expect(await savedMarks(id)).toEqual(saved);

        // Reload shows the newer marks.
        await page.getByRole('button', { name: 'Reload' }).click();
        await expect(rating(page, 'Heels lift', 'left').getByRole('button', { name: 'Severe' })).toHaveAttribute('aria-pressed', 'true');
        await other.close();
      });
    }
  });
}
