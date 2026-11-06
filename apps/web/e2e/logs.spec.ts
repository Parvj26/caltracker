import { expect, test, type Page } from '@playwright/test';
import { seedLog, serviceClient, signInAsCoach } from './helpers';

// Activity feed and the done / missed marks on the client calendar (phase 3a Task 10). Every test seeds its own
// uniquely named workouts and logs, so tests can share the demo client and run side by side.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { logs: string[]; workouts: string[]; users: string[]; workspaces: string[] } = { logs: [], workouts: [], users: [], workspaces: [] };
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
  for (const id of created.workspaces) await admin.from('workspaces').delete().eq('id', id);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

/** An ISO timestamp `minutesAgo` before now, so seeded logs are always the newest in the feed. */
const ago = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const shortDay = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00Z`));

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
async function newClient(firstName: string, lastName: string, inWorkspace = workspaceId): Promise<string> {
  const u = await admin.auth.admin.createUser({
    email: `feed-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: inWorkspace, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  return u.data.user.id;
}

test('a finished workout shows in the activity feed with its sets and volume in the coach\'s units', async ({ page }) => {
  // The demo coach's units are shared by every test file, so this test uses its own coach (set to pounds), its own
  // workspace and its own client, and only ever sees its own logs.
  const password = 'coach-password-123';
  const email = `lb-coach-${unique()}@example.com`;
  const coach = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: 'Pound', last_name: 'Feed' } });
  if (coach.error) throw coach.error;
  created.users.push(coach.data.user.id);
  const ws = await admin.from('workspaces').insert({ name: `Feed Gym ${unique()}` }).select('id').single();
  if (ws.error) throw ws.error;
  created.workspaces.push(ws.data.id);
  const owner = await admin.from('workspace_members').insert({ workspace_id: ws.data.id, user_id: coach.data.user.id, role: 'owner' });
  if (owner.error) throw owner.error;
  const units = await admin.from('profiles').update({ units: 'lb' }).eq('id', coach.data.user.id);
  if (units.error) throw units.error;
  const mine = await newClient('Lena', `Lifter${unique()}`, ws.data.id);

  const name = `Feed ${unique()}`;
  const id = await log({ workspaceId: ws.data.id, clientId: mine, name, startedAt: ago(120), finishedAt: ago(67) });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('link', { name })).toHaveAttribute('href', `/clients/${mine}/logs/${id}`);
  await expect(row.getByText('Lena')).toBeVisible();
  await expect(row.getByText('3 sets')).toBeVisible();
  await expect(row.getByText('53 min')).toBeVisible();
  // 3 sets x 8 reps x 60 kg = 1,440 kg = 3,175 lb.
  await expect(row.getByText('3,175 lb lifted')).toBeVisible();
  await expect(row.getByText('Unplanned')).toBeVisible();
});

