import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { browserToday, demoWorkspace, freshClient, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';
import { SIZES, auditInPage } from './ui-audit-rules';
import type { Size } from './ui-audit-allowlist';

// Flags (movement assessments step 4, boards AS9 and AS10), at phone, iPad and desktop sizes: flag the neck from the
// Overview's body map, see it in the amber chip and in the builder's reminder bar (a calendar workout and the
// "+ New workout" sheet), then resolve it. Screenshots go to FLAGS_SHOTS_DIR when it is set.

const admin = serviceClient();
const SHOTS = process.env.FLAGS_SHOTS_DIR;
const cleanup: (() => PromiseLike<unknown>)[] = [];
test.afterAll(async () => {
  for (const c of cleanup.reverse()) await c();
});

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
}

/** The UI audit's in-page rules (no sideways scroll, tap targets, overlaps, tiny text), on the page or a pop-up. */
async function audit(page: Page, size: Size, scope?: string) {
  // The whole page on a phone has no logo by design (UI_ALLOW in ui-audit-allowlist.ts).
  const allow = scope ? [] : [{ i: 0, rule: 'logo' }];
  const result = await page.evaluate(auditInPage, { minTarget: size === 'desktop' ? 24 : 44, allow, ...(scope ? { scope } : {}) });
  expect(result.found.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
}

for (const { size, use } of SIZES) {
  test.describe(size, () => {
    test.use(use);

    test('flag the neck from the Overview, see it on the chip and in the builder, then resolve it', async ({ page }) => {
      test.slow();
      const tag = unique();
      const workspaceId = await demoWorkspace(admin);
      const clientId = await freshClient(admin, workspaceId, 'Vaishali', `Kohli ${tag}`);
      cleanup.push(async () => {
        await admin.from('workouts').delete().eq('client_id', clientId);
        await admin.auth.admin.deleteUser(clientId);
      });
      // An older open limitation, as on the boards.
      const knee = await admin
        .from('client_flags')
        .insert({ workspace_id: workspaceId, client_id: clientId, region: 'knee', side: 'L', type: 'limitation', since: '2026-09-02', note: 'No deep squats' });
      if (knee.error) throw knee.error;

      await signInAsCoach(page);
      await page.goto(`/clients/${clientId}`);
      const card = page.getByTestId('flags-card');
      await expect(card.getByRole('heading', { name: 'Limitations & injuries' })).toBeVisible();
      await expect(card.getByText('Left knee', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Injury: Left knee: no deep squats/ })).toBeVisible();
      if (size === 'phone') {
        // On a phone the card moves up, right under Today.
        const today = await page.getByRole('region', { name: 'Today', exact: true }).boundingBox();
        const flags = await card.boundingBox();
        const training = await page.locator('[aria-labelledby="training-heading"]').boundingBox();
        expect(flags!.y).toBeGreaterThan(today!.y);
        expect(flags!.y).toBeLessThan(training!.y);
      }

      // Tap the neck on the front figure: New flag opens on Neck, in the centre.
      // The figure is one button; a tap on it names the body part under the finger.
      const neck = await card.locator('svg[data-view="front"] [data-region="neck.R"]').boundingBox();
      if (use.hasTouch) await page.touchscreen.tap(neck!.x + neck!.width / 2, neck!.y + neck!.height / 2);
      else await page.mouse.click(neck!.x + neck!.width / 2, neck!.y + neck!.height / 2);
      const sheet = page.getByRole('dialog', { name: 'New flag' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('combobox', { name: 'Body part' })).toHaveValue('neck');
      await expect(sheet.getByRole('radio', { name: 'Centre' })).toBeChecked();
      await expect(sheet.getByRole('radio', { name: 'Pain' })).toBeChecked();
      await sheet.getByLabel('Note (optional)').fill('Stiff after desk work');
      await shot(page, `${size}-2-new-flag`);
      await audit(page, size, 'dialog[open] form');
      await sheet.getByRole('button', { name: 'Save flag' }).click();
      await expect(sheet).toBeHidden();

      // The card numbers it first (newest), pins it on both figures, and the chip leads with it.
      await expect(card.getByRole('status')).toHaveText('Neck flagged.');
      const rows = card.getByRole('list', { name: 'Open flags, newest first' }).getByRole('listitem');
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText('Neck');
      await expect(rows.first()).toContainText('Pain');
      await expect(rows.first()).toContainText('“Stiff after desk work”');
      await expect(card.locator('[data-view="front"] [data-pin="1"]')).toHaveCount(1);
      await expect(card.locator('[data-view="back"] [data-pin="1"]')).toHaveCount(1);
      await expect(card.locator('[data-view="front"] [data-pin="2"]')).toHaveCount(1);
      const chip = page.getByRole('button', { name: /^Injury: Neck pain \+1 more/ });
      await expect(chip).toBeVisible();
      const saved = await admin.from('client_flags').select('region, side, type, note, status, since').eq('client_id', clientId).eq('region', 'neck');
      expect(saved.data).toEqual([{ region: 'neck', side: 'centre', type: 'pain', note: 'Stiff after desk work', status: 'open', since: await browserToday(page) }]);
      await shot(page, `${size}-1-overview`, true);
      await audit(page, size);

      // The builder for her calendar workout: a slim amber reminder, open flags newest first.
      const workout = await admin
        .from('workouts')
        .insert({ workspace_id: workspaceId, client_id: clientId, scheduled_on: await browserToday(page), name: `Vaishali – Lower ${tag}` })
        .select('id')
        .single();
      if (workout.error) throw workout.error;
      await page.goto(`/clients/${clientId}/workouts/${workout.data.id}`);
      const reminder = page.getByTestId('flag-reminder');
      await expect(reminder).toHaveText(/^Vaishali: Neck pain \(\d{1,2} \w{3}\) · Left knee: no deep squats$/);
      await shot(page, `${size}-3-builder`);

      // "+ New workout" for her day: the same reminder in the sheet.
      await page.goto(`/clients/${clientId}/training`);
      await page.getByRole('button', { name: '+ Add workout' }).first().click();
      await page.getByRole('dialog', { name: 'Add a workout' }).getByRole('button', { name: /New workout/ }).click();
      const builder = page.getByRole('dialog', { name: 'New workout' });
      // It loads after the sheet opens (a server call), so allow it a moment.
      await expect(builder.getByTestId('flag-reminder')).toHaveText(/^Vaishali: Neck pain \(\d{1,2} \w{3}\) · Left knee: no deep squats$/, { timeout: 15_000 });
      await shot(page, `${size}-4-new-workout-sheet`);
      await audit(page, size, 'dialog[open]');

      // A tap on the reminder opens her Limitations & injuries tab, with the same flags card (board AS1).
      await page.goto(`/clients/${clientId}/workouts/${workout.data.id}`);
      await page.getByTestId('flag-reminder').click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/limitations$`));
      await expect(card.getByRole('list', { name: 'Open flags, newest first' }).getByRole('listitem')).toHaveCount(2);
      await shot(page, `${size}-6-limitations-tab`, true);
      await page.goto(`/clients/${clientId}`);

      // Resolve the neck: it moves under "Resolved (1)" and drops off the chip and the reminder.
      await card.getByRole('button', { name: 'Resolve Neck pain' }).click();
      await expect(card.getByRole('status')).toContainText('Neck moved to Resolved.');
      await expect(card.getByRole('button', { name: 'Resolved (1)' })).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expect(page.getByRole('button', { name: /^Injury: Left knee: no deep squats$/ })).toBeVisible();
      await card.getByRole('button', { name: 'Resolved (1)' }).click();
      await expect(card.getByRole('button', { name: 'Reopen Neck pain' })).toBeVisible();
      await shot(page, `${size}-5-resolved`, true);
      const resolved = await admin.from('client_flags').select('status, resolved_on').eq('client_id', clientId).eq('region', 'neck').single();
      expect(resolved.data).toEqual({ status: 'resolved', resolved_on: await browserToday(page) });
      await page.goto(`/clients/${clientId}/workouts/${workout.data.id}`);
      await expect(page.getByTestId('flag-reminder')).toHaveText(/^Vaishali: Left knee: no deep squats$/);
    });
  });
}

test('the New flag map is a radio group: arrow keys pick the next body part, as the list does', async ({ page }) => {
  const tag = unique();
  const workspaceId = await demoWorkspace(admin);
  const clientId = await freshClient(admin, workspaceId, 'Kira', `Keys ${tag}`);
  cleanup.push(() => admin.auth.admin.deleteUser(clientId));
  await signInAsCoach(page);
  await page.goto(`/clients/${clientId}`);
  const card = page.getByTestId('flags-card');
  await expect(card.getByText('Nothing flagged.')).toBeVisible();
  // The keyboard opens the sheet with nothing picked yet.
  await card.getByRole('button', { name: 'Flag a body part on the back' }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'New flag' });
  await expect(sheet.getByRole('combobox', { name: 'Body part' })).toHaveValue('');
  await sheet.getByRole('button', { name: 'Save flag' }).click();
  await expect(sheet.getByText('Pick a body part.')).toBeVisible();

  await sheet.getByRole('radio', { name: 'Back' }).check();
  const map = sheet.getByRole('radiogroup', { name: /^Back of body/ });
  await map.getByRole('radio', { name: 'Left neck' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(map.getByRole('radio', { name: 'Right neck' })).toBeFocused();
  await expect(sheet.getByRole('combobox', { name: 'Body part' })).toHaveValue('neck');
  await page.keyboard.press('ArrowDown');
  await expect(map.getByRole('radio', { name: 'Left upper trap' })).toBeChecked();
  await expect(sheet.getByRole('combobox', { name: 'Body part' })).toHaveValue('upper_traps');
  await expect(sheet.getByRole('radio', { name: 'L', exact: true })).toBeChecked();
  // The list picks too, and the map follows (glute medius is on the back).
  await sheet.getByRole('combobox', { name: 'Body part' }).selectOption('glute_medius');
  await expect(map.getByRole('radio', { name: 'Left glute medius' })).toBeChecked();
  await sheet.getByRole('radio', { name: 'Injury' }).check();
  await sheet.getByRole('button', { name: 'Save flag' }).click();
  await expect(sheet).toBeHidden();
  await expect(card.getByRole('list', { name: 'Open flags, newest first' })).toContainText('Left glute medius');
  await expect(page.getByRole('button', { name: /^Injury: Left glute medius injury$/ })).toBeVisible();
});
