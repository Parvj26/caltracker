import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';
import { auditInPage } from './ui-audit-rules';
import type { Size } from './ui-audit-allowlist';

// Library › Corrective › Exercises (movement assessments step 2b, board AS8) at phone 390, iPad 820 and desktop 1280:
// add a corrective exercise (a new custom exercise with a photo, tagged to glute medius), edit its dose, add an end
// photo on the exercise page and see the photo in the library, then delete the corrective tag. Screenshots go to
// CORRECTIVE_SHOTS_DIR when it is set.

const admin = serviceClient();
const SHOTS = process.env.CORRECTIVE_SHOTS_DIR;
const PHOTO = join(__dirname, 'fixtures', 'meal.jpg');
const cleanup: (() => PromiseLike<unknown>)[] = [];
test.afterAll(async () => {
  for (const c of cleanup.reverse()) await c();
});

const SIZES: { size: Size; use: { viewport: { width: number; height: number }; isMobile: boolean; hasTouch: boolean } }[] = [
  { size: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { size: 'tablet', use: { viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true } },
  { size: 'desktop', use: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false } },
];

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
}

async function audit(page: Page, size: Size, scope?: string) {
  // Pop-ups open with a light scale: measure them once it has settled.
  if (scope) await page.waitForTimeout(400);
  const allow = scope ? [] : [{ i: 0, rule: 'logo' }];
  const result = await page.evaluate(auditInPage, { minTarget: size === 'desktop' ? 24 : 44, allow, ...(scope ? { scope } : {}) });
  expect(result.found.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
}

for (const { size, use } of SIZES) {
  test.describe(size, () => {
    test.use(use);

    test('add a corrective exercise with muscle tags and a photo, edit it, add an end photo, delete it', async ({ page }) => {
      test.slow();
      const tag = unique();
      const name = `DNS Star ${size} ${tag}`;
      const workspaceId = await demoWorkspace(admin);
      cleanup.push(async () => {
        const ex = await admin.from('exercises').select('id, image_paths').eq('workspace_id', workspaceId).eq('name', name);
        for (const e of ex.data ?? []) {
          if (e.image_paths.length) await admin.storage.from('exercise-images').remove(e.image_paths);
          await admin.from('exercises').delete().eq('id', e.id);
        }
      });

      await signInAsCoach(page);
      // Library › Corrective lands on Exercises.
      await page.goto('/corrective');
      await expect(page).toHaveURL(/\/corrective\/exercises$/);
      await expect(page.getByRole('heading', { level: 1, name: /^Corrective/ })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Library sections' }).getByRole('link', { name: 'Corrective' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('navigation', { name: 'Corrective sections' }).getByRole('link', { name: 'Exercises' })).toHaveAttribute('aria-current', 'page');
      // The built-in defaults are there, grouped by muscle (Glute medius, underactive).
      const glute = page.getByRole('region', { name: 'Glute medius, underactive' });
      await expect(glute.getByRole('button', { name: /^Banded Lateral Walk/i })).toBeVisible();
      await shot(page, `${size}-1-library`, true);
      await audit(page, size);

      // The Over chip leaves only release / stretch groups.
      await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: '↑ Over' }).click();
      await expect(glute).toHaveCount(0);
      await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click();
      // The search is typo-tolerant.
      await page.getByRole('searchbox', { name: 'Search corrective exercises' }).fill('latral wlk');
      await expect(page.getByRole('button', { name: /^Banded Lateral Walk/i })).toBeVisible();
      await page.getByRole('searchbox', { name: 'Search corrective exercises' }).fill('');

      // + Corrective exercise: a new exercise with a photo, underactive glute medius, 2 × 5 each side.
      await page.getByRole('button', { name: '+ Corrective exercise' }).click();
      const dialog = page.getByRole('dialog', { name: 'Corrective exercise' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Name').fill(name);
      await dialog.getByTestId('corrective-photo-input').setInputFiles(PHOTO);
      await expect(dialog.getByRole('img', { name: 'Chosen photo' })).toBeVisible();
      await dialog.getByText('Pick from the list', { exact: true }).click();
      await dialog.getByRole('group', { name: 'Muscle group list' }).getByRole('button', { name: 'Glute medius' }).click();
      await expect(dialog.getByRole('list', { name: 'Picked muscle groups' })).toContainText('Glute medius');
      // The body map shows the pick: tapping the right glute medius on the back figure turns that side off.
      const rightGlute = await dialog.locator('svg[data-view="back"] [data-region="glute_medius.R"]').first().boundingBox();
      if (use.hasTouch) await page.touchscreen.tap(rightGlute!.x + rightGlute!.width / 2, rightGlute!.y + rightGlute!.height / 2);
      else await page.mouse.click(rightGlute!.x + rightGlute!.width / 2, rightGlute!.y + rightGlute!.height / 2);
      await expect(dialog.getByRole('button', { name: 'Right side' })).toHaveAttribute('aria-pressed', 'false');
      await expect(dialog.getByRole('list', { name: 'Picked muscle groups' })).toContainText('Glute medius');
      await dialog.getByRole('button', { name: 'Right side' }).click();
      await dialog.getByLabel('Sets').fill('2');
      // A dose needs reps or seconds: "2 sets" alone can't be saved.
      await expect(dialog.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
      await expect(dialog.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription('Add reps');
      await dialog.getByLabel('Reps', { exact: true }).fill('5');
      await dialog.getByRole('checkbox', { name: 'Each side' }).check();
      await shot(page, `${size}-2-new-corrective`);
      await audit(page, size, 'dialog[open]');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      const row = glute.getByRole('button', { name: new RegExp(`^${name} Yours 2 × 5 each side`) });
      await expect(row).toBeVisible();
      // Yours come first in the group.
      const texts = await glute.getByRole('listitem').allTextContents();
      const mineAt = texts.findIndex((t) => t.includes(name));
      expect(mineAt).toBeGreaterThanOrEqual(0);
      expect(mineAt).toBeLessThan(texts.findIndex((t) => /Banded Lateral Walk/i.test(t)));
      await expect(glute.getByRole('listitem').filter({ hasText: name }).locator('img')).toHaveCount(1);
      const saved = await admin.from('corrective_exercises').select('id, exercise_id, direction, default_sets, default_reps, each_side, corrective_exercise_muscles(muscle_id, side)').eq('workspace_id', workspaceId).eq('exercise_id', (await admin.from('exercises').select('id').eq('name', name).single()).data!.id).single();
      expect(saved.data).toMatchObject({ direction: 'under', default_sets: 2, default_reps: 5, each_side: true });
      expect(saved.data!.corrective_exercise_muscles).toHaveLength(2);
      const exerciseId = saved.data!.exercise_id;

      // Edit: 2 × 8 each side.
      await row.click();
      if (size === 'desktop') {
        const pane = page.getByTestId('corrective-pane');
        await expect(pane.getByRole('heading', { name })).toBeVisible();
        await shot(page, `${size}-3-open`);
        await pane.getByRole('button', { name: 'Edit' }).click();
      } else {
        const view = page.getByRole('dialog', { name });
        await expect(view.getByText('2 × 5 each side')).toBeVisible();
        await shot(page, `${size}-3-open`);
        await audit(page, size, 'dialog[open]');
        // Edit moves focus into the form; Cancel goes back to the view, with nothing changed.
        await view.getByRole('button', { name: 'Edit' }).click();
        const editing = page.getByRole('dialog', { name: 'Edit corrective exercise' });
        await expect(editing.getByRole('form', { name: 'Corrective exercise' })).toBeVisible();
        expect(await page.evaluate(() => !!document.activeElement?.closest('form[aria-label="Corrective exercise"]'))).toBe(true);
        await editing.getByLabel('Reps (optional)').fill('9');
        await editing.getByRole('button', { name: 'Cancel' }).click();
        await expect(view.getByText('2 × 5 each side')).toBeVisible();
        await view.getByRole('button', { name: 'Edit' }).click();
        await expect(editing.getByLabel('Reps (optional)')).toHaveValue('5');
      }
      const edit = page.getByRole('dialog', { name: 'Edit corrective exercise' });
      await expect(edit.getByText(name)).toBeVisible();
      await edit.getByLabel('Reps', { exact: true }).fill('8');
      await edit.getByRole('button', { name: 'Save' }).click();
      await expect(edit).toBeHidden({ timeout: 20_000 });
      await expect(glute.getByRole('button', { name: new RegExp(`^${name} Yours 2 × 8 each side`) })).toBeVisible();

      // The exercise page: the start photo is there; add the end photo.
      await page.goto(`/exercises/${exerciseId}`);
      const photos = page.getByRole('list', { name: `Photos of ${name}` });
      await expect(photos.getByRole('img')).toHaveCount(1);
      await page.getByTestId('exercise-photo-input').setInputFiles(PHOTO);
      await expect(photos.getByRole('img')).toHaveCount(2, { timeout: 20_000 });
      await expect(page.getByRole('button', { name: /Add .* photo/ })).toHaveCount(0);
      const withPhotos = await admin.from('exercises').select('image_paths').eq('id', exerciseId).single();
      expect(withPhotos.data!.image_paths).toHaveLength(2);
      for (const p of withPhotos.data!.image_paths) expect(p).toMatch(new RegExp(`^custom/${workspaceId}/${exerciseId}/[0-9a-f-]{36}\\.(webp|jpg)$`));
      await shot(page, `${size}-4-exercise-photos`, true);
      await audit(page, size);
      // Remove the end photo: it asks first, then the file is deleted.
      await page.getByRole('button', { name: 'Remove end photo' }).click();
      await page.getByRole('alertdialog', { name: 'Remove this photo?' }).getByRole('button', { name: 'Remove photo' }).click();
      await expect(photos.getByRole('img')).toHaveCount(1, { timeout: 20_000 });
      const gone = withPhotos.data!.image_paths[1]!;
      const listed = await admin.storage.from('exercise-images').list(`custom/${workspaceId}/${exerciseId}`);
      expect(listed.data!.map((f) => `custom/${workspaceId}/${exerciseId}/${f.name}`)).not.toContain(gone);

      // Back in the library, the photo shows on the row; delete the corrective tag (the exercise stays).
      await page.goto('/corrective/exercises');
      const mine = glute.getByRole('button', { name: new RegExp(`^${name} Yours`) });
      await expect(glute.getByRole('listitem').filter({ hasText: name }).locator('img')).toHaveCount(1);
      await mine.click();
      if (size === 'desktop') {
        await page.getByRole('button', { name: `More for ${name}` }).click();
        await page.getByRole('menuitem', { name: 'Delete…' }).click();
      } else {
        await page.getByRole('dialog', { name }).getByRole('button', { name: 'Delete from corrective exercises…' }).click();
      }
      const confirm = page.getByRole('alertdialog', { name: `Delete “${name}”?` });
      // The question starts on Cancel (the safe choice).
      await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await shot(page, `${size}-5-delete`);
      await confirm.getByRole('button', { name: 'Delete' }).click();
      await expect(confirm).toBeHidden({ timeout: 20_000 });
      await expect(mine).toHaveCount(0);
      expect((await admin.from('corrective_exercises').select('id').eq('exercise_id', exerciseId)).data).toEqual([]);
      expect((await admin.from('exercises').select('id').eq('id', exerciseId)).data).toHaveLength(1);
    });
  });
}