test('the feed shows only completed logs, with the auto-finished chip', async ({ page }) => {
  const done = `Auto ${unique()}`;
  const gone = `Dropped ${unique()}`;
  await log({ workspaceId, clientId, name: done, startedAt: ago(90), finishedAt: ago(60), autoFinished: true });
  await log({ workspaceId, clientId, name: gone, status: 'discarded', sets: 0, startedAt: ago(50) });
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
  await log({ workspaceId, clientId, name: mine, startedAt: ago(100), finishedAt: ago(70) });
  await log({ workspaceId, clientId: other, name: theirs, startedAt: ago(100), finishedAt: ago(71) });
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

test('a planned workout with a discarded log and then a completed one links to the completed log', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  const d = addDays(today, -2);
  const name = `Retry ${unique()}`;
  const planned = await plan(name, d);
  // The discarded attempt is the newer one by start time, so it must not win just by being the latest log.
  const finished = await log({ workspaceId, clientId, name, plannedWorkoutId: planned, startedAt: `${d}T08:00:00Z`, finishedAt: `${d}T08:40:00Z` });
  await log({ workspaceId, clientId, name, plannedWorkoutId: planned, status: 'discarded', sets: 0, startedAt: `${d}T18:00:00Z` });

  await page.goto(calendarUrl(clientId, d));
  const item = day(page, d).getByRole('listitem').filter({ hasText: name });
  await expect(item.getByRole('link', { name: /Done/ })).toHaveAttribute('href', `/clients/${clientId}/logs/${finished}`);
  await expect(item.getByText('Missed')).toHaveCount(0);
});

test('a long workout name stays readable next to its done mark', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  const d = addDays(today, -1);
  const name = `Upper Body A — Push ${unique()}`;
  const planned = await plan(name, d);
  await log({ workspaceId, clientId, name, plannedWorkoutId: planned, startedAt: `${d}T08:00:00Z`, finishedAt: `${d}T08:40:00Z` });
  await page.goto(calendarUrl(clientId, d));
  await expect(day(page, d).getByRole('listitem').filter({ hasText: name }).getByRole('link', { name: /Done/ })).toBeVisible();
  await page.screenshot({ path: process.env.SHOT_CALENDAR_FIX ?? 'test-results/calendar-fix1.png', fullPage: true });
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

    // Its own client, so the feed filter shows just this client's logs whatever else is in the workspace.
    const mine = await newClient('Lola', `Late${unique()}`);
    const name = `Late ${unique()}`;
    const planned = await plan(name, plannedDay, mine);
    const nextName = `Next ${unique()}`;
    await plan(nextName, nextDay, mine);
    const logId = await log({ workspaceId, clientId: mine, name, plannedWorkoutId: planned, startedAt: new Date(Date.parse(finishedAt) - 3_000_000).toISOString(), finishedAt });

    await page.goto(calendarUrl(mine, plannedDay));
    const onPlanned = day(page, plannedDay).getByRole('listitem').filter({ hasText: name });
    await expect(onPlanned.getByRole('link', { name: /Done/ })).toHaveAttribute('href', `/clients/${mine}/logs/${logId}`);
    // The next day's own workout is not marked done just because the log finished on that UTC date.
    await page.goto(calendarUrl(mine, nextDay));
    const onNext = day(page, nextDay).getByRole('listitem').filter({ hasText: nextName });
    await expect(onNext.getByRole('link', { name: /Done/ })).toHaveCount(0);

    // The feed shows the finish time in the browser's zone: the planned day at 11:30 pm.
    await page.goto(`/activity?client=${mine}`);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row.locator('time')).toHaveText(`${shortDay(plannedDay)}, 11:30 pm`);
    await page.screenshot({ path: process.env.SHOT_ACTIVITY ?? 'test-results/activity.png', fullPage: true });
  });
});


/* ---------- The logged workout page (phase 3a Task 11) ---------- */
const logUrl = (client: string, id: string) => `/clients/${client}/logs/${id}`;

