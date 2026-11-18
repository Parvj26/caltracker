import { expect, test, type Page } from '@playwright/test';
import { COACH_EMAIL, seedSectionedWorkout, serviceClient, signInAsCoach, signInThroughForm, signOutFromProfile } from './helpers';

// Leaving a live session never loses what was typed, and Back after Finish / Discard / Hand back never shows the
// session as still live. Each test makes its own client (one workout in progress per client) and removes it after,
// so Finish never grants awards on the shared demo data.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { workouts: string[]; users: string[] } = { workouts: [], users: [] };
let workspaceId: string;

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  if (!data.users.some((u) => u.email === COACH_EMAIL)) throw new Error('Demo coach not found; run pnpm db:reset.');
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
});

test.afterAll(async () => {
  if (created.workouts.length) {
    const logs = await admin.from('workout_logs').select('id').in('workout_id', created.workouts);
    const ids = (logs.data ?? []).map((l) => l.id);
    if (ids.length) await admin.from('workout_logs').delete().in('id', ids);
    await admin.from('workouts').delete().in('id', created.workouts);
  }
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

const browserToday = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));

async function newClient(firstName: string): Promise<string> {
  const u = await admin.auth.admin.createUser({
    email: `navb-${firstName.toLowerCase()}-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: `Navb${unique()}` },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  return u.data.user.id;
}

/** A client with today's one-exercise workout, and the coach on its live session (started), reached from Training. */
async function startedSession(page: Page, firstName: string, signIn: (p: Page) => Promise<void> = signInAsCoach) {
  await signIn(page);
  const client = await newClient(firstName);
  const today = await browserToday(page);
  const name = `Navb ${unique()}`;
  const workoutId = await seedSectionedWorkout(admin, { workspaceId, clientId: client, name, scheduledOn: today, sections: [], blocks: [{ exercises: ['Barbell Squat'] }] });
  created.workouts.push(workoutId);
  await page.goto(`/clients/${client}/training?view=week&from=${today}`);
  await page.locator(`[data-date="${today}"]`).getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Log session' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client}/log/${workoutId}$`));
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect.poll(async () => (await admin.from('workout_logs').select('status').eq('workout_id', workoutId).maybeSingle()).data?.status).toBe('in_progress');
  const log = await admin.from('workout_logs').select('id').eq('workout_id', workoutId).single();
  if (log.error) throw log.error;
  return { client, workoutId, logId: log.data.id, name, today };
}

const firstWeight = async (logId: string) =>
  (await admin.from('log_sets').select('actual_weight_kg, position').eq('log_id', logId).order('position').limit(1).single()).data?.actual_weight_kg;

for (const size of [
  { name: 'iPhone', viewport: { width: 390, height: 844 }, isMobile: true },
  { name: 'iPad portrait', viewport: { width: 820, height: 1180 }, isMobile: false },
  { name: 'iPad landscape', viewport: { width: 1180, height: 820 }, isMobile: false },
]) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: true, isMobile: size.isMobile });

    test('a weight typed just before swiping back is saved', async ({ page }) => {
      const s = await startedSession(page, 'Swipe');
      await page.getByLabel('KG, Barbell Squat Set 1 of 2').fill('47');
      // Straight back, well inside the save's short wait.
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/clients/${s.client}/training`));
      // Saved: the database has it, and the session opened again (a reload) shows it.
      await expect.poll(() => firstWeight(s.logId), { timeout: 10_000 }).toBe(47);
      await page.goto(`/clients/${s.client}/log/${s.workoutId}`);
      await expect(page.getByLabel('KG, Barbell Squat Set 1 of 2')).toHaveValue('47');
    });

    test('a weight whose save is lost as the page closes is kept on the device and sent next time', async ({ page }) => {
      const s = await startedSession(page, 'Lost');
      await page.getByLabel('KG, Barbell Squat Set 1 of 2').fill('52');
      // The save sent while leaving never arrives (the network dropped, the app was put away).
      await page.route('**/*', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/clients/${s.client}/training`));
      expect(await firstWeight(s.logId)).toBeNull();
      await page.unroute('**/*');
      // Opening the session again (a full reload) brings the typed weight back and saves it.
      await page.goto(`/clients/${s.client}/log/${s.workoutId}`);
      await expect(page.getByLabel('KG, Barbell Squat Set 1 of 2')).toHaveValue('52');
      await expect.poll(() => firstWeight(s.logId), { timeout: 10_000 }).toBe(52);
      await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    });

    test('Back after Discard never shows the session as live', async ({ page }) => {
      const s = await startedSession(page, 'Discard');
      await page.getByRole('button', { name: 'Cancel session…' }).click();
      await page.getByRole('button', { name: 'Discard session' }).click();
      // Back on the calendar it was opened from, same week and view.
      await expect(page).toHaveURL(new RegExp(`/clients/${s.client}/training\\?view=week&from=${s.today}$`));
      // The address changes the moment Back starts, but the calendar can take a moment to load (slow CI). Going
      // Forward before it is on screen only returns to the session page that never left, which is not what this checks.
      await expect(page.locator(`[data-date="${s.today}"]`).getByRole('button', { name: `Options for ${s.name}`, exact: true })).toBeVisible();
      await expect.poll(async () => (await admin.from('workout_logs').select('status').eq('id', s.logId).single()).data?.status).toBe('discarded');
      // Forward to the session page again (from the browser's memory): it is not live any more.
      await page.goForward();
      await expect(page).toHaveURL(new RegExp(`/clients/${s.client}/log/${s.workoutId}$`));
      await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Finish session' })).toHaveCount(0);
    });

    test('Back after Finish goes to the calendar, not to a live session', async ({ page }) => {
      const s = await startedSession(page, 'Finish');
      await page.getByRole('button', { name: 'Done: Barbell Squat Set 1 of 2' }).click();
      await page.getByRole('button', { name: 'Finish session' }).click();
      await page.getByRole('button', { name: 'Finish anyway' }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${s.client}/logs/${s.logId}(\\?award=1)?$`));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/clients/${s.client}/training`));
      await expect(page.getByRole('button', { name: 'Finish session' })).toHaveCount(0);
    });

    test('Back after Hand back goes to the calendar, not to the coach\'s logger', async ({ page }) => {
      const s = await startedSession(page, 'Handback');
      await page.getByRole('button', { name: 'Hand back to Handback' }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${s.client}/logs/${s.logId}$`));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/clients/${s.client}/training`));
      await expect(page.getByRole('button', { name: 'Finish session' })).toHaveCount(0);
    });
  });
}

