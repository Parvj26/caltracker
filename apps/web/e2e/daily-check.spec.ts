import { expect, test, type Page } from '@playwright/test';
import { seedLog, serviceClient } from './helpers';

// The coach's daily check: Home's Needs attention (a reason and actions on every row) and the Clients list (status,
// last workout, this week, program; search, filter, sort). Each test gets its own coach and workspace, so the groups
// and counts are exact and nothing else running alongside can change them. Dates are the machine's local dates, which
// is what the browser uses too.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const MS_DAY = 86_400_000;
const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const dayOffset = (n: number) => isoDay(new Date(Date.now() + n * MS_DAY));
const PASSWORD = 'coach-password-123';

type Coach = { email: string; workspaceId: string; userIds: string[] };
const coaches: Coach[] = [];

test.afterAll(async () => {
  for (const c of coaches) {
    await admin.from('workout_logs').delete().eq('workspace_id', c.workspaceId);
    await admin.from('workouts').delete().eq('workspace_id', c.workspaceId);
    await admin.from('program_assignments').delete().eq('workspace_id', c.workspaceId);
    await admin.from('client_invites').delete().eq('workspace_id', c.workspaceId);
    await admin.from('workspace_members').delete().eq('workspace_id', c.workspaceId);
    await admin.from('workspaces').delete().eq('id', c.workspaceId);
    for (const id of c.userIds) await admin.auth.admin.deleteUser(id);
  }
});

async function newUser(email: string, firstName: string, lastName: string): Promise<string> {
  const u = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName } });
  if (u.error) throw u.error;
  return u.data.user.id;
}

async function newCoach(): Promise<Coach> {
  const email = `daily-coach-${unique()}@example.com`;
  const coachId = await newUser(email, 'Daisy', 'Coach');
  const ws = await admin.from('workspaces').insert({ name: `Daily Check ${unique()}` }).select('id').single();
  if (ws.error) throw ws.error;
  const m = await admin.from('workspace_members').insert({ workspace_id: ws.data.id, user_id: coachId, role: 'owner' });
  if (m.error) throw m.error;
  const coach = { email, workspaceId: ws.data.id, userIds: [coachId] };
  coaches.push(coach);
  return coach;
}

// Joined 20 days ago by default: under 30, so "Body scans 30+ days" (covered in body-scans.spec) stays out of these groups.
async function addClient(coach: Coach, firstName: string, lastName: string, joinedDaysAgo = 20): Promise<string> {
  const id = await newUser(`daily-${unique()}@example.com`, firstName, lastName);
  coach.userIds.push(id);
  const m = await admin.from('workspace_members').insert({
    workspace_id: coach.workspaceId,
    user_id: id,
    role: 'client',
    created_at: new Date(Date.now() - joinedDaysAgo * MS_DAY).toISOString(),
  });
  if (m.error) throw m.error;
  return id;
}

async function plan(coach: Coach, clientId: string, daysFromToday: number, name = 'Session'): Promise<string> {
  const r = await admin.from('workouts').insert({ workspace_id: coach.workspaceId, client_id: clientId, scheduled_on: dayOffset(daysFromToday), name }).select('id').single();
  if (r.error) throw r.error;
  return r.data.id;
}

async function finish(coach: Coach, clientId: string, workoutId: string | null, daysAgo: number, status: 'completed' | 'discarded' | 'in_progress' = 'completed') {
  const at = new Date(Date.now() - daysAgo * MS_DAY);
  return seedLog(admin, {
    workspaceId: coach.workspaceId,
    clientId,
    name: 'Session',
    plannedWorkoutId: workoutId,
    status,
    startedAt: new Date(at.getTime() - 3_600_000).toISOString(),
    finishedAt: status === 'in_progress' ? null : at.toISOString(),
  });
}

async function assign(coach: Coach, clientId: string, programName: string, startDaysFromToday: number, weeks: number) {
  const a = await admin.from('program_assignments').insert({ workspace_id: coach.workspaceId, client_id: clientId, program_name: programName, weeks, start_date: dayOffset(startDaysFromToday) });
  if (a.error) throw a.error;
}