test.describe('logged workout page', () => {
  test('shows planned against actual, with Not done, Swapped from and Added labels', async ({ page }) => {
    const name = `Planned ${unique()}`;
    const planned = await plan(name, addDays(new Date().toISOString().slice(0, 10), -1));
    const id = await log({
      workspaceId, clientId, name, plannedWorkoutId: planned, startedAt: ago(100), finishedAt: ago(50),
      notDone: 1, swappedFrom: 'Barbell Bench Press - Medium Grip', addedExercise: 'Barbell Incline Bench Press - Medium Grip',
    });
    await signInAsCoach(page);
    await page.goto(logUrl(clientId, id));
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const squat = page.getByRole('table', { name: 'Barbell Squat' });
    await expect(squat.getByRole('columnheader', { name: 'Planned' })).toBeVisible();
    await expect(squat.getByRole('columnheader', { name: 'Actual' })).toBeVisible();
    await expect(squat.getByRole('row').nth(1)).toContainText('8 reps · 60 kg');
    await expect(squat.getByRole('row').nth(1)).toContainText('60 kg × 8');
    await expect(squat.getByRole('row').nth(3)).toContainText('Not done');
    await expect(page.getByText('Swapped from Barbell Bench Press - Medium Grip')).toBeVisible();
    await expect(page.getByText('Added', { exact: true })).toBeVisible();
    await expect(page.getByText('3 sets')).toBeVisible();
    // Correct one set and leave a comment, so the screenshot shows the whole page.
    await page.getByRole('button', { name: 'Correct' }).click();
    await expect(squat.getByRole('row').nth(1).getByRole('textbox')).toHaveCount(2);
    await expect(squat.getByRole('row').nth(3).getByRole('textbox')).toHaveCount(0);
    await expect(squat.getByRole('row').nth(3)).toContainText('Not done');
    await squat.getByLabel('Set 1 reps').fill('6');
    await page.getByRole('button', { name: 'Save corrections' }).click();
    await expect(page.getByText('Edited by coach')).toBeVisible();
    await page.getByRole('textbox', { name: 'Comment' }).fill('Great depth today');
    await page.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByRole('region', { name: 'Comments' }).getByRole('listitem')).toContainText('Great depth today');
    await page.screenshot({ path: process.env.SHOT_LOG ?? 'test-results/log-page.png', fullPage: true });
  });

  test('comments can be posted, survive a reload and be deleted', async ({ page }) => {
    const id = await log({ workspaceId, clientId, name: `Talk ${unique()}`, startedAt: ago(100), finishedAt: ago(60) });
    await signInAsCoach(page);
    await page.goto(logUrl(clientId, id));
    await page.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByText('Write a comment first.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Comment' }).fill('Great depth today');
    await page.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByRole('region', { name: 'Comments' }).getByRole('listitem').filter({ hasText: 'Great depth today' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Comments' }).getByRole('listitem').filter({ hasText: 'Great depth today' })).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete comment' }).click();
    await expect(page.getByRole('region', { name: 'Comments' }).getByRole('listitem').filter({ hasText: 'Great depth today' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Comments' }).getByRole('listitem').filter({ hasText: 'Great depth today' })).toHaveCount(0);
  });

  test('a correction changes the actual reps and marks the log edited', async ({ page }) => {
    const id = await log({ workspaceId, clientId, name: `Fix ${unique()}`, startedAt: ago(100), finishedAt: ago(60) });
    await signInAsCoach(page);
    await page.goto(logUrl(clientId, id));
    await expect(page.getByText('Edited by coach')).toHaveCount(0);

    await page.getByRole('button', { name: 'Correct' }).click();
    await page.getByRole('button', { name: 'Save corrections' }).click();
    await expect(page.getByText('Nothing to change.')).toBeVisible();

    await page.getByLabel('Set 1 reps').fill('');
    await page.getByRole('button', { name: 'Save corrections' }).click();
    await expect(page.getByText("Reps can't be blank.")).toBeVisible();
    await page.getByLabel('Set 1 reps').fill('6');
    await page.getByRole('button', { name: 'Save corrections' }).click();
    await expect(page.getByText('Edited by coach')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Barbell Squat' }).getByRole('row').nth(1)).toContainText('60 kg × 6');
    const rows = await admin.from('log_sets').select('actual_reps, position').eq('log_id', id).order('position');
    expect(rows.data?.map((r) => r.actual_reps)).toEqual([6, 8, 8]);
  });

  test('an in-progress log cannot be corrected', async ({ page }) => {
    // Its own client: only one in-progress log may exist per client.
    const mine = await newClient('Ivy', `Live${unique()}`);
    const id = await log({ workspaceId, clientId: mine, name: `Live ${unique()}`, status: 'in_progress', startedAt: ago(30) });
    await signInAsCoach(page);
    await page.goto(logUrl(mine, id));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Correct' })).toHaveCount(0);
  });

  test('404s for a missing log, another client\'s log, another workspace\'s log; a removed client stays readable', async ({ page }) => {
    await signInAsCoach(page);
    const other = await newClient('Olive', `Other${unique()}`);
    const otherLog = await log({ workspaceId, clientId: other, name: `Other ${unique()}`, startedAt: ago(100), finishedAt: ago(60) });
    const res = await page.goto(logUrl(clientId, otherLog));
    expect(res?.status()).toBe(404);
    expect((await page.goto(logUrl(clientId, '00000000-0000-4000-8000-000000000000')))?.status()).toBe(404);

    const ws = await admin.from('workspaces').insert({ name: `Elsewhere ${unique()}` }).select('id').single();
    if (ws.error) throw ws.error;
    created.workspaces.push(ws.data.id);
    const stranger = await newClient('Sam', `Away${unique()}`, ws.data.id);
    const foreign = await log({ workspaceId: ws.data.id, clientId: stranger, name: `Foreign ${unique()}`, startedAt: ago(100), finishedAt: ago(60) });
    expect((await page.goto(logUrl(stranger, foreign)))?.status()).toBe(404);

    // Removed client: still readable.
    expect((await page.goto(logUrl(other, otherLog)))?.status()).toBe(200);
    const gone = await admin.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', other);
    if (gone.error) throw gone.error;
    const past = await admin.from('past_clients').insert({ workspace_id: workspaceId, user_id: other, email: `past-${unique()}@example.com`, first_name: 'Olive', last_name: 'Gone' });
    if (past.error) throw past.error;
    const res2 = await page.goto(logUrl(other, otherLog));
    expect(res2?.status()).toBe(200);
    await expect(page.getByText('Olive Gone (past client)')).toBeVisible();
  });
});
