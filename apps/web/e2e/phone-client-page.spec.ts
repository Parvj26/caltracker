import { devices, expect, test, type Page } from '@playwright/test';
import { browserToday, demoWorkspace, freshClient } from './assign-helpers';
import { COACH_EMAIL, seedLog, serviceClient, signInAsCoach } from './helpers';

// The client page on an iPhone (approved redesign, rows 2A and 3A): one small bar (back, initials, name, Message, ⋯)
// that stays at the top with the tabs, Settings and Remove client in ⋯, the Training calendar on the first screen,
// and on Overview a Today card (workout today, training now, nothing today) under an injury chip. Chromium with
// iPhone sizes and touch. Each CI shard starts from an empty database: every test makes its own client and data.

const admin = serviceClient();
const created: string[] = [];
let workspaceId: string;
let coachId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const coach = data.users.find((u) => u.email === COACH_EMAIL);
  if (!coach) throw new Error('Demo coach not found; run pnpm db:reset.');
  coachId = coach.id;
});

test.afterAll(async () => {
  if (created.length === 0) return;
  await admin.from('workout_logs').delete().in('client_id', created);
  await admin.from('workouts').delete().in('client_id', created);
  await admin.from('client_limitations').delete().in('client_id', created);
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
// iPhone SE: the smallest screen the coach uses.
test.use({ ...iphone13, viewport: { width: 375, height: 667 } });

async function newClient(first: string): Promise<{ id: string; name: string }> {
  const last = `Phone${Date.now() % 100000}`;
  const id = await freshClient(admin, workspaceId, first, last);
  created.push(id);
  return { id, name: `${first} ${last}` };
}

async function planToday(page: Page, clientId: string, name: string): Promise<string> {
  const r = await admin
    .from('workouts')
    .insert({ workspace_id: workspaceId, client_id: clientId, scheduled_on: await browserToday(page), name })
    .select('id')
    .single();
  if (r.error) throw r.error;
  return r.data.id;
}

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${innerWidth}px screen`).toBeLessThanOrEqual(innerWidth);
}

test('the bar and the tabs stay at the top while scrolling; ⋯ has Client settings and Remove client', async ({ page }) => {
  test.slow();
  const client = await newClient('Stella');
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}`);
  const bar = page.getByTestId('client-sticky');
  const tabs = page.getByRole('navigation', { name: 'Client sections' });
  await expect(page.getByRole('heading', { level: 1, name: client.name })).toBeVisible();
  // One small bar: about 100 points with the tabs (was about 320).
  expect((await bar.boundingBox())!.height).toBeLessThan(120);
  await expectNoSidewaysScroll(page);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  expect(Math.abs((await bar.boundingBox())!.y)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('link', { name: 'Message', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('link', { name: 'Back to Clients' })).toBeInViewport({ ratio: 1 });
  await expect(tabs.getByRole('link', { name: 'Overview' })).toBeInViewport({ ratio: 1 });

  // ⋯ opens over the page while scrolled; Remove client asks first, with the usual explanation.
  await page.getByRole('button', { name: 'More for this client' }).click();
  await expect(page.getByRole('menuitem', { name: 'Client settings' })).toBeInViewport({ ratio: 1 });
  await page.getByRole('menuitem', { name: 'Remove client…' }).click();
  const dialog = page.getByRole('dialog', { name: `Remove ${client.name}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/^They'll lose access to your workouts, messages and community\./)).toBeInViewport();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // Client settings keeps its page and address.
  await page.getByRole('button', { name: 'More for this client' }).click();
  await page.getByRole('menuitem', { name: 'Client settings' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/settings$`));
  await expect(page.getByRole('button', { name: `Remove ${client.name}` })).toBeVisible();
});

test('Training: the two buttons share a row, programs fold into one line, and the calendar is on the first screen', async ({ page }) => {
  test.slow();
  const client = await newClient('Cally');
  await signInAsCoach(page);
  await planToday(page, client.id, `Phone day ${Date.now()}`);
  await page.goto(`/clients/${client.id}/training`);
  const assign = page.getByRole('button', { name: 'Assign program', exact: true });
  const add = page.getByRole('button', { name: '+ Add workout', exact: true });
  const [a, b] = [(await assign.boundingBox())!, (await add.boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  // The calendar's view switch and its first day are on screen without scrolling.
  await expect(page.getByRole('navigation', { name: 'Calendar view' })).toBeInViewport({ ratio: 1 });
  const firstDay = (await page.locator('[data-date]').first().boundingBox())!;
  expect(firstDay.y).toBeLessThan(page.viewportSize()!.height - 40);
  await expectNoSidewaysScroll(page);
});

test('Overview Today card: a workout today offers Log session, and the injury chip shows here and on the logger', async ({ page }) => {
  test.slow();
  const client = await newClient('Ines');
  const lim = await admin.from('client_limitations').insert({ workspace_id: workspaceId, client_id: client.id, body: 'Left knee: no deep squats.\nLower back: go light' });
  if (lim.error) throw lim.error;
  await signInAsCoach(page);
  const name = `Lower Body ${Date.now()}`;
  const workoutId = await planToday(page, client.id, name);
  await page.goto(`/clients/${client.id}`);

  const chip = page.getByRole('button', { name: /^Injury: Left knee: no deep squats \+1 more/ });
  await expect(chip).toBeInViewport();
  await chip.click();
  await expect(page.getByTestId('injury-chip').getByText(/Lower back: go light/)).toBeVisible();

  const today = page.getByRole('region', { name: 'Today', exact: true });
  await expect(today).toHaveAttribute('data-today', 'planned');
  await expect(today.getByRole('heading', { name })).toBeVisible();
  const log = today.getByRole('link', { name: 'Log session' });
  await expect(log).toBeInViewport({ ratio: 1 });
  await expect(log).toHaveAttribute('href', `/clients/${client.id}/log/${workoutId}`);
  await expectNoSidewaysScroll(page);

  // The same warning near the top of the Log session screen.
  await log.click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/log/${workoutId}`));
  await expect(page.getByRole('button', { name: /^Injury: Left knee: no deep squats/ })).toBeInViewport();
});

test('Overview Today card: training now offers Watch live, or Continue for the coach\'s own session', async ({ page }) => {
  test.slow();
  const client = await newClient('Liv');
  await signInAsCoach(page);
  const workoutId = await planToday(page, client.id, `Power ${Date.now()}`);
  const started = new Date(Date.now() - 20 * 60_000).toISOString();
  const logId = await seedLog(admin, { workspaceId, clientId: client.id, name: 'Lower Body Power', plannedWorkoutId: workoutId, status: 'in_progress', startedAt: started, loggedBy: client.id });
  await page.goto(`/clients/${client.id}`);
  const today = page.getByRole('region', { name: 'Today', exact: true });
  await expect(today).toHaveAttribute('data-today', 'live');
  await expect(today.getByText('Training now')).toBeVisible();
  await expect(today.getByText(/sets done$/)).toBeVisible();
  await expect(today.getByRole('link', { name: 'Watch live' })).toHaveAttribute('href', `/clients/${client.id}/logs/${logId}`);

  // The coach logging it in person: Continue opens the logger.
  const mine = await admin.from('workout_logs').update({ logged_by: coachId }).eq('id', logId);
  if (mine.error) throw mine.error;
  await page.reload();
  await expect(today.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', `/clients/${client.id}/log/${workoutId}`);
});

test('Overview Today card: nothing today offers + Add workout, which opens the Add a workout window', async ({ page }) => {
  test.slow();
  const client = await newClient('Rhea');
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}`);
  const today = page.getByRole('region', { name: 'Today', exact: true });
  await expect(today).toHaveAttribute('data-today', 'nothing');
  await expect(today.getByRole('heading', { name: 'Nothing planned today' })).toBeVisible();
  await expect(page.getByTestId('injury-chip')).toHaveCount(0);
  await today.getByRole('link', { name: '+ Add workout' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/training`));
  await expect(page.getByRole('dialog', { name: 'Add a workout' })).toBeVisible();
});