/** A pending invite (straight into the table: these tests never send email). */
async function invite(coach: Coach) {
  const r = await admin.from('client_invites').insert({
    workspace_id: coach.workspaceId,
    created_by: coach.userIds[0]!,
    email: `invited-${unique()}@example.com`,
    first_name: 'Ivy',
    last_name: 'Invited',
    token_hash: `test-${unique()}`,
  });
  if (r.error) throw r.error;
}

async function signIn(page: Page, coach: Coach) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(coach.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/**
 * Five clients, one per situation:
 * - Rowan Run missed the last 2 (yesterday and the day before).
 * - Olive Once missed 1 two days ago, did yesterday's, and has tomorrow planned.
 * - Enid Ending's program ends in 3 days.
 * - Nell Nothing has no plan at all.
 * - Quinn Quiet has tomorrow planned and missed nothing, but last trained 8 days ago.
 * - Sami Steady did yesterday's, has tomorrow planned, and set personal bests today.
 */
async function seedFive(coach: Coach) {
  const run = await addClient(coach, 'Rowan', 'Run');
  await plan(coach, run, -2);
  await plan(coach, run, -1);
  await plan(coach, run, 1);

  const once = await addClient(coach, 'Olive', 'Once');
  const missed = await plan(coach, once, -2);
  await finish(coach, once, missed, 2, 'discarded'); // a discarded log is not "done"
  await finish(coach, once, await plan(coach, once, -1), 1);
  await plan(coach, once, 1);

  const ending = await addClient(coach, 'Enid', 'Ending');
  await assign(coach, ending, 'Strength Block', -3, 1);
  await plan(coach, ending, 1);
  await finish(coach, ending, null, 1);

  const quiet = await addClient(coach, 'Quinn', 'Quiet');
  await finish(coach, quiet, null, 8);
  await plan(coach, quiet, 1);

  const nothing = await addClient(coach, 'Nell', 'Nothing', 2);

  const steady = await addClient(coach, 'Sami', 'Steady');
  await finish(coach, steady, await plan(coach, steady, -1), 1);
  await plan(coach, steady, 0); // today, not done yet: not missed
  await plan(coach, steady, 2);
  await assign(coach, steady, 'Hypertrophy 8', -14, 8);
  const today = await finish(coach, steady, null, 0);
  const squat = await admin.from('exercises').select('id').eq('name', 'Barbell Squat').is('workspace_id', null).limit(1).single();
  if (squat.error) throw squat.error;
  const now = new Date().toISOString();
  const award = await admin.from('awards').insert({
    log_id: today,
    client_id: steady,
    workspace_id: coach.workspaceId,
    result: { ladder: null, drop: null, rare: [], landmarks: [], milestone: null, prs: [{ exerciseId: squat.data.id, kind: 'heaviest', valueKg: 100, reps: 5, logId: today, achievedAt: now }] },
  });
  if (award.error) throw award.error;
  return { run, once, ending, nothing, quiet, steady };
}

test('a coach with only on-track clients sees "Everyone\'s on track"', async ({ page }) => {
  const coach = await newCoach();
  const c = await addClient(coach, 'Tess', 'Track');
  await finish(coach, c, await plan(coach, c, -1), 1);
  await plan(coach, c, 1);
  await signIn(page, coach);
  const attention = page.getByRole('complementary', { name: 'Needs attention' });
  await expect(attention.getByText("Everyone's on track.")).toBeVisible();
  await expect(attention.getByRole('heading', { level: 3 })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: /^Message/ })).toHaveCount(0);
});

