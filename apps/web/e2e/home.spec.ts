import { expect, test, type Page } from '@playwright/test';
import { COACH_EMAIL, seedLog, serviceClient, signInAsCoach } from './helpers';

// Coach home (/home). Every test seeds its own uniquely named client(s) in the demo workspace and only looks at its
// own rows, so tests can run side by side. Dates are the machine's local dates, which is what the browser uses too.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { logs: string[]; workouts: string[]; users: string[]; assignments: string[] } = { logs: [], workouts: [], users: [], assignments: [] };
let workspaceId: string;

test.beforeAll(async () => {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
});

test.afterAll(async () => {
  if (created.logs.length) await admin.from('workout_logs').delete().in('id', created.logs);
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
  if (created.assignments.length) await admin.from('program_assignments').delete().in('id', created.assignments);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

const MS_DAY = 86_400_000;
const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const dayOffset = (n: number) => isoDay(new Date(Date.now() + n * MS_DAY));

async function newClient(lastName: string, joinedDaysAgo = 0): Promise<string> {
  const u = await admin.auth.admin.createUser({
    email: `home-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: 'Home', last_name: lastName },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin
    .from('workspace_members')
    .insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client', created_at: new Date(Date.now() - joinedDaysAgo * MS_DAY).toISOString() });
  if (m.error) throw m.error;
  return u.data.user.id;
}

async function plan(clientId: string, name: string, date: string): Promise<string> {
  const r = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: clientId, scheduled_on: date, name }).select('id').single();
  if (r.error) throw r.error;
  created.workouts.push(r.data.id);
  return r.data.id;
}

/** A row of Today's clients. */
const rowFor = (page: Page, lastName: string) => page.locator('#today li').filter({ hasText: lastName });

test('signing in lands on /home and Home is the current nav item', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(COACH_EMAIL);
  await page.getByLabel('Password').fill('demo-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', /\d+/);
});

test('a workout today is Not started, then Done once a log completes, linking to the log', async ({ page }) => {
  const last = `Tday${unique()}`;
  const clientId = await newClient(last);
  const workoutId = await plan(clientId, 'Leg day', dayOffset(0));
  await signInAsCoach(page);
  await page.goto('/home');
  let row = rowFor(page, last);
  await expect(row).toContainText('Not started');
  await expect(row.getByRole('link').first()).toHaveAttribute('href', `/clients/${clientId}`);
  await expect(row.locator('[aria-disabled="true"]').filter({ hasText: 'Log session' })).toHaveAttribute('aria-disabled', 'true');

  const start = new Date(Date.now() - 52 * 60_000).toISOString();
  const logId = await seedLog(admin, { workspaceId, clientId, name: 'Leg day', plannedWorkoutId: workoutId, startedAt: start, finishedAt: new Date().toISOString() });
  created.logs.push(logId);
  await page.reload();
  row = rowFor(page, last);
  await expect(row).toContainText('Done ✓');
  await expect(row.getByRole('link').first()).toHaveAttribute('href', `/clients/${clientId}/logs/${logId}`);
});

test('an in-progress log shows Training now', async ({ page }) => {
  const last = `Train${unique()}`;
  const clientId = await newClient(last);
  const workoutId = await plan(clientId, 'Push', dayOffset(0));
  created.logs.push(await seedLog(admin, { workspaceId, clientId, name: 'Push', plannedWorkoutId: workoutId, status: 'in_progress', startedAt: new Date().toISOString() }));
  await signInAsCoach(page);
  await page.goto('/home');
  await expect(rowFor(page, last)).toContainText('Training now');
});

test('two undone workouts in the last 2 days list the client under Missed 2+', async ({ page }) => {
  const last = `Miss${unique()}`;
  const clientId = await newClient(last);
  await plan(clientId, 'Pull A', dayOffset(-1));
  await plan(clientId, 'Pull B', dayOffset(-2));
  await signInAsCoach(page);
  await page.goto('/home');
  const group = page.locator('#missed');
  await expect(group.getByRole('heading', { name: 'Missed 2+' })).toBeVisible();
  const row = group.locator('li').filter({ hasText: last });
  await expect(row).toContainText('Missed 2 in the last 7 days');
  await expect(row.getByRole('link')).toHaveAttribute('href', `/clients/${clientId}`);
  const tile = page.getByRole('link', { name: /Missed 2\+/ });
  await expect(tile).toHaveAttribute('href', '#missed');
  expect(Number((await tile.innerText()).match(/\d+/g)?.at(-1))).toBeGreaterThanOrEqual(1);
});

test('a client who joined 10 days ago with no logs is under No workout in 5+ days', async ({ page }) => {
  const last = `Quiet${unique()}`;
  await newClient(last, 10);
  await signInAsCoach(page);
  await page.goto('/home');
  const group = page.getByRole('region', { name: 'No workout in 5+ days' });
  await expect(group.locator('li').filter({ hasText: last })).toContainText(/\d+ days/);
});

test('a program ending in 3 days shows Ends in 3 days', async ({ page }) => {
  const last = `Ends${unique()}`;
  const clientId = await newClient(last);
  const a = await admin.from('program_assignments').insert({ workspace_id: workspaceId, client_id: clientId, program_name: `Ending ${unique()}`, weeks: 1, start_date: dayOffset(-3) }).select('id').single();
  if (a.error) throw a.error;
  created.assignments.push(a.data.id);
  await signInAsCoach(page);
  await page.goto('/home');
  await expect(page.getByRole('region', { name: 'Program ending soon' }).locator('li').filter({ hasText: last })).toContainText('Ends in 3 days');
});

test('past clients are not counted', async ({ page }) => {
  const last = `Gone${unique()}`;
  const clientId = await newClient(last, 10);
  await admin.from('workspace_members').delete().eq('user_id', clientId).eq('workspace_id', workspaceId);
  await signInAsCoach(page);
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(last)).toHaveCount(0);
});

test('the coming-soon parts are visible, disabled, and the console has no hydration errors', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(m.text()));
  const last = `Soon${unique()}`;
  const clientId = await newClient(last, 10);
  await plan(clientId, 'Core', dayOffset(0));
  await signInAsCoach(page);
  await page.goto('/home');
  await expect(rowFor(page, last)).toBeVisible();
  for (const label of ['New PRs this week', 'Message', 'Body scans 30+ days']) {
    await expect(page.locator('[aria-disabled="true"]').filter({ hasText: label }).first()).toBeVisible();
  }
  expect(messages.filter((t) => t.includes('Hydration'))).toEqual([]);
});
