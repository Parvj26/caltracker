import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { seedLog, serviceClient, signInAsCoach } from './helpers';

// Activity feed and the done / missed marks on the client calendar (phase 3a Task 10). Every test seeds its own
// uniquely named workouts and logs, so tests can share the demo client and run side by side.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { logs: string[]; workouts: string[]; users: string[]; workspaces: string[]; exercises: string[] } = { logs: [], workouts: [], users: [], workspaces: [], exercises: [] };
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
  // After the logs: a log's exercises restrict deleting the exercise they point at.
  if (created.exercises.length) {
    const gone = await admin.from('exercises').delete().in('id', created.exercises).eq('workspace_id', workspaceId);
    if (gone.error) throw gone.error;
  }
  for (const id of created.workspaces) await admin.from('workspaces').delete().eq('id', id);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

/** An ISO timestamp `minutesAgo` before now, so seeded logs are always the newest in the feed. */
const ago = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
// "4 Nov", as formatDateTime (packages/shared) prints it on every engine: "Sep", never Node's en-GB "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The Activity feed's day heading for a day at least 2 days back: "Tue 10 Nov", plus the year when it isn't this year. */
const dayHeading = (d: string, today: string) =>
  `${WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${shortDay(d)}${d.slice(0, 4) === today.slice(0, 4) ? '' : ` ${d.slice(0, 4)}`}`;
/** One workout in the Activity feed: a list item whose whole row is a link to the log. */
const feedItem = (page: Page, text: string) => page.getByRole('main').getByRole('listitem').filter({ hasText: text });

/* ---------- Plain YYYY-MM-DD maths (UTC only) ---------- */
const MS_DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * MS_DAY).toISOString().slice(0, 10);
const browserToday = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
const calendarUrl = (id: string, date: string) => `/clients/${id}/training?month=${date.slice(0, 7)}`;
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
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();

  const row = feedItem(page, name);
  await expect(row).toHaveCount(1);
  // The whole row is one link to the log.
  await expect(row.getByRole('link')).toHaveAttribute('href', `/clients/${mine}/logs/${id}`);
  await expect(row.getByText('Lena')).toBeVisible();
  // 3 sets x 8 reps x 60 kg = 1,440 kg = 3,175 lb.
  await expect(row).toContainText('53 min · 3 sets · 3,175 lb lifted');
  await expect(row.getByText('Unplanned')).toBeVisible();
  // No comment from the coach yet: the dot shows, and the title counts it.
  await expect(row.getByRole('img', { name: 'Not reviewed' })).toBeVisible();
  await expect(page.getByText(/1 to review/)).toBeVisible();
});