test('Home groups every client under its reason, with counts, a reason line and actions', async ({ page }) => {
  const coach = await newCoach();
  const ids = await seedFive(coach);
  await signIn(page, coach);
  const attention = page.getByRole('complementary', { name: 'Needs attention' });
  await expect(attention.getByText("Everyone's on track.")).toHaveCount(0);

  // Groups appear in a fixed order, each heading with its count.
  await expect(attention.getByRole('heading', { level: 3 })).toHaveText([
    'Missed 2+ in a row (1)',
    'Missed a workout (last 7 days) (1)',
    'Program ending soon (1)',
    'Nothing planned (1)',
    'No workout in 5+ days (1)',
    'New personal bests this week (1)',
  ]);

  const row = (group: string, name: string) => attention.getByRole('region', { name: new RegExp(`^${group.replace(/[()+]/g, '\\$&')}`) }).locator('li').filter({ hasText: name });

  const run = row('Missed 2+ in a row', 'Rowan Run');
  await expect(run).toContainText('Missed 2 in a row · latest yesterday');
  await expect(run.getByRole('link', { name: 'Open Rowan Run' })).toHaveAttribute('href', `/clients/${ids.run}`);
  // Every row has Assign, which opens the client's Training calendar.
  await expect(run.getByRole('link', { name: 'Assign to Rowan Run' })).toHaveAttribute('href', `/clients/${ids.run}/training`);

  await expect(row('Missed a workout', 'Olive Once')).toContainText(/Missed 1 · \w{3} \d{1,2} \w{3}/);

  const ending = row('Program ending soon', 'Enid Ending');
  await expect(ending).toContainText(/Ends in 3 days · \w{3} \d{1,2} \w{3}/);
  await expect(ending.getByRole('link', { name: 'Assign to Enid Ending' })).toHaveAttribute('href', `/clients/${ids.ending}/training`);

  const nothing = row('Nothing planned', 'Nell Nothing');
  await expect(nothing).toContainText('Nothing in the next 7 days');
  await expect(nothing.getByRole('link', { name: 'Assign to Nell Nothing' })).toHaveAttribute('href', `/clients/${ids.nothing}/training`);

  await expect(row('No workout in 5+ days', 'Quinn Quiet')).toContainText('No workout in 8 days');
  await expect(row('New personal bests', 'Sami Steady')).toContainText('1 lift improved');
  // Sami's workout today is not done yet, and that is not a miss.
  await expect(attention.getByText('Sami Steady')).toHaveCount(1);

  // The Missed tile counts both missed groups and jumps to the first one.
  const tile = page.getByRole('link', { name: /Missed a workout/ });
  await expect(tile).toHaveAttribute('href', '#missed-in-a-row');
  await expect(tile.getByText(/^\d+$/)).toHaveText('2');

  // Every row offers Message, which opens that client's conversation.
  await expect(run.getByRole('link', { name: 'Message Rowan Run' })).toHaveAttribute('href', `/messages/${ids.run}`);

  // It opens Training, and nothing pops up by itself.
  await nothing.getByRole('link', { name: 'Assign to Nell Nothing' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${ids.nothing}/training$`));
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

/** Days since Monday (0 on a Monday): how many of the last few days fall in this week. */
const sinceMonday = () => (new Date().getDay() + 6) % 7;
const longWeekday = (n: number) => new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(new Date(Date.now() + n * MS_DAY));

/** seedFive plus Tina Training, who is logging today's workout right now, and a pending invite. */
async function seedList(coach: Coach) {
  const ids = await seedFive(coach);
  const training = await addClient(coach, 'Tina', 'Training');
  await finish(coach, training, await plan(coach, training, 0), 0, 'in_progress');
  await invite(coach);
  // Misses this week: Rowan missed 2 and 1 days ago, Olive 2 days ago (only the days since Monday count).
  const rowanMissed = Math.min(2, sinceMonday());
  const oliveMissed = sinceMonday() >= 2 ? 1 : 0;
  return { ...ids, training, rowanMissed, oliveMissed };
}

test('the Clients list shows a status line, last workout, this week, 4 weeks and plan for each client, with no hydration errors', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(m.text()));
  // A production build reports hydration mismatches as minified React errors (#418, #423, #425) on pageerror.
  page.on('pageerror', (e) => messages.push(e.message));
  const coach = await newCoach();
  const ids = await seedList(coach);
  await signIn(page, coach);
  await page.goto('/clients');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clients 8');
  const table = page.getByRole('table', { name: 'Clients', exact: true });
  const rowOf = (name: string) => table.getByRole('row').filter({ hasText: name });
  const cell = (name: string, n: number) => rowOf(name).getByRole('cell').nth(n);

  // Client cell: name and a status line.
  await expect(cell('Tina Training', 0)).toContainText('● Training now');
  await expect(cell('Rowan Run', 0)).toContainText(ids.rowanMissed > 0 ? `Missed ${ids.rowanMissed} this week` : 'Active');
  await expect(cell('Olive Once', 0)).toContainText(ids.oliveMissed > 0 ? 'Missed 1 this week' : 'Active');
  await expect(cell('Enid Ending', 0)).toContainText(`Plan ends ${longWeekday(3)}`);
  await expect(cell('Nell Nothing', 0)).toContainText('Nothing planned');
  await expect(cell('Sami Steady', 0)).toContainText('Active');

  // Last workout, this week, 4 weeks.
  await expect(cell('Sami Steady', 1)).toContainText('Today · Session');
  await expect(cell('Olive Once', 1)).toContainText('Yesterday · Session');
  await expect(cell('Nell Nothing', 1)).toContainText('None yet');
  await expect(cell('Sami Steady', 2)).toContainText(/\d of \d/);
  await expect(cell('Rowan Run', 3)).toContainText('0%');
  await expect(cell('Olive Once', 3)).toContainText('50%');
  await expect(cell('Sami Steady', 3)).toContainText('100%');
  await expect(cell('Sami Steady', 3).getByText('(1 of 1 done)')).toBeAttached();

  // Plan: the program and its end; "nothing after" when it ends this week; quick adds when nothing is planned.
  await expect(cell('Sami Steady', 4)).toContainText('Hypertrophy 8');
  await expect(cell('Sami Steady', 4)).toContainText(/ends \d{1,2} \w{3}/);
  await expect(cell('Enid Ending', 4)).toContainText('Strength Block');
  await expect(cell('Enid Ending', 4)).toContainText('nothing after');
  await expect(cell('Nell Nothing', 4).getByRole('link', { name: 'Add a workout for Nell Nothing' })).toHaveAttribute(
    'href',
    `/clients/${ids.nothing}/training?add=workout`,
  );

  // The pending invite is a row too.
  const ivy = rowOf('Ivy Invited');
  await expect(ivy).toContainText('Invited today');
  await expect(ivy).toContainText('Not joined yet');

  await page.reload();
  await expect(cell('Sami Steady', 0)).toContainText('Active');
  expect(messages.filter((t) => /hydrat|#418|#423|#425/i.test(t))).toEqual([]);

  // Tapping a row opens the client: the name link covers the whole row, so a tap on the last-workout cell lands on
  // it (force: Playwright would otherwise wait because the link, not the cell, is on top, which is the point).
  await cell('Quinn Quiet', 1).click({ force: true });
  await expect(page).toHaveURL(new RegExp(`/clients/${ids.quiet}$`));
});

test('"+ Program" on a row with nothing planned opens the assign dialog on their Training page', async ({ page }) => {
  const coach = await newCoach();
  const nothing = await addClient(coach, 'Nell', 'Nothing', 2);
  await signIn(page, coach);
  await page.goto('/clients');
  await page.getByRole('link', { name: 'Assign a program to Nell Nothing' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${nothing}/training`));
  await expect(page.getByRole('dialog', { name: 'Assign a program' })).toBeVisible();
  // Once open, the address no longer asks for it, so a reload doesn't open it again.
  await expect(page).not.toHaveURL(/add=/);
});

