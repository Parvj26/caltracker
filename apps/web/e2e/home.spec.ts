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

/** A row of Today's clients. */
const rowFor = (page: Page, lastName: string) => page.locator('#today li').filter({ hasText: lastName });

/** Opens a Needs attention group in full (each shows 5 rows first), so a test never loses its client behind the cap. */
async function expandGroup(group: Locator) {
  await expect(group).toBeVisible();
  const showAll = group.getByRole('button', { name: /^Show all \d+$/ });
  if (await showAll.count()) await showAll.click();
}

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
  await expect(row.locator('[role="note"]').filter({ hasText: 'Log session' })).toBeVisible();

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

test('the four tiles are the same height, linked or not', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/home');
  const tiles = page.locator('[class*="tiles"] > *');
  await expect(tiles).toHaveCount(4);
  const heights = await tiles.evaluateAll((els) => els.map((el) => Math.round(el.firstElementChild && el.tagName === 'A' ? el.firstElementChild.getBoundingClientRect().height : el.getBoundingClientRect().height)));
  expect(new Set(heights).size, `tile heights ${heights.join(', ')}`).toBe(1);
});

test('two undone workouts in the last 2 days list the client under Missed 2+ in a row', async ({ page }) => {
  const last = `Miss${unique()}`;
  // Joined before the missed days: workouts planned before joining never count as missed.
  const clientId = await newClient(last, 10);
  await plan(clientId, 'Pull A', dayOffset(-1));
  await plan(clientId, 'Pull B', dayOffset(-2));
  await signInAsCoach(page);
  await page.goto('/home');
  const group = page.locator('#missed-in-a-row');
  await expandGroup(group);
  await expect(group.getByRole('heading', { name: /^Missed 2\+ in a row \(\d+\)$/ })).toBeVisible();
  const row = group.locator('li').filter({ hasText: last });
  await expect(row).toContainText('Missed 2 in a row · latest yesterday');
  await expect(row.getByRole('link', { name: /^Open / })).toHaveAttribute('href', `/clients/${clientId}`);
  const tile = page.getByRole('link', { name: /Missed a workout/ });
  await expect(tile).toHaveAttribute('href', /^#missed/);
  expect(Number((await tile.innerText()).match(/\d+/g)?.at(-1))).toBeGreaterThanOrEqual(1);
});

test('one missed workout this week is listed with its day; a workout today is not missed yet', async ({ page }) => {
  const last = `Once${unique()}`;
  const clientId = await newClient(last, 10);
  await plan(clientId, 'Legs', dayOffset(-1));
  await plan(clientId, 'Arms', dayOffset(0));
  await signInAsCoach(page);
  await page.goto('/home');
  const group = page.locator('#missed');
  await expandGroup(group);
  await expect(group.locator('li').filter({ hasText: last })).toContainText('Missed 1 · yesterday');
  await expect(page.locator('#missed-in-a-row li').filter({ hasText: last })).toHaveCount(0);
});

test('a client with nothing planned is under Nothing planned, with Open and Assign', async ({ page }) => {
  const last = `Empty${unique()}`;
  const clientId = await newClient(last, 29);
  await signInAsCoach(page);
  await page.goto('/home');
  const group = page.getByRole('region', { name: /^Nothing planned/ });
  await expandGroup(group);
  const row = group.locator('li').filter({ hasText: last });
  await expect(row).toContainText('Nothing in the next 7 days');
  await expect(row.getByRole('link', { name: /^Open / })).toHaveAttribute('href', `/clients/${clientId}`);
  await expect(row.getByRole('link', { name: /^Assign a program to / })).toHaveAttribute('href', `/clients/${clientId}/training?assign=1`);
});

test('a program ending in 3 days shows Ends in 3 days', async ({ page }) => {
  const last = `Ends${unique()}`;
  const clientId = await newClient(last);
  const a = await admin.from('program_assignments').insert({ workspace_id: workspaceId, client_id: clientId, program_name: `Ending ${unique()}`, weeks: 1, start_date: dayOffset(-3) }).select('id').single();
  if (a.error) throw a.error;
  created.assignments.push(a.data.id);
  await signInAsCoach(page);
  await page.goto('/home');
  const group = page.getByRole('region', { name: /^Program ending soon/ });
  await expandGroup(group);
  await expect(group.locator('li').filter({ hasText: last })).toContainText('Ends in 3 days');
  // Ending replaces Nothing planned, so the client is listed once.
  await expect(page.getByRole('region', { name: /^Nothing planned/ }).locator('li').filter({ hasText: last })).toHaveCount(0);
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

test('the coming-soon part is visible, Message is not offered yet, and the console has no hydration errors', async ({ page }) => {
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
  // Messages are not built yet, so there is no Message action at all (not even a disabled one).
  await expect(page.getByRole('complementary', { name: 'Needs attention' }).getByText('Message')).toHaveCount(0);
  expect(messages.filter((t) => /hydrat|#418|#423|#425/i.test(t))).toEqual([]);
});

test('New PRs this week counts this week\'s personal records of current clients and links to Activity', async ({ page }) => {
  const prTile = page.getByRole('link', { name: /^New PRs this week/ });
  const read = async () => Number((await prTile.getByText(/^\d+$/).textContent()) ?? '0');
  await signInAsCoach(page);
  await page.goto('/home');
  await expect(prTile).toHaveAttribute('href', '/activity');
  const before = await read();

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
  await prTile.click();
  await expect(page).toHaveURL(/\/activity$/);
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
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));
});

test('Cmd/Ctrl+K focuses the search box', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/home');
  const box = page.getByRole('combobox', { name: 'Find a client' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+K');
  await expect(box).toBeFocused();
});

test('Assign on an ending program opens the assign dialog, and a reload does not reopen it', async ({ page }) => {
  const last = `Assn${unique()}`;
  const clientId = await newClient(last);
  const a = await admin.from('program_assignments').insert({ workspace_id: workspaceId, client_id: clientId, program_name: `Ending ${unique()}`, weeks: 1, start_date: dayOffset(-3) }).select('id').single();
  if (a.error) throw a.error;
  created.assignments.push(a.data.id);
  await signInAsCoach(page);
  await page.goto('/home');
  const group = page.getByRole('region', { name: /^Program ending soon/ });
  await expandGroup(group);
  await group.locator('li').filter({ hasText: last }).getByRole('link', { name: /^Assign/ }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}`));
  await expect(page.getByRole('dialog', { name: 'Assign a program' })).toBeVisible();
  await expect(page).not.toHaveURL(/assign=1/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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

test('?assign=1 on a removed client\'s page opens no dialog', async ({ page }) => {
  const last = `Removed${unique()}`;
  const pastId = await newClient(last);
  const past = await admin.from('past_clients').insert({ workspace_id: workspaceId, user_id: pastId, email: `past-${unique()}@example.com`, first_name: 'Home', last_name: last });
  if (past.error) throw past.error;
  const gone = await admin.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', pastId);
  if (gone.error) throw gone.error;
  await signInAsCoach(page);
  await page.goto(`/clients/${pastId}?assign=1`);
  await expect(page.getByText(/^Past client · removed /)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
