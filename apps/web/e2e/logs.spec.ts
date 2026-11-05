import { expect, test, type Page } from '@playwright/test';
import { seedLog, serviceClient, signInAsCoach } from './helpers';

// Activity feed and the done / missed marks on the client calendar (phase 3a Task 10). Every test seeds its own
// uniquely named workouts and logs, so tests can share the demo client and run side by side.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { logs: string[]; workouts: string[]; users: string[] } = { logs: [], workouts: [], users: [] };
let clientId: string;
let workspaceId: string;

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const client = data.users.find((u) => u.email === 'client@demo.local');
  if (!client) throw new Error('Demo client client@demo.local not found; run pnpm db:reset.');
  clientId = client.id;
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
});

test.afterAll(async () => {
  if (created.logs.length) await admin.from('workout_logs').delete().in('id', created.logs);
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

/* ---------- Plain YYYY-MM-DD maths (UTC only) ---------- */
const MS_DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * MS_DAY).toISOString().slice(0, 10);
const browserToday = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
const calendarUrl = (id: string, date: string) => `/clients/${id}?month=${date.slice(0, 7)}`;
const day = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);

async function plan(name: string, date: string, forClient = clientId): Promise<string> {
  const r = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: forClient, scheduled_on: date, name }).select('id').single();
  if (r.error) throw r.error;
  created.workouts.push(r.data.id);
  return r.data.id;
}
async function log(o: Parameters<typeof seedLog>[1]): Promise<string> {
  const id = await seedLog(admin, o);
  created.logs.push(id);
  return id;
}
async function newClient(firstName: string, lastName: string): Promise<string> {
  const u = await admin.auth.admin.createUser({
    email: `feed-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  return u.data.user.id;
}

test('a finished workout shows in the activity feed with its sets and volume', async ({ page }) => {
  const name = `Feed ${unique()}`;
  const id = await log({ workspaceId, clientId, name, startedAt: '2026-11-04T17:00:00Z', finishedAt: '2026-11-04T17:53:00Z' });
  await signInAsCoach(page);
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('link', { name })).toHaveAttribute('href', `/clients/${clientId}/logs/${id}`);
  await expect(row.getByText('Demo Client')).toBeVisible();
  await expect(row.getByText('3 sets')).toBeVisible();
  await expect(row.getByText('53 min')).toBeVisible();
  await expect(row.getByText(/^[\d,]+ (kg|lb) lifted$/)).toBeVisible();
  await expect(row.getByText('Unplanned')).toBeVisible();
});

test('the feed shows only completed logs, with the auto-finished chip', async ({ page }) => {
  const done = `Auto ${unique()}`;
  const gone = `Dropped ${unique()}`;
  await log({ workspaceId, clientId, name: done, startedAt: '2026-11-03T10:00:00Z', finishedAt: '2026-11-03T10:30:00Z', autoFinished: true });
  await log({ workspaceId, clientId, name: gone, status: 'discarded', sets: 0, startedAt: '2026-11-03T11:00:00Z' });
  await signInAsCoach(page);
  await page.goto('/activity');
  await expect(page.getByRole('row').filter({ hasText: done }).getByText('Auto-finished')).toBeVisible();
  await expect(page.getByText(gone)).toHaveCount(0);
});

test('the client filter narrows the feed', async ({ page }) => {
  const last = `Filter${unique()}`;
  const other = await newClient('Sam', last);
  const mine = `Mine ${unique()}`;
  const theirs = `Theirs ${unique()}`;
  await log({ workspaceId, clientId, name: mine, startedAt: '2026-11-04T08:00:00Z', finishedAt: '2026-11-04T08:40:00Z' });
  await log({ workspaceId, clientId: other, name: theirs, startedAt: '2026-11-04T09:00:00Z', finishedAt: '2026-11-04T09:40:00Z' });
  await signInAsCoach(page);
  await page.goto('/activity');
  await expect(page.getByText(mine)).toBeVisible();
  await expect(page.getByText(theirs)).toBeVisible();

  await page.getByRole('combobox', { name: /^Client/ }).selectOption({ label: `Sam ${last}` });
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page).toHaveURL(new RegExp(`client=${other}`));
  await expect(page.getByText(theirs)).toBeVisible();
  await expect(page.getByText(mine)).toHaveCount(0);
});

test('the calendar marks a finished workout done and links to its log, and a skipped past one missed', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  const doneDay = addDays(today, -2);
  const missedDay = addDays(today, -1);
  const doneName = `Done ${unique()}`;
  const missedName = `Skipped ${unique()}`;
  const planned = await plan(doneName, doneDay);
  await plan(missedName, missedDay);
  const logId = await log({
    workspaceId, clientId, name: doneName, plannedWorkoutId: planned,
    startedAt: `${doneDay}T12:00:00Z`, finishedAt: `${doneDay}T12:45:00Z`,
  });

  await page.goto(calendarUrl(clientId, doneDay));
  const doneItem = day(page, doneDay).getByRole('listitem').filter({ hasText: doneName });
  await expect(doneItem.getByRole('link', { name: /Done/ })).toHaveAttribute('href', `/clients/${clientId}/logs/${logId}`);
  await expect(doneItem.getByText('Missed')).toHaveCount(0);

  await page.goto(calendarUrl(clientId, missedDay));
  const missedItem = day(page, missedDay).getByRole('listitem').filter({ hasText: missedName });
  await expect(missedItem.getByText('Missed')).toBeVisible();
  await expect(missedItem.getByRole('link', { name: /Done/ })).toHaveCount(0);
  await page.screenshot({ path: process.env.SHOT_CALENDAR ?? 'test-results/calendar.png', fullPage: true });
});

test('a planned workout with only a discarded or in-progress log is not done; a past one is missed', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  const d1 = addDays(today, -4);
  const d2 = addDays(today, -3);
  const dropped = `Discarded ${unique()}`;
  const open = `Open ${unique()}`;
  const p1 = await plan(dropped, d1);
  const p2 = await plan(open, d2);
  await log({ workspaceId, clientId, name: dropped, plannedWorkoutId: p1, status: 'discarded', sets: 0, startedAt: `${d1}T10:00:00Z` });
  await log({ workspaceId, clientId, name: open, plannedWorkoutId: p2, status: 'in_progress', sets: 1, startedAt: `${d2}T10:00:00Z` });

  for (const [date, name] of [[d1, dropped], [d2, open]] as const) {
    await page.goto(calendarUrl(clientId, date));
    const item = day(page, date).getByRole('listitem').filter({ hasText: name });
    await expect(item.getByRole('link', { name: /Done/ })).toHaveCount(0);
    await expect(item.getByText('Missed')).toBeVisible();
  }
});

test.describe('in Los Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('a log finished at 11:30 pm local time stays on its planned day (Review Focus 5)', async ({ page }) => {
    await signInAsCoach(page);
    const today = await browserToday(page);
    const plannedDay = addDays(today, -3);
    const nextDay = addDays(plannedDay, 1);
    // 23:30 in Los Angeles on the planned day is already the next day in UTC (06:30 or 07:30).
    const finishedAt = [7, 8]
      .map((h) => `${addDays(plannedDay, 1)}T0${h - 1}:30:00Z`)
      .find((iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(iso)) === `${plannedDay}, 23:30`);
    if (!finishedAt) throw new Error('could not find 23:30 Los Angeles time');
    expect(finishedAt.slice(0, 10)).toBe(nextDay);

    const name = `Late ${unique()}`;
    const planned = await plan(name, plannedDay);
    const nextName = `Next ${unique()}`;
    await plan(nextName, nextDay);
    const logId = await log({ workspaceId, clientId, name, plannedWorkoutId: planned, startedAt: new Date(Date.parse(finishedAt) - 3_000_000).toISOString(), finishedAt });

    await page.goto(calendarUrl(clientId, plannedDay));
    const onPlanned = day(page, plannedDay).getByRole('listitem').filter({ hasText: name });
    await expect(onPlanned.getByRole('link', { name: /Done/ })).toHaveAttribute('href', `/clients/${clientId}/logs/${logId}`);
    // The next day's own workout is not marked done just because the log finished on that UTC date.
    await page.goto(calendarUrl(clientId, nextDay));
    const onNext = day(page, nextDay).getByRole('listitem').filter({ hasText: nextName });
    await expect(onNext.getByRole('link', { name: /Done/ })).toHaveCount(0);

    // The feed shows the finish time in the browser's zone: the planned day at 11:30 pm.
    await page.goto('/activity');
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row.locator('time')).toContainText('11:30');
    await page.screenshot({ path: process.env.SHOT_ACTIVITY ?? 'test-results/activity.png', fullPage: true });
  });
});