test('Clients search filters as you type, chips filter, and sort reorders', async ({ page }) => {
  const coach = await newCoach();
  const ids = await seedList(coach);
  await signIn(page, coach);
  await page.goto('/clients');
  const table = page.getByRole('table', { name: 'Clients', exact: true });
  const names = () => table.locator('[data-client-id]').evaluateAll((rows) => rows.map((r) => r.querySelector('a')?.textContent ?? ''));
  const filters = page.getByRole('group', { name: 'Filter clients' });

  // The result line is always there (a live region), and says so when nothing is filtered.
  await expect(page.getByRole('status').filter({ hasText: 'Showing all 8' })).toBeAttached();

  // Only chips with someone in them, each with its count.
  const missed = (ids.rowanMissed > 0 ? 1 : 0) + (ids.oliveMissed > 0 ? 1 : 0);
  await expect(filters.getByRole('button')).toHaveText([
    'All 8',
    ...(missed > 0 ? [`Missed this week ${missed}`] : []),
    'Plan ending 1',
    'Nothing planned 1',
    'Invited 1',
  ]);

  // Default sort: most recent workout first, never-trained last (by name).
  await expect.poll(names).toEqual(['Sami Steady', 'Enid Ending', 'Olive Once', 'Quinn Quiet', 'Nell Nothing', 'Rowan Run', 'Tina Training']);

  // Search: part of a name, any case, as you type.
  const search = page.getByRole('searchbox', { name: 'Search clients' });
  await search.pressSequentially('ste');
  await expect.poll(names).toEqual(['Sami Steady']);
  await expect(page.getByRole('status').filter({ hasText: 'Showing 1 of 8' })).toBeAttached();
  await search.fill('zzz');
  await expect(table.getByText('No clients match.')).toBeVisible();
  await search.fill('');

  // Chips are real toggle buttons.
  const chip = (name: RegExp) => filters.getByRole('button', { name });
  await chip(/^Plan ending/).click();
  await expect(chip(/^Plan ending/)).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(names).toEqual(['Enid Ending']);
  await expect(table.getByRole('row').filter({ hasText: 'Ivy Invited' })).toHaveCount(0);
  await chip(/^Nothing planned/).click();
  await expect.poll(names).toEqual(['Nell Nothing']);
  if (missed > 0) {
    await chip(/^Missed this week/).click();
    await expect.poll(async () => (await names()).length).toBe(missed);
  }
  await chip(/^Invited/).click();
  await expect.poll(names).toEqual([]);
  await expect(table.getByRole('row').filter({ hasText: 'Ivy Invited' })).toBeVisible();
  await chip(/^All/).click();
  await expect(page.getByRole('status').filter({ hasText: 'Showing all 8' })).toBeAttached();

  // Sort: by name; lowest 4-week completion first (nothing due last); soonest plan end first (none last).
  const sort = page.getByLabel('Sort:');
  await sort.selectOption('name');
  await expect.poll(names).toEqual(['Enid Ending', 'Nell Nothing', 'Olive Once', 'Quinn Quiet', 'Rowan Run', 'Sami Steady', 'Tina Training']);
  await sort.selectOption('completion');
  await expect.poll(async () => (await names()).slice(0, 3)).toEqual(['Rowan Run', 'Olive Once', 'Sami Steady']);
  await sort.selectOption('plan_end');
  await expect.poll(async () => (await names()).slice(0, 2)).toEqual(['Enid Ending', 'Sami Steady']);
});

