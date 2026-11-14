import { expect, test, type Locator, type Page } from '@playwright/test';
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

/** A row of Today (only the rows themselves, not the items of their "⋯" menus). */
const rowFor = (page: Page, lastName: string) => page.locator('#today li[data-today-row]').filter({ hasText: lastName });

/**
 * Needs attention, narrowed by a filter chip (when given) and opened in full (it shows 6 rows first), so a test never
 * loses its client behind the cap in the shared demo workspace.
 */
async function attentionList(page: Page, chip?: 'Missed' | 'Plan ending' | 'Scan due'): Promise<Locator> {
  const region = page.getByRole('region', { name: 'Needs attention' });
  await expect(region).toBeVisible();
  if (chip) {
    const button = region.getByRole('button', { name: new RegExp(`^${chip} \\d+$`) });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  const showAll = region.getByRole('button', { name: /^Show all \d+$/ });
  if (await showAll.count()) await showAll.click();
  return region;
}

test('signing in lands on /home and Home is the current nav item', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(COACH_EMAIL);
  await page.getByLabel('Password').fill('demo-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  // One quiet line of week stats replaces the old tiles.
  await expect(page.getByText(/^This week: \d+ of \d+ workouts done · \d+ new PRs? · \d+ clients?$/)).toBeVisible();
});

test('a workout today is Not started with Log session, then Done with View, linking to the log', async ({ page }) => {
  const last = `Tday${unique()}`;
  const clientId = await newClient(last);
  const workoutId = await plan(clientId, 'Leg day', dayOffset(0));
  await signInAsCoach(page);
  await page.goto('/home');
  let row = rowFor(page, last);
  await expect(row).toContainText('Not started');
  // "Log session" opens the coach's session logging page.
  await expect(row.getByRole('link', { name: /^Log session: / })).toHaveAttribute('href', `/clients/${clientId}/log/${workoutId}`);

  const start = new Date(Date.now() - 52 * 60_000).toISOString();
  const logId = await seedLog(admin, { workspaceId, clientId, name: 'Leg day', plannedWorkoutId: workoutId, startedAt: start, finishedAt: new Date().toISOString() });
  created.logs.push(logId);
  await page.reload();
  row = rowFor(page, last);
  await expect(row).toContainText('✓ Done');
  await expect(row).toContainText('Leg day · 52 min');
  await expect(row.getByRole('link', { name: /^View: / })).toHaveAttribute('href', `/clients/${clientId}/logs/${logId}`);
  await expect(row.getByRole('link', { name: /^Log session: / })).toHaveCount(0);
});

test('an in-progress log shows a Training now card and a Live row with Watch', async ({ page }) => {
  const last = `Train${unique()}`;
  const clientId = await newClient(last);
  const workoutId = await plan(clientId, 'Push', dayOffset(0));
  const logId = await seedLog(admin, { workspaceId, clientId, name: 'Push', plannedWorkoutId: workoutId, status: 'in_progress', startedAt: new Date().toISOString(), loggedBy: clientId });
  created.logs.push(logId);
  await signInAsCoach(page);
  await page.goto('/home');
  const row = rowFor(page, last);
  await expect(row).toContainText('● Live');
  await expect(row.getByRole('link', { name: /^Watch: / })).toHaveAttribute('href', `/clients/${clientId}/logs/${logId}`);
  // The dark card under "Training now" opens the live view too.
  const now = page.getByRole('region', { name: 'Training now' });
  const card = now.getByRole('link', { name: new RegExp(`^Watch Home ${last} live: Push, \\d+ of \\d+ sets$`) });
  await expect(card).toHaveAttribute('href', `/clients/${clientId}/logs/${logId}`);
  await expect(card).toContainText(/Push · \d+ min/);
  await expect(card).toContainText(/\d+ of \d+ sets · Watch live →/);
  await card.click();
  await expect(page).toHaveURL(`/clients/${clientId}/logs/${logId}`);
});

test('the coach\'s own session in progress offers Continue', async ({ page }) => {
  const last = `Mine${unique()}`;
  const clientId = await newClient(last);
  const workoutId = await plan(clientId, 'Pull', dayOffset(0));
  const coach = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === COACH_EMAIL)!;
  created.logs.push(await seedLog(admin, { workspaceId, clientId, name: 'Pull', plannedWorkoutId: workoutId, status: 'in_progress', startedAt: new Date().toISOString(), loggedBy: coach.id }));
  await signInAsCoach(page);
  await page.goto('/home');
  const row = rowFor(page, last);
  await expect(row.getByRole('link', { name: /^Continue: / })).toHaveAttribute('href', `/clients/${clientId}/log/${workoutId}`);
  await expect(row.getByRole('link', { name: /^Watch: / })).toHaveCount(0);
});