test('the feed shows only completed logs, with the auto-finished chip', async ({ page }) => {
  const done = `Auto ${unique()}`;
  const gone = `Dropped ${unique()}`;
  await log({ workspaceId, clientId, name: done, startedAt: ago(90), finishedAt: ago(60), autoFinished: true });
  await log({ workspaceId, clientId, name: gone, status: 'discarded', sets: 0, startedAt: ago(50) });
  await signInAsCoach(page);
  await page.goto('/activity');
  await expect(feedItem(page, done).getByText('Auto-finished')).toBeVisible();
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

  // No Filter button: typing a name with a typo and picking the suggestion narrows the feed straight away.
  await expect(page.getByRole('button', { name: 'Filter' })).toHaveCount(0);
  const box = page.getByRole('combobox', { name: 'Filter by client' });
  // It looks like a dropdown ("Client: All ▾"), and tapping it lists every client without typing.
  await expect(box).toHaveAttribute('placeholder', 'All');
  await expect(page.getByText('Client:', { exact: true })).toBeVisible();
  await box.click();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('option', { name: `Sam ${last}`, exact: true })).toBeVisible();
  const typo = `${last.slice(0, 2)}${last[3]}${last[2]}${last.slice(4)}`;
  await box.fill(`sam ${typo}`);
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  const option = page.getByRole('option', { name: `Sam ${last}`, exact: true });
  await expect(option).toBeVisible();
  // The first suggestion is active and announced through aria-activedescendant.
  await expect(box).toHaveAttribute('aria-activedescendant', /.+/);
  // Earlier runs may leave clients with similar names, so pick this one by its exact name.
  await option.click();
  await expect(page).toHaveURL(new RegExp(`client=${other}`));
  await expect(page.getByText(theirs)).toBeVisible();
  await expect(page.getByText(mine)).toHaveCount(0);
  await expect(box).toHaveValue(`Sam ${last}`);

  // Back shows everyone again, and Forward the filtered feed with the name in the box.
  await page.goBack();
  await expect(page.getByText(mine)).toBeVisible();
  await expect(box).toHaveValue('');
  await page.goForward();
  await expect(page.getByText(mine)).toHaveCount(0);
  await expect(box).toHaveValue(`Sam ${last}`);

  // The × shows everyone again.
  await page.getByRole('button', { name: 'Show all clients' }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByText(mine)).toBeVisible();
  await expect(page.getByText(theirs)).toBeVisible();
  await expect(box).toHaveValue('');
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
    const row = feedItem(page, name);
    await expect(row.locator('time')).toHaveText('11:30 pm');
    // Under the heading of its local day, not the UTC day after it.
    const section = page.getByRole('region', { name: dayHeading(plannedDay, today) });
    await expect(section.getByRole('listitem').filter({ hasText: name })).toHaveCount(1);
    await page.screenshot({ path: process.env.SHOT_ACTIVITY ?? 'test-results/activity.png', fullPage: true });
  });

  test('a workout the client added shows as "Added by client" on the local day it finished and opens its log', async ({ page }) => {
    await signInAsCoach(page);
    const today = await browserToday(page);
    const runDay = addDays(today, -2);
    // 23:30 in Los Angeles on runDay is already the next day in UTC: the calendar must use the local day.
    const finishedAt = [7, 8]
      .map((h) => `${addDays(runDay, 1)}T0${h - 1}:30:00Z`)
      .find((iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(iso)) === `${runDay}, 23:30`);
    if (!finishedAt) throw new Error('could not find 23:30 Los Angeles time');
    const mine = await newClient('Ari', `Added${unique()}`);
    const name = `Saturday run ${unique()}`;
    const logId = await log({ workspaceId, clientId: mine, name, startedAt: new Date(Date.parse(finishedAt) - 1_800_000).toISOString(), finishedAt });
    // A discarded one is never shown.
    const discarded = `Gave up ${unique()}`;
    await log({ workspaceId, clientId: mine, name: discarded, status: 'discarded', startedAt: ago(300), finishedAt: ago(280) });

    await page.goto(calendarUrl(mine, runDay));
    const added = day(page, runDay).getByRole('link', { name: `${name}, added by client: view the log` });
    await expect(added).toBeVisible();
    await expect(added).toContainText('Added by client');
    await expect(day(page, addDays(runDay, 1)).getByText(name)).toHaveCount(0);
    // It isn't a planned workout: no options menu, not draggable, never "Missed".
    await expect(page.getByRole('button', { name: `Options for ${name}` })).toHaveCount(0);
    await expect(day(page, runDay).getByText('Missed')).toHaveCount(0);
    await expect(page.getByText(discarded)).toHaveCount(0);
    await added.click();
    await expect(page).toHaveURL(new RegExp(`/clients/${mine}/logs/${logId}$`));
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
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
      notDone: 1, swappedFrom: 'Barbell Deadlift', addedExercise: 'Cable Crossover',
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
    await expect(page.getByText('Swapped from Barbell Deadlift')).toBeVisible();
    await expect(page.getByText('Added', { exact: true })).toBeVisible();
    await expect(page.getByText('3 sets')).toBeVisible();
    // Correct one set and leave a comment, so the screenshot shows the whole page.
    await page.getByRole('button', { name: 'Correct' }).click();
    await expect(squat.getByRole('row').nth(1).getByRole('textbox')).toHaveCount(2);
    await expect(squat.getByRole('row').nth(3).getByRole('textbox')).toHaveCount(0);
    await expect(squat.getByRole('row').nth(3)).toContainText('Not done');
    await squat.getByLabel('Set 1 reps').fill('6');
    await page.getByRole('button', { name: 'Save corrections' }).click();
    // Saving waits for the award-workout function to recompute the client's bests (recomputeAward), which can take
    // well over the default 5 s when the function is cold or busy with the other workers' finishes.
    await expect(page.getByText('Edited by coach')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Comment' }).fill('Great depth today');
    await page.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByRole('region', { name: 'Comments' }).getByRole('listitem')).toContainText('Great depth today');
    await page.screenshot({ path: process.env.SHOT_LOG ?? 'test-results/log-page.png', fullPage: true });
  });

  test("shows the client's workout note near the top and each exercise note on its exercise", async ({ page }) => {
    const name = `Notes ${unique()}`;
    const id = await log({ workspaceId, clientId, name, startedAt: ago(90), finishedAt: ago(40), addedExercise: 'Cable Crossover' });
    const w = await admin.from('workout_logs').update({ notes: 'Slept badly, kept it light.' }).eq('id', id);
    if (w.error) throw w.error;
    const squat = await admin.from('exercises').select('id').eq('name', 'Barbell Squat').is('workspace_id', null).limit(1).single();
    if (squat.error) throw squat.error;
    const e = await admin.from('log_exercises').update({ note: 'Left knee felt tight, went lighter' }).eq('log_id', id).eq('exercise_id', squat.data.id);
    if (e.error) throw e.error;

    await signInAsCoach(page);
    await page.goto(logUrl(clientId, id));
    const workoutNote = page.getByRole('figure', { name: "Client's note on this workout" });
    await expect(workoutNote).toContainText("Client's note");
    await expect(workoutNote).toContainText('Slept badly, kept it light.');
    // The workout note sits in the header, above the first exercise.
    const noteBox = await workoutNote.boundingBox();
    const tableBox = await page.getByRole('table', { name: 'Barbell Squat' }).boundingBox();
    expect(noteBox!.y).toBeLessThan(tableBox!.y);
    // The exercise note sits inside the card of the exercise it belongs to; the other exercise has none.
    // An exercise's card is the element its table sits in.
    const squatCard = page.getByRole('table', { name: 'Barbell Squat' }).locator('xpath=..');
    await expect(squatCard.getByRole('figure', { name: "Client's note on Barbell Squat" })).toContainText('Left knee felt tight, went lighter');
    const cableCard = page.getByRole('table', { name: 'Cable Crossover' }).locator('xpath=..');
    await expect(cableCard.getByRole('figure')).toHaveCount(0);
  });

  test('a sectioned log shows headings, the picked option, and no table for the option not picked', async ({ page }) => {
    const u = unique();
    const slam = `Slam ${u}`;
    const walk = `Walk ${u}`;
    const custom = await admin.from('exercises').insert([slam, walk].map((name) => ({ workspace_id: workspaceId, source: 'custom' as const, name, tracking_type: 'weight_reps' as const }))).select('id');
    if (custom.error) throw custom.error;
    created.exercises.push(...custom.data.map((r) => r.id));
    const sections = ['Warm-Up', 'Main', 'Core', 'Finisher'].map((name) => ({ id: randomUUID(), name }));
    const [warm, main, core, fin] = sections.map((x) => x.id) as [string, string, string, string];
    const id = await log({
      workspaceId, clientId, name: `Upper ${u}`, startedAt: ago(100), finishedAt: ago(50), sections,
      blocks: [
        { sectionId: warm, exercises: ['Barbell Deadlift'] },
        { sectionId: main, exercises: ['Barbell Squat'] },
        { sectionId: core, exercises: ['Cable Crossover'] },
        { sectionId: fin, choice: true, picked: slam, exercises: [walk, slam] },
      ],
    });
    await signInAsCoach(page);
    await page.goto(logUrl(clientId, id));
    for (const name of ['Warm-Up', 'Main', 'Core', 'Finisher']) await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible();
    // Exercises sit one level below their section.
    await expect(page.getByRole('heading', { level: 4, name: slam, exact: true })).toBeVisible();
    await expect(page.getByText(`Picked: ${slam}`)).toBeVisible();
    await expect(page.getByRole('table', { name: slam })).toBeVisible();
    await expect(page.getByRole('table', { name: walk })).toHaveCount(0);
    await expect(page.getByText(walk)).toHaveCount(0);
    await expect(page.getByText('Not done', { exact: true })).toHaveCount(0);
    // Correcting only offers boxes for the picked option.
    await page.getByRole('button', { name: 'Correct' }).click();
    await expect(page.getByRole('table', { name: slam }).getByRole('textbox')).toHaveCount(4);
    await expect(page.getByText('Pick one · not done')).toHaveCount(0);
  });

  test('a pick-one group nobody chose from says so and lists the options', async ({ page }) => {
    const u = unique();
    const a = `Slam ${u}`;
    const b = `Walk ${u}`;
    const custom = await admin.from('exercises').insert([a, b].map((name) => ({ workspace_id: workspaceId, source: 'custom' as const, name, tracking_type: 'weight_reps' as const }))).select('id');
    if (custom.error) throw custom.error;
    created.exercises.push(...custom.data.map((r) => r.id));
    const fin = randomUUID();
    const id = await log({
      workspaceId, clientId, name: `Unpicked ${u}`, startedAt: ago(100), finishedAt: ago(50), sections: [{ id: fin, name: 'Finisher' }],
      blocks: [{ exercises: ['Barbell Squat'] }, { sectionId: fin, choice: true, exercises: [a, b] }],
    });
    await signInAsCoach(page);
    await page.goto(logUrl(clientId, id));
    await expect(page.getByRole('heading', { level: 3, name: 'Finisher' })).toBeVisible();
    // The unsectioned exercise is an <h3> straight under "Planned vs. actual".
    await expect(page.getByRole('heading', { level: 3, name: 'Barbell Squat', exact: true })).toBeVisible();
    await expect(page.getByText('Pick one · not done')).toBeVisible();
    await expect(page.getByText(`${a} · ${b}`)).toBeVisible();
    await expect(page.getByRole('table', { name: a })).toHaveCount(0);
    await expect(page.getByText('Not done', { exact: true })).toHaveCount(0);
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
    // Saving waits for the award-workout recompute (see the planned-against-actual test).
    await expect(page.getByText('Edited by coach')).toBeVisible({ timeout: 30_000 });
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
