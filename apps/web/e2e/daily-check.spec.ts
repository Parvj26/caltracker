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
  await expect(run.getByRole('link', { name: /^Assign/ })).toHaveCount(0);

  await expect(row('Missed a workout', 'Olive Once')).toContainText(/Missed 1 · \w{3} \d{1,2} \w{3}/);

  const ending = row('Program ending soon', 'Enid Ending');
  await expect(ending).toContainText(/Ends in 3 days · \w{3} \d{1,2} \w{3}/);
  await expect(ending.getByRole('link', { name: 'Assign a program to Enid Ending' })).toHaveAttribute('href', `/clients/${ids.ending}/training?assign=1`);

  const nothing = row('Nothing planned', 'Nell Nothing');
  await expect(nothing).toContainText('Nothing in the next 7 days');
  await expect(nothing.getByRole('link', { name: 'Assign a program to Nell Nothing' })).toHaveAttribute('href', `/clients/${ids.nothing}/training?assign=1`);

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

  await nothing.getByRole('link', { name: 'Assign a program to Nell Nothing' }).click();
  await expect(page.getByRole('dialog', { name: 'Assign a program' })).toBeVisible();
});

test('the Clients list shows status, last workout, this week and program for each client, with no hydration errors', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(m.text()));
  // A production build reports hydration mismatches as minified React errors (#418, #423, #425) on pageerror.
  page.on('pageerror', (e) => messages.push(e.message));
  const coach = await newCoach();
  await seedFive(coach);
  await invite(coach);
  await signIn(page, coach);
  await page.goto('/clients');
  const table = page.getByRole('table', { name: 'Clients' });
  const rowOf = (name: string) => table.getByRole('row').filter({ hasText: name });

  await expect(rowOf('Rowan Run').getByRole('cell').nth(1)).toHaveText(/^Needs attention/);
  await expect(rowOf('Enid Ending').getByRole('cell').nth(1)).toHaveText(/^Program ending/);
  await expect(rowOf('Nell Nothing').getByRole('cell').nth(1)).toHaveText(/^Nothing planned/);
  const steady = rowOf('Sami Steady');
  await expect(steady.getByRole('cell').nth(1)).toHaveText(/^On track/);
  await expect(steady.getByRole('cell').nth(2)).toContainText('Today');
  await expect(steady.getByRole('cell').nth(3)).toContainText(/\d \/ \d/);
  await expect(steady.getByRole('cell').nth(4)).toContainText('Hypertrophy 8');
  await expect(steady.getByRole('cell').nth(4)).toContainText(/ends \d{1,2} \w{3}/);
  await expect(rowOf('Nell Nothing').getByRole('cell').nth(2)).toContainText('None yet');
  await expect(rowOf('Nell Nothing').getByRole('cell').nth(4)).toContainText('No program');
  await expect(page.getByRole('table', { name: 'Pending invites' }).getByRole('row').filter({ hasText: 'Ivy Invited' })).toContainText('Invited');
  // The week count reads as words to a screen reader.
  await expect(steady.getByRole('cell').nth(3).getByText(/^\d+ of \d+ done this week$/)).toBeAttached();
  await page.reload();
  await expect(rowOf('Sami Steady').getByRole('cell').nth(1)).toHaveText(/^On track/);
  expect(messages.filter((t) => /hydrat|#418|#423|#425/i.test(t))).toEqual([]);
});

test('Clients search filters as you type, status chips filter, and sort reorders', async ({ page }) => {
  const coach = await newCoach();
  await seedFive(coach);
  await invite(coach);
  await signIn(page, coach);
  await page.goto('/clients');
  const table = page.getByRole('table', { name: 'Clients' });
  const names = () => table.locator('[data-client-id] a').allTextContents();
  const filters = page.getByRole('group', { name: 'Filter by status' });

  // The result line is always there (a live region), and says so when nothing is filtered.
  await expect(page.getByRole('status').filter({ hasText: 'Showing all 7' })).toBeVisible();

  // Default sort is by last name.
  await expect.poll(names).toEqual(['Enid Ending', 'Nell Nothing', 'Olive Once', 'Quinn Quiet', 'Rowan Run', 'Sami Steady']);

  // Search: part of a name, any case, as you type.
  const search = page.getByRole('searchbox', { name: 'Search clients' });
  await search.pressSequentially('ste');
  await expect.poll(names).toEqual(['Sami Steady']);
  await expect(page.getByRole('status').filter({ hasText: 'Showing 1 of 7' })).toBeVisible();
  await search.fill('zzz');
  await expect(table.getByText('No clients match.')).toBeVisible();
  await search.fill('');

  // Filter chips carry counts and filter the list.
  await expect(filters.getByRole('button', { name: /^Needs attention 3$/ })).toBeVisible();
  await filters.getByRole('button', { name: /^Needs attention/ }).click();
  await expect(filters.getByRole('button', { name: /^Needs attention/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(names).toEqual(['Olive Once', 'Quinn Quiet', 'Rowan Run']);
  await expect(page.getByRole('table', { name: 'Pending invites' })).toHaveCount(0);
  await filters.getByRole('button', { name: /^Nothing planned/ }).click();
  await expect.poll(names).toEqual(['Nell Nothing']);
  await filters.getByRole('button', { name: /^Invited/ }).click();
  await expect(table).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Pending invites' }).getByRole('row').filter({ hasText: 'Ivy Invited' })).toBeVisible();
  await filters.getByRole('button', { name: /^All/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Showing all 7' })).toBeVisible();

  // Sort by last workout (most recent first, never-trained last) and by program end (soonest first, none last).
  await page.getByLabel('Sort by').selectOption('last_workout');
  await expect.poll(names).toEqual(['Sami Steady', 'Enid Ending', 'Olive Once', 'Quinn Quiet', 'Nell Nothing', 'Rowan Run']);
  await page.getByLabel('Sort by').selectOption('end_date');
  await expect.poll(async () => (await names()).slice(0, 2)).toEqual(['Enid Ending', 'Sami Steady']);
});

test('below 900 px the Clients list turns into stacked cards with labelled values', async ({ page }) => {
  const coach = await newCoach();
  await seedFive(coach);
  await page.setViewportSize({ width: 820, height: 1180 });
  await signIn(page, coach);
  await page.goto('/clients');
  const row = page.getByRole('table', { name: 'Clients' }).getByRole('row').filter({ hasText: 'Sami Steady' });
  await expect(row.getByText('Last workout:')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(width).toBeLessThanOrEqual(0);
});