test('a client already training another workout gets Watch live, not Log session (which would be refused)', async ({ page }) => {
  const last = `Busy${unique()}`;
  const clientId = await newClient(last);
  const yesterday = await plan(clientId, 'Catch-up', dayOffset(-1));
  await plan(clientId, 'Legs', dayOffset(0));
  const logId = await seedLog(admin, { workspaceId, clientId, name: 'Catch-up', plannedWorkoutId: yesterday, status: 'in_progress', startedAt: new Date().toISOString(), loggedBy: clientId });
  created.logs.push(logId);
  await signInAsCoach(page);
  await page.goto('/home');
  const row = rowFor(page, last).filter({ hasText: 'Legs' });
  await expect(row.getByRole('link', { name: /^Watch live: / })).toHaveAttribute('href', `/clients/${clientId}/logs/${logId}`);
  await expect(row.getByRole('link', { name: /^Log session: / })).toHaveCount(0);
});

test('the coach logging another workout in person gets Continue to that session on today\'s row', async ({ page }) => {
  const last = `Busyme${unique()}`;
  const clientId = await newClient(last);
  const yesterday = await plan(clientId, 'Catch-up', dayOffset(-1));
  await plan(clientId, 'Legs', dayOffset(0));
  const coach = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === COACH_EMAIL)!;
  created.logs.push(await seedLog(admin, { workspaceId, clientId, name: 'Catch-up', plannedWorkoutId: yesterday, status: 'in_progress', startedAt: new Date().toISOString(), loggedBy: coach.id }));
  await signInAsCoach(page);
  await page.goto('/home');
  const row = rowFor(page, last).filter({ hasText: 'Legs' });
  await expect(row.getByRole('link', { name: /^Continue: / })).toHaveAttribute('href', `/clients/${clientId}/log/${yesterday}`);
  await expect(row.getByRole('link', { name: /^(Log session|Watch live): / })).toHaveCount(0);
});