test('on iPad portrait the Clients list turns into stacked cards with labelled values and no sideways scroll', async ({ page }, testInfo) => {
  const coach = await newCoach();
  await seedList(coach);
  await page.setViewportSize({ width: 820, height: 1180 });
  await signIn(page, coach);
  await page.goto('/clients');
  const row = page.getByRole('table', { name: 'Clients', exact: true }).getByRole('row').filter({ hasText: 'Sami Steady' });
  await expect(row.getByText('Last workout', { exact: true })).toBeVisible();
  await expect(row.getByText('4 weeks', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Last workout' })).toBeHidden();
  const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(width).toBeLessThanOrEqual(0);
  // Kept in the CI report, so a reviewer can see both layouts without running the app.
  await testInfo.attach('clients-820', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  // Laptop / iPad landscape: a table with column headers, still no sideways scroll.
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect(page.getByRole('columnheader', { name: 'Last workout' })).toBeVisible();
  await expect(row.getByText('Last workout', { exact: true })).toBeHidden();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide).toBeLessThanOrEqual(0);
  await testInfo.attach('clients-1194', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  // The invite window with a program picked, and the single-workout picker.
  await page.getByRole('button', { name: '+ Invite client' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a client' });
  await dialog.getByLabel('First name').fill('Sam');
  await dialog.getByRole('button', { name: 'Single workout', exact: true }).click();
  await testInfo.attach('invite-1194', { body: await page.screenshot(), contentType: 'image/png' });
});
