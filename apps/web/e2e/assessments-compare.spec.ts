import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace, freshClient } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// Movement assessments, step 3 (boards AS1, AS2, AS6, AS7, AS11): save a template in Library › Corrective, start an
// Initial from it, run it, start Retest 1 "Same as Initial", run it, open Compare (68 → 85, the board's example) and
// the printable report. At phone (touch), iPad (touch) and desktop sizes; each test makes its own client and template.
// ASSESS_SHOTS=<dir> also saves screenshots there, to compare with the boards.

const admin = serviceClient();
const createdUsers: string[] = [];
const createdTemplates: string[] = [];
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  for (const name of createdTemplates) await admin.from('assessment_templates').delete().eq('workspace_id', workspaceId).eq('name', name);
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
});

async function shot(page: Page, name: string) {
  const dir = process.env.ASSESS_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

const rating = (page: Page, checkpoint: string, side?: 'left' | 'right') =>
  page.getByRole('group', { name: side ? `${checkpoint}, ${side}` : checkpoint, exact: true });

async function expectNoSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

type Rate = [checkpoint: string, side: 'left' | 'right' | null, severity: 'Slight' | 'Severe'];

/** Runs the overhead squat then shoulder mobility, with these ratings and gaps, and finishes (through Findings). */
async function runTwoTests(page: Page, phone: boolean, front: Rate[], side: Rate[], gap: [number, number], shoulder: Rate[]) {
  await expect(page.getByRole('heading', { level: 1, name: 'Overhead squat' })).toBeVisible();
  for (const [c, s, sev] of front) await rating(page, c, s ?? undefined).getByRole('button', { name: sev }).click();
  if (phone) await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Side' }).click();
  for (const [c, s, sev] of side) await rating(page, c, s ?? undefined).getByRole('button', { name: sev }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.getByRole('button', { name: 'Next test' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Shoulder mobility' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Shoulder mobility gap · top hand, left' }).fill(String(gap[0]));
  await page.getByRole('textbox', { name: 'Shoulder mobility gap · top hand, right' }).fill(String(gap[1]));
  for (const [c, s, sev] of shoulder) await rating(page, c, s ?? undefined).getByRole('button', { name: sev }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  // Step 2: the last test opens Findings; finish from Exercises without a workout.
  await page.getByRole('button', { name: 'Review findings' }).click();
  await expect(page.getByTestId('assessment-findings')).toBeVisible();
  await page.getByTestId('pick-exercises').click();
  await page.getByTestId('finish-without-workout').click();
  await expect(page.getByTestId('assessment-summary')).toBeVisible();
}

const SIZES = [
  { size: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { size: 'ipad', use: { viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true } },
  { size: 'desktop', use: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false } },
] as const;

for (const { size, use } of SIZES) {
  test.describe(`assessment report, compare and templates at ${size}`, () => {
    test.use(use);

    test('save a template, run an Initial from it and a retest, then compare and open the report', async ({ page }) => {
      test.slow();
      test.setTimeout(240_000);
      const phone = size === 'phone';
      const stamp = `${Date.now() % 100000}`;
      const templateName = `Squat and shoulders ${size} ${stamp}`;
      createdTemplates.push(templateName);
      const clientId = await freshClient(admin, workspaceId, 'Vaishali', `Compare${stamp}`);
      createdUsers.push(clientId);
      const clientName = `Vaishali Compare${stamp}`;
      await signInAsCoach(page);

      // ---- Library › Corrective › Templates (AS11): make a template ----
      // Library › Corrective lands on Exercises (AS8); Templates is the next section.
      await page.goto('/corrective');
      await expect(page).toHaveURL(/\/corrective\/exercises$/);
      await page.getByRole('navigation', { name: 'Corrective sections' }).getByRole('link', { name: 'Templates' }).click();
      await expect(page).toHaveURL(/\/corrective\/templates$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Corrective' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Library sections' }).getByRole('link', { name: 'Corrective' })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'New template' }).click();
      const editor = phone ? page.getByRole('dialog', { name: 'New template' }) : page.getByTestId('template-editor');
      await expect(editor).toBeVisible();
      // Nothing yet: Save says why it can't.
      await expect(editor.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
      await editor.getByRole('textbox', { name: 'Template name' }).fill(templateName);
      const picker = editor.getByRole('group', { name: 'Add a test' });
      // Smart search, typos too.
      await picker.getByRole('searchbox', { name: 'Search tests' }).fill('shouldr');
      await picker.getByRole('button', { name: /^Shoulder mobility/ }).click();
      await editor.getByRole('button', { name: '+ Add test' }).click();
      await editor.getByRole('group', { name: 'Add a test' }).getByRole('button', { name: /^Overhead squat/ }).click();
      await editor.getByRole('button', { name: '+ Add test' }).click();
      await editor.getByRole('group', { name: 'Add a test' }).getByRole('button', { name: /^Push-up/ }).click();
      const tests = editor.getByRole('list', { name: /tests · in this order/ }).getByRole('listitem');
      await expect(tests).toHaveCount(3);
      // Reorder: the squat first. Swap the push-up for posture, then remove posture.
      await editor.getByRole('button', { name: 'Move Overhead squat up' }).click();
      await expect(tests.nth(0)).toContainText('Overhead squat');
      await editor.getByRole('button', { name: 'Swap Push-up for another test' }).click();
      await editor.getByRole('group', { name: 'Swap Push-up for' }).getByRole('button', { name: /^Posture/ }).click();
      await expect(tests.nth(2)).toContainText('Posture');
      await shot(page, `${size}-AS11-edit-template`);
      await editor.getByRole('button', { name: 'Remove Posture' }).click();
      await expect(tests).toHaveCount(2);
      await editor.getByRole('button', { name: 'Save' }).click();
      if (phone) await expect(editor).toBeHidden();
      // The row's name is what it shows: the template's name and its number of tests.
      await expect(page.getByRole('button', { name: `${templateName} 2 tests`, exact: true })).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `${size}-AS11-templates`);

      // A name already taken is refused, from the start.
      await page.getByRole('button', { name: 'New template' }).click();
      const second = phone ? page.getByRole('dialog', { name: 'New template' }) : page.getByTestId('template-editor');
      await second.getByRole('textbox', { name: 'Template name' }).fill(templateName.toUpperCase());
      await second.getByRole('textbox', { name: 'Template name' }).blur();
      await expect(second.getByText('You already have a template with that name.')).toBeVisible();
      if (phone) {
        await second.getByRole('button', { name: 'Cancel' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
        await expect(second).toBeHidden();
      } else {
        await second.getByRole('button', { name: 'Cancel' }).click();
      }

      // ---- Start an Initial from the template (AS2) ----
      await page.goto(`/clients/${clientId}/limitations`);
      await page.getByRole('button', { name: 'Start Initial' }).click();
      const pick = page.getByRole('dialog', { name: 'Initial · pick tests' });
      await pick.getByRole('button', { name: templateName }).click();
      await expect(pick.getByRole('button', { name: templateName })).toHaveAttribute('aria-pressed', 'true');
      await expect(pick.getByRole('checkbox', { name: 'Overhead squat', exact: true })).toBeChecked();
      await expect(pick.getByRole('checkbox', { name: 'Shoulder mobility', exact: true })).toBeChecked();
      await expect(pick.getByRole('checkbox', { name: 'Push-up', exact: true })).not.toBeChecked();
      await expect(pick.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/corrective/templates');
      await shot(page, `${size}-AS2-template-picked`);
      await pick.getByRole('button', { name: 'Start · 2 tests' }).click();
      await page.getByRole('dialog', { name: 'Before the tests' }).getByRole('button', { name: 'Start tests' }).click();

      // The board's Initial: 67 on the squat, 75 on the shoulders, 68 overall (Fair).
      await runTwoTests(
        page,
        phone,
        [
          ['Cave in (valgus)', 'left', 'Severe'],
          ['Cave in (valgus)', 'right', 'Slight'],
          ['Heels lift', 'left', 'Slight'],
          ['Heels lift', 'right', 'Slight'],
        ],
        [
          ['Arms fall forward', 'left', 'Severe'],
          ['Arms fall forward', 'right', 'Severe'],
          ['Pokes forward', null, 'Slight'],
        ],
        [14, 11],
        [['Shoulder hikes up', 'left', 'Slight']],
      );
      await expect(page.getByTestId('movement-score')).toHaveText('68');
      await expect(page.getByTestId('score-card')).toContainText('Fair');

      // ---- Retest 1, "Same as Initial" (AS2) ----
      await page.getByRole('link', { name: `Back to ${clientName} · Limitations & injuries` }).click();
      await page.getByRole('button', { name: 'Start Retest 1' }).click();
      const retestPick = page.getByRole('dialog', { name: 'Retest 1 · pick tests' });
      await expect(retestPick.getByRole('button', { name: 'Same as Initial' })).toHaveAttribute('aria-pressed', 'true');
      await expect(retestPick.getByRole('button', { name: templateName })).toHaveAttribute('aria-pressed', 'false');
      await retestPick.getByRole('button', { name: 'Start · 2 tests' }).click();
      await page.getByRole('dialog', { name: 'Before the tests' }).getByRole('button', { name: 'Start tests' }).click();
      // The board's Retest 1: 83 and 100, 85 overall (Great).
      await runTwoTests(
        page,
        phone,
        [['Cave in (valgus)', 'left', 'Slight']],
        [
          ['Low back arches', null, 'Slight'],
          ['Arms fall forward', 'left', 'Slight'],
          ['Arms fall forward', 'right', 'Slight'],
          ['Pokes forward', null, 'Slight'],
        ],
        [10, 9],
        [],
      );
      await expect(page.getByTestId('movement-score')).toHaveText('85');

      // ---- The report (AS6) ----
      await expect(page.getByText(/Checked by .+ on /)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `${size}-AS6-report`);
      // Printed: one column, no menu, no buttons, no back link.
      await page.emulateMedia({ media: 'print' });
      await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
      await expect(page.getByText(`${clientName} · Movement assessment`)).toBeVisible();
      await shot(page, `${size}-AS6-report-print`);
      await page.emulateMedia({ media: 'screen' });

      // ---- Compare (AS7) ----
      // A confirmed muscle mark on each, so Compare has body maps to draw.
      const { data: done } = await admin.from('assessments').select('id, slot').eq('client_id', clientId);
      for (const a of done ?? []) {
        const { error } = await admin.from('assessment_muscle_marks').insert({
          assessment_id: a.id,
          workspace_id: workspaceId,
          muscle_id: 'glute_medius',
          side: 'L',
          status: a.slot === 'initial' ? 'under' : 'normal',
          review: 'confirmed',
          sources: ['ohs.knee_valgus'],
        });
        expect(error).toBeNull();
      }
      await page.getByRole('link', { name: 'Compare', exact: true }).click();
      await expect(page).toHaveURL(/\/assessments\/compare\/[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Compare · Cycle 1' })).toBeVisible();
      await expect(page.getByTestId('compare-overall')).toHaveText('68 → 85');
      await expect(page.getByTestId('compare-overall-delta')).toHaveText('+17');
      const perTest = page.getByRole('list', { name: 'Score per test' }).getByRole('listitem');
      await expect(perTest).toHaveText([/Overhead squat\s*67 → 83\s*\+16/, /Shoulder mobility\s*75 → 100\s*\+25/]);
      await expect(page.getByTestId('finding-counts')).toHaveText(/5 improved\s*1 same\s*1 new\s*0 worse/);
      await expect(page.getByTestId('measure-counts')).toHaveText('2 improved');
      // The body maps draw (QA 2026-11-21: they were 0 px wide, only the key showed), and on a phone follow the two picked.
      const maps = page.getByTestId('compare-maps');
      await expect(maps.locator('section')).toHaveCount(2);
      for (const svg of await maps.locator('svg[data-view]').all()) {
        const box = await svg.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(50);
        expect(box?.height ?? 0).toBeGreaterThan(50);
      }
      if (phone) {
        const findings = page.getByRole('list', { name: 'Findings' });
        await expect(findings.getByRole('listitem').filter({ hasText: 'Knees cave in · L' })).toContainText(/Severe →.*Slight/);
        await expect(findings.getByRole('listitem').filter({ hasText: 'Heels lift · L R' })).toContainText('Improved');
        await expect(findings.getByRole('listitem').filter({ hasText: 'Low back arches' })).toContainText('New');
        await expect(page.getByRole('list', { name: 'Measurements' }).getByRole('listitem').first()).toContainText('−4 cm');
        await expect(page.getByRole('combobox', { name: 'Compare from' })).toHaveValue('0');
      } else {
        await expect(page.getByRole('row', { name: /Knees cave in · L\b/ })).toContainText(/Severe\s*Slight.*Improved/);
        await expect(page.getByRole('row', { name: /Heels lift · L R/ })).toContainText('Improved');
        await expect(page.getByRole('row', { name: /Head pokes forward/ })).toContainText('Same');
        await expect(page.getByRole('row', { name: /Low back arches/ })).toContainText('New');
        await expect(page.getByRole('row', { name: /Shoulder mobility gap · top hand · L/ })).toContainText('−4 cm');
        // Each value sits under its column's header card.
        const knees = page.getByRole('row', { name: /Knees cave in · L\b/ }).getByRole('cell');
        for (const [i, col] of (['compare-col-initial', 'compare-col-retest_1'] as const).entries()) {
          const head = (await page.getByTestId(col).boundingBox())!;
          const cell = (await knees.nth(i).boundingBox())!;
          expect(Math.abs(head.x - cell.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(head.width - cell.width)).toBeLessThanOrEqual(1);
        }
        // The overall score stays on one line.
        const overall = (await page.getByTestId('compare-overall').boundingBox())!;
        expect(overall.height).toBeLessThan(60);
        // Retest 2 is an empty column with Start.
        await expect(page.getByTestId('compare-retest2')).toContainText('Not done');
        await expect(page.getByRole('button', { name: 'Start Retest 2' })).toBeVisible();
      }
      await expectNoSidewaysScroll(page);
      await shot(page, `${size}-AS7-compare`);
      if (!phone) {
        // Start Retest 2 right here: "Same as Initial", then cancel.
        await page.getByRole('button', { name: 'Start Retest 2' }).click();
        const r2 = page.getByRole('dialog', { name: 'Retest 2 · pick tests' });
        await expect(r2.getByRole('button', { name: 'Same as Initial' })).toHaveAttribute('aria-pressed', 'true');
        await r2.getByRole('button', { name: 'Cancel' }).click();
        await expect(r2).toBeHidden();
      }

      // ---- Back on the tab (AS1): Compare and Report ----
      await page.getByRole('link', { name: `Back to ${clientName} · Limitations & injuries` }).click();
      await expect(page.getByTestId('assessments-card').getByRole('link', { name: 'Compare', exact: true })).toBeVisible();
      await expect(page.getByTestId('latest-findings').getByRole('link', { name: 'Report' })).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `${size}-AS1-retest-done`);

      // ---- Rename and delete the template ----
      await page.goto('/corrective/templates');
      await page.getByRole('button', { name: `${templateName} 2 tests`, exact: true }).click();
      const edit = phone ? page.getByRole('dialog', { name: 'Edit template' }) : page.getByTestId('template-editor');
      await expect(edit.getByRole('textbox', { name: 'Template name' })).toHaveValue(templateName);
      const renamed = `${templateName} v2`;
      createdTemplates.push(renamed);
      await edit.getByRole('textbox', { name: 'Template name' }).fill(renamed);
      await edit.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('button', { name: `${renamed} 2 tests`, exact: true })).toBeVisible();
      if (phone) await page.getByRole('button', { name: `${renamed} 2 tests`, exact: true }).click();
      const again = phone ? page.getByRole('dialog', { name: 'Edit template' }) : page.getByTestId('template-editor');
      await expect(again.getByRole('textbox', { name: 'Template name' })).toHaveValue(renamed);
      await again.getByRole('button', { name: /^Delete/ }).click();
      await expect(again.getByTestId('delete-confirm')).toContainText(`Delete “${renamed}”?`);
      // On the phone the confirm sits in the sticky footer: on screen without scrolling (QA 2026-11-21).
      await expect(again.getByRole('button', { name: 'Delete template' })).toBeInViewport();
      await shot(page, `${size}-template-delete-confirm`);
      await again.getByRole('button', { name: 'Delete template' }).click();
      await expect(page.getByRole('button', { name: `${renamed} 2 tests`, exact: true })).toHaveCount(0);
    });
  });
}