test('every Today row has exactly one primary button, and ⋯ holds Message, Assign and Open client', async ({ page }) => {
  const last = `One${unique()}`;
  const clientId = await newClient(last);
  await plan(clientId, 'Upper', dayOffset(0));
  await signInAsCoach(page);
  await page.goto('/home');
  await expect(rowFor(page, last)).toBeVisible();
  const rows = page.locator('#today li[data-today-row]');
  const perRow = await rows.evaluateAll((els) => els.map((el) => el.querySelectorAll('[data-primary]').length));
  expect(perRow.length).toBeGreaterThan(0);
  expect(perRow.every((n) => n === 1), `primary buttons per row: ${perRow.join(', ')}`).toBe(true);
  await expect(page.getByText('⋯ has Message, Assign and Open client.')).toBeVisible();

  const more = rowFor(page, last).getByRole('button', { name: `More for Home ${last}` });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu', { name: `More for Home ${last}` });
  await expect(menu.getByRole('menuitem')).toHaveText(['Message', 'Assign', 'Open client']);
  await expect(menu.getByRole('menuitem', { name: 'Message' })).toHaveAttribute('href', `/messages/${clientId}`);
  await expect(menu.getByRole('menuitem', { name: 'Assign' })).toHaveAttribute('href', `/clients/${clientId}/training`);
  await expect(menu.getByRole('menuitem', { name: 'Open client' })).toHaveAttribute('href', `/clients/${clientId}`);
  // Focus starts on the first item; arrows move, Escape closes and returns to the button.
  await expect(menu.getByRole('menuitem', { name: 'Message' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Assign' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
});

test('two undone workouts in the last 2 days list the client under Missed, with Message', async ({ page }) => {
  const last = `Miss${unique()}`;
  // Joined before the missed days: workouts planned before joining never count as missed.
  const clientId = await newClient(last, 10);
  await plan(clientId, 'Pull A', dayOffset(-1));
  await plan(clientId, 'Pull B', dayOffset(-2));
  await signInAsCoach(page);
  await page.goto('/home');
  const list = await attentionList(page, 'Missed');
  const row = list.locator('li').filter({ hasText: last });
  await expect(row).toContainText('Missed 2 workouts in a row');
  // One fix button per row.
  await expect(row.getByRole('link')).toHaveCount(1);
  await expect(row.getByRole('link', { name: `Message Home ${last}` })).toHaveAttribute('href', `/messages/${clientId}`);
});

test('one missed workout this week is listed with its day; a workout today is not missed yet', async ({ page }) => {
  const last = `Once${unique()}`;
  const clientId = await newClient(last, 10);
  await plan(clientId, 'Legs', dayOffset(-1));
  await plan(clientId, 'Arms', dayOffset(0));
  await signInAsCoach(page);
  await page.goto('/home');
  const list = await attentionList(page, 'Missed');
  await expect(list.locator('li').filter({ hasText: last })).toContainText('Missed yesterday');
  await expect(list.locator('li').filter({ hasText: last })).not.toContainText('in a row');
});

test('a client with nothing planned is listed with Assign', async ({ page }) => {
  const last = `Empty${unique()}`;
  const clientId = await newClient(last, 29);
  await signInAsCoach(page);
  await page.goto('/home');
  const list = await attentionList(page);
  const row = list.locator('li').filter({ hasText: last });
  await expect(row).toContainText('Nothing planned in the next 7 days');
  await expect(row.getByRole('link')).toHaveCount(1);
  await expect(row.getByRole('link', { name: /^Assign to / })).toHaveAttribute('href', `/clients/${clientId}/training`);
});

test('a program ending in 3 days says which day it ends, with nothing after', async ({ page }) => {
  const last = `Ends${unique()}`;
  const clientId = await newClient(last);
  const a = await admin.from('program_assignments').insert({ workspace_id: workspaceId, client_id: clientId, program_name: `Ending ${unique()}`, weeks: 1, start_date: dayOffset(-3) }).select('id').single();
  if (a.error) throw a.error;
  created.assignments.push(a.data.id);
  await signInAsCoach(page);
  await page.goto('/home');
  const list = await attentionList(page, 'Plan ending');
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(new Date(Date.now() + 3 * MS_DAY));
  const row = list.locator('li').filter({ hasText: last });
  await expect(row).toContainText(`Program ends ${weekday} · nothing after`);
  await expect(row.getByRole('link', { name: `Assign to Home ${last}` })).toHaveAttribute('href', `/clients/${clientId}/training`);
  // Ending replaces Nothing planned, so the client is listed once.
  await expect(list.locator('li').filter({ hasText: last })).toHaveCount(1);
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

test('today\'s ⋯ menu offers Message and the console has no hydration errors', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(m.text()));
  // A production build reports hydration mismatches as minified React errors (#418, #423, #425) on pageerror.
  page.on('pageerror', (e) => messages.push(e.message));
  const last = `Soon${unique()}`;
  const clientId = await newClient(last, 10);
  await plan(clientId, 'Core', dayOffset(0));
  await signInAsCoach(page);
  await page.goto('/home');
  await expect(rowFor(page, last)).toBeVisible();
  // Today's row keeps Message in its "⋯" menu; it opens the client's conversation.
  await rowFor(page, last).getByRole('button', { name: `More for Home ${last}` }).click();
  await page.getByRole('menuitem', { name: 'Message' }).click();
  await expect(page).toHaveURL(`/messages/${clientId}`);
  expect(messages.filter((t) => /hydrat|#418|#423|#425/i.test(t))).toEqual([]);
});

test('the week line counts this week\'s new PRs of current clients', async ({ page }) => {
  const stats = page.getByText(/^This week: /);
  const read = async () => Number((await stats.textContent())?.match(/(\d+) new PR/)?.[1] ?? 'NaN');
  await signInAsCoach(page);
  await page.goto('/home');
  const before = await read();
  expect(before).not.toBeNaN();

  const clientId = await newClient(`Prs${unique()}`);
  const squat = await admin.from('exercises').select('id').eq('name', 'Barbell Squat').is('workspace_id', null).limit(1).single();
  if (squat.error) throw squat.error;
  const deadlift = await admin.from('exercises').select('id').eq('name', 'Barbell Deadlift').is('workspace_id', null).limit(1).single();
  if (deadlift.error) throw deadlift.error;
  const now = new Date().toISOString();
  const result = (logId: string, achievedAt: string) => ({
    ladder: null, drop: null, rare: [], landmarks: [], milestone: null,
    prs: [
      { exerciseId: squat.data.id, kind: 'heaviest', valueKg: 100, reps: 5, logId, achievedAt },
      { exerciseId: squat.data.id, kind: 'e1rm', valueKg: 116.7, reps: 5, logId, achievedAt },
      { exerciseId: deadlift.data.id, kind: 'heaviest', valueKg: 80, reps: 5, logId, achievedAt },
    ],
  });
  // Today's workout: two lifts improved (the squat's two records count once). An old one does not count.
  const fresh = await seedLog(admin, { workspaceId, clientId, name: 'Prs now', startedAt: new Date(Date.now() - 3_600_000).toISOString(), finishedAt: now });
  const old = await seedLog(admin, { workspaceId, clientId, name: 'Prs old', startedAt: new Date(Date.now() - 20 * MS_DAY - 3_600_000).toISOString(), finishedAt: new Date(Date.now() - 20 * MS_DAY).toISOString() });
  created.logs.push(fresh, old);
  for (const [logId, at] of [[fresh, now], [old, new Date(Date.now() - 20 * MS_DAY).toISOString()]] as const) {
    const a = await admin.from('awards').insert({ log_id: logId, client_id: clientId, workspace_id: workspaceId, result: result(logId, at) });
    if (a.error) throw a.error;
  }
  await page.reload();
  // Other tests share the demo workspace, so only the rise is checked. Near Monday 00:00 the "now" PR is this week too.
  await expect.poll(read).toBeGreaterThanOrEqual(before + 2);
});

test('typing part of a name in any case finds the client, and Enter opens their page', async ({ page }) => {
  const last = `Findme${unique()}`;
  const clientId = await newClient(last);
  await signInAsCoach(page);
  await page.goto('/home');
  const box = page.getByRole('combobox', { name: 'Find a client' });
  await box.fill(last.toUpperCase());
  const option = page.getByRole('option', { name: new RegExp(last) });
  await expect(option).toBeVisible();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await expect(box).toHaveAttribute('aria-activedescendant', (await option.getAttribute('id'))!);
  await box.press('Escape');
  await expect(box).toHaveValue('');
  await box.fill(last.toLowerCase());
  await box.press('ArrowDown');
  await box.press('Enter');
  // Search lands on the client's Training (their calendar), where most visits from Home are headed.
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/training$`));
});

test('Cmd/Ctrl+K focuses the search box', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/home');
  const box = page.getByRole('combobox', { name: 'Find a client' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+K');
  await expect(box).toBeFocused();
});

test('a workout on the coach\'s own date shows in Today\'s clients when it is evening in Los Angeles and already tomorrow in UTC', async ({ browser }) => {
  const last = `LA${unique()}`;
  const clientId = await newClient(last);
  // D is the real UTC date. The browser clock is pinned to D+1 03:00 UTC, which is 19:00 on D in Los Angeles.
  const d = new Date().toISOString().slice(0, 10);
  await plan(clientId, 'LA day', d);
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  try {
    const page = await context.newPage();
    await signInAsCoach(page);
    await page.clock.setFixedTime(new Date(Date.parse(`${d}T00:00:00Z`) + 27 * 3600e3));
    await page.goto('/home');
    const dates = await page.evaluate(() => ({
      la: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()),
      utc: new Date().toISOString().slice(0, 10),
    }));
    expect(dates.la).toBe(d);
    expect(dates.utc).toBe(new Date(Date.parse(`${d}T00:00:00Z`) + MS_DAY).toISOString().slice(0, 10));
    await expect(rowFor(page, last)).toContainText('Not started');
  } finally {
    await context.close();
  }
});

test('ArrowDown and ArrowUp wrap round the results, and Escape clears the box', async ({ page }) => {
  const stem = `Wrap${unique()}`;
  await newClient(`${stem}A`);
  await newClient(`${stem}B`);
  await signInAsCoach(page);
  await page.goto('/home');
  const box = page.getByRole('combobox', { name: 'Find a client' });
  await box.fill(stem);
  const options = page.getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await box.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await box.press('ArrowDown');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await box.press('ArrowUp');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await box.press('Escape');
  await expect(box).toHaveValue('');
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await box.fill('zzzz-no-such-client');
  await expect(page.getByRole('status').filter({ hasText: 'No clients match.' })).toBeVisible();
});
