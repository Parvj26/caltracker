import { expect, test } from '@playwright/test';
import { seedLog, serviceClient, signInAsCoach } from './helpers';

// Every coach page names itself in the browser tab, and the coach layout starts with a "Skip to content" link.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { workouts: string[]; programs: string[]; logs: string[] } = { workouts: [], programs: [], logs: [] };
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
  if (created.programs.length) await admin.from('programs').delete().in('id', created.programs);
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
});

test('coach pages have specific tab titles', async ({ page }) => {
  // Many page loads in one test.
  test.slow();
  const workoutName = `Upper Body ${unique()}`;
  const programName = `Strength ${unique()}`;
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, name: workoutName }).select('id').single();
  if (w.error) throw w.error;
  created.workouts.push(w.data.id);
  const p = await admin.from('programs').insert({ workspace_id: workspaceId, name: programName, weeks: 1 }).select('id').single();
  if (p.error) throw p.error;
  created.programs.push(p.data.id);
  const logName = `Leg day ${unique()}`;
  const logId = await seedLog(admin, { workspaceId, clientId, name: logName, startedAt: new Date(Date.now() - 3_600_000).toISOString(), finishedAt: new Date().toISOString() });
  created.logs.push(logId);

  await signInAsCoach(page);
  const expected: [string, string][] = [
    ['/home', 'Home · CalTracker'],
    ['/clients', 'Clients · CalTracker'],
    [`/clients/${clientId}`, 'Demo Client · Clients · CalTracker'],
    [`/clients/${clientId}/logs/${logId}`, `${logName} · Demo Client · Clients · CalTracker`],
    ['/workouts', 'Workouts · CalTracker'],
    ['/workouts/new', 'New workout · Workouts · CalTracker'],
    [`/workouts/${w.data.id}`, `${workoutName} · Workouts · CalTracker`],
    ['/programs', 'Programs · CalTracker'],
    [`/programs/${p.data.id}`, `${programName} · Programs · CalTracker`],
    ['/exercises', 'Exercises · CalTracker'],
    ['/activity', 'Activity · CalTracker'],
    ['/community', 'Community · CalTracker'],
    ['/community/reports', 'Reports · Community · CalTracker'],
    ['/profile', 'Profile · CalTracker'],
    ['/messages', 'Messages · CalTracker'],
    ['/help', 'Help · CalTracker'],
  ];
  for (const [path, title] of expected) {
    await page.goto(path);
    await expect(page, path).toHaveTitle(title);
  }
  // A log opened under another client's URL is a 404 whose title doesn't name the log or either client.
  const other = await admin.auth.admin.createUser({ email: `title-${unique()}@example.com`, password: 'client-password-123', email_confirm: true, user_metadata: { first_name: 'Otto', last_name: 'Other' } });
  if (other.error) throw other.error;
  try {
    const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: other.data.user.id, role: 'client' });
    if (m.error) throw m.error;
    await page.goto(`/clients/${other.data.user.id}/logs/${logId}`);
    await expect(page).toHaveTitle(/not (be )?found/i);
    expect(await page.title()).not.toContain(logName);
  } finally {
    await admin.auth.admin.deleteUser(other.data.user.id);
  }

  // A workout the coach can't see is a 404 whose title names nothing.
  await page.goto('/workouts/00000000-0000-4000-8000-000000000999');
  await expect(page).toHaveTitle(/not (be )?found/i);
});

test('"Skip to content" is the first thing Tab reaches and moves focus to the page', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/home');
  await expect(page).toHaveTitle('Home · CalTracker');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  // The next Tab lands inside the page, not on the sidebar.
  await page.keyboard.press('Tab');
  const inMain = await page.evaluate(() => Boolean(document.activeElement?.closest('main')));
  expect(inMain).toBe(true);
});