const DRAFTS = 'caltracker:session-draft:';
const draftKeys = (page: Page) => page.evaluate((prefix) => Object.keys(localStorage).filter((k) => k.startsWith(prefix)), DRAFTS);
const firstSets = async (logId: string) =>
  (await admin.from('log_sets').select('actual_weight_kg, actual_reps, completed_at, position').eq('log_id', logId).order('position')).data ?? [];

test.describe('kept copies on the device', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test('two tabs: a lost save from one tab and newer sets saved from another are both kept', async ({ page, context }) => {
    const s = await startedSession(page, 'Twotabs');
    const url = `/clients/${s.client}/log/${s.workoutId}`;
    // Tab A types 47 kg on set 1, and its save never arrives.
    await page.getByLabel('KG, Barbell Squat Set 1 of 2').fill('47');
    await page.route('**/*', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    await page.goBack();
    await page.unroute('**/*');
    // Set A's kept copy aside while tab B works, so B saves without it (as when A's copy is written after B opened).
    const keptA = await page.evaluate((prefix) => {
      const out: [string, string][] = Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => [k, localStorage.getItem(k)!]);
      for (const [k] of out) localStorage.removeItem(k);
      return out;
    }, DRAFTS);
    expect(keptA).toHaveLength(1);
    // Tab B ticks set 2 with 12 reps; the server moves past the copy A grew from.
    const b = await context.newPage();
    await b.goto(url);
    await b.getByLabel('REPS, Barbell Squat Set 2 of 2').fill('12');
    await b.getByRole('button', { name: 'Done: Barbell Squat Set 2 of 2' }).click();
    await expect.poll(async () => (await firstSets(s.logId))[1]?.completed_at ?? null, { timeout: 10_000 }).not.toBeNull();
    await b.close();
    // A's copy is back; A opens the session again: A's weight is redone on top of B's sets, and nothing is lost.
    await page.evaluate((items) => items.forEach(([k, v]) => localStorage.setItem(k, v)), keptA);
    await page.goto(url);
    await expect(page.getByLabel('KG, Barbell Squat Set 1 of 2')).toHaveValue('47');
    await expect(page.getByRole('button', { name: 'Done: Barbell Squat Set 2 of 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => (await firstSets(s.logId)).map((r) => [r.actual_weight_kg, r.actual_reps, r.completed_at !== null]), { timeout: 10_000 })
      .toEqual([
        [47, null, false],
        [expect.anything(), 12, true],
      ]);
    // Saved, so no copy is left behind.
    await expect.poll(() => draftKeys(page)).toEqual([]);
  });

  test('another coach\'s and old copies are dropped on load; signing out removes every copy', async ({ page }) => {
    const s = await startedSession(page, 'Signout', (p) => signInThroughForm(p));
    const other = `${DRAFTS}${s.logId}:someone-else`;
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ v: 2, userId: 'another-coach', tabId: 'x', savedAt: Date.now(), base: {}, doc: {} })), other);
    await page.reload();
    await expect.poll(() => draftKeys(page)).not.toContain(other);
    // A copy kept mid-save, then sign out.
    await page.getByLabel('KG, Barbell Squat Set 1 of 2').fill('33');
    await page.route('**/*', (route) => (route.request().method() === 'POST' && !route.request().url().includes('/auth/sign-out') ? route.abort() : route.continue()));
    await page.goto(`/clients/${s.client}/training`);
    await page.unroute('**/*');
    expect(await draftKeys(page)).toHaveLength(1);
    await signOutFromProfile(page);
    await expect(page).toHaveURL(/\/sign-in/);
    expect(await draftKeys(page)).toEqual([]);
  });
});
