import { expect, test, type Page } from '@playwright/test';
import { deleteCoach, newCoachWithClient, signInAs } from './assign-helpers';
import { seedLog, serviceClient } from './helpers';

// Metrics › Strength: the section on the client's Body tab (to become Metrics) and one exercise's progress page, at
// phone, iPad and desktop sizes. A fresh coach (in kg) with one client and four squat sessions; nothing else shared.
const admin = serviceClient();
const MS_DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * MS_DAY + 3_600_000).toISOString();

let c: Awaited<ReturnType<typeof newCoachWithClient>>;
let logIds: string[] = [];

test.beforeAll(async () => {
  c = await newCoachWithClient(admin, 'Strength');
  const u = await admin.from('profiles').update({ units: 'kg' }).eq('id', c.coachId);
  if (u.error) throw u.error;
  const sessions = [
    { ago: 80, weightKg: 60, reps: 8 },
    { ago: 40, weightKg: 70, reps: 5 },
    { ago: 10, weightKg: 82.5, reps: 3 },
    { ago: 3, weightKg: 80, reps: 5 },
  ];
  logIds = [];
  for (const s of sessions) {
    logIds.push(await seedLog(admin, { workspaceId: c.workspaceId, clientId: c.clientId, name: 'Lower Body', startedAt: daysAgo(s.ago), sets: 2, weightKg: s.weightKg, reps: s.reps }));
  }
});

test.afterAll(async () => {
  await deleteCoach(admin, c);
});

const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'iPad', viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
] as const;

async function noSidewaysScroll(page: Page) {
  const [sw, w] = await page.evaluate(() => [document.scrollingElement!.scrollWidth, innerWidth]);
  expect(sw).toBeLessThanOrEqual(w + 1);
}

for (const size of SIZES) {
  test.describe(`at ${size.name}`, () => {
    test.use({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch });

    test('the Strength section headlines the heaviest weight and opens the exercise page', async ({ page }) => {
      await signInAs(page, c.email);
      await page.goto(`/clients/${c.clientId}/body`);
      const section = page.getByTestId('strength-section');
      await expect(section.getByRole('heading', { name: 'Strength' })).toBeVisible();
      const row = section.getByRole('link', { name: /Barbell Squat: heaviest 82\.5 kg, \+22\.5 kg since start/ });
      await expect(row).toBeVisible();
      if (size.name === 'desktop') {
        // A table with column headings when wide.
        await expect(section.getByText('Since start', { exact: true })).toBeVisible();
      }
      await noSidewaysScroll(page);
      await row.click();

      await expect(page.getByRole('heading', { level: 1, name: 'Barbell Squat' })).toBeVisible();
      await expect(page.getByRole('link', { name: /’s metrics$/ })).toBeVisible();
      await expect(page.getByTestId('tile-heaviest')).toContainText('82.5 kg');
      await expect(page.getByTestId('tile-heaviest')).toContainText('+22.5 kg since');
      await expect(page.getByTestId('tile-e1rm')).toContainText('93.3 kg');
      await expect(page.getByTestId('tile-e1rm')).toContainText('From 80 kg × 5');
      await expect(page.getByRole('application', { name: /heaviest weight per session and estimated 1-rep max/ })).toBeVisible();
      await expect(page.getByTestId('chart-line-secondary')).toHaveCount(1);
      const sessions = page.getByTestId('strength-sessions');
      await expect(sessions.getByRole('link')).toHaveCount(4);
      // One tag: the session holding the heaviest set of all.
      await expect(sessions.getByText('Heaviest yet')).toHaveCount(1);
      await expect(sessions.getByRole('link', { name: /^82\.5 kg × 3.*Heaviest yet/ })).toBeVisible();
      // The section shows all time, so its row opens the page on All and the numbers agree.
      await expect(page).toHaveURL(/\?range=all$/);
      await noSidewaysScroll(page);

      // The range is kept in the address, without a new history step.
      await page.getByRole('navigation', { name: 'Range' }).getByRole('link', { name: '3 months' }).click();
      await expect(page).toHaveURL(/\?range=3m$/);
      await expect(page.getByRole('navigation', { name: 'Range' }).getByRole('link', { name: '3 months' })).toHaveAttribute('aria-current', 'true');

      // A session opens its log.
      await sessions.getByRole('link', { name: /^82\.5 kg × 3/ }).click();
      await expect(page).toHaveURL(new RegExp(`/logs/${logIds[2]}$`));
    });
  });
}

test('the back link returns to the client’s metrics (Body tab for now)', async ({ page }) => {
  await signInAs(page, c.email);
  await page.goto(`/clients/${c.clientId}/metrics/strength/${(await admin.from('exercises').select('id').eq('name', 'Barbell Squat').is('workspace_id', null).limit(1).single()).data!.id}?range=all`);
  await page.getByRole('link', { name: /’s metrics$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${c.clientId}/body$`));
});

test('an exercise the client never did is not found', async ({ page }) => {
  await signInAs(page, c.email);
  const res = await page.goto(`/clients/${c.clientId}/metrics/strength/00000000-0000-4000-8000-000000000999`);
  expect(res?.status()).toBe(404);
});
