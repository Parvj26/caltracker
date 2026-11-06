import { expect, test } from '@playwright/test';
import { weekKey } from '@caltracker/shared';
import { seedLog, serviceClient, signInAsCoach } from './helpers';

// The coach's side of stickers: a client's streak, zoo book and personal bests, and the PR chip (Task 7 of the
// stickers plan). Each test makes its own client in the demo workspace and seeds the award tables with the service
// role (the phone's award-workout call does that in real life). The recompute test needs `supabase functions serve`.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { logs: string[]; users: string[] } = { logs: [], users: [] };
let workspaceId: string;
let squatId: string;

test.beforeAll(async () => {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
  const ex = await admin.from('exercises').select('id').eq('name', 'Barbell Squat').limit(1).single();
  if (ex.error) throw ex.error;
  squatId = ex.data.id;
});

test.afterAll(async () => {
  // Awards, records, stats and stickers go with the log and the user (cascade).
  if (created.logs.length) await admin.from('workout_logs').delete().in('id', created.logs);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/**
 * A new client with a finished squat log, a PR award for it, a 3-week streak (still running: its last week is this
 * one, in the client's default UTC zone), two stickers and a squat best.
 */
async function seedClient(lastName: string) {
  const u = await admin.auth.admin.createUser({
    email: `stk-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: 'Sticker', last_name: lastName },
  });
  if (u.error) throw u.error;
  const clientId = u.data.user.id;
  created.users.push(clientId);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: clientId, role: 'client' });
  if (m.error) throw m.error;

  const logId = await seedLog(admin, { workspaceId, clientId, name: `Stk ${unique()}`, startedAt: ago(100), finishedAt: ago(60) });
  created.logs.push(logId);

  const pr = { exerciseId: squatId, kind: 'heaviest', valueKg: 100, reps: 5, logId, achievedAt: ago(60) };
  const steps = [
    admin.from('awards').insert({ log_id: logId, client_id: clientId, workspace_id: workspaceId, result: { ladder: null, drop: null, rare: [], landmarks: [], milestone: null, prs: [pr] } }),
    admin.from('client_stats').insert({ client_id: clientId, workspace_id: workspaceId, workouts: 12, streak: 3, streak_week: weekKey(new Date().toISOString(), 'UTC'), best_streak: 3, journey_week: 3, pr_count: 1 }),
    admin.from('sticker_awards').insert([
      { client_id: clientId, workspace_id: workspaceId, sticker_key: 'axolotl', first_log_id: logId, shiny: false, last_earned_at: ago(60) },
      { client_id: clientId, workspace_id: workspaceId, sticker_key: 'bison', first_log_id: logId, shiny: true, last_earned_at: ago(90) },
    ]),
    admin.from('personal_records').insert([
      { client_id: clientId, workspace_id: workspaceId, exercise_id: squatId, kind: 'heaviest', value_kg: 100, reps: 5, log_id: logId, achieved_at: ago(60) },
      { client_id: clientId, workspace_id: workspaceId, exercise_id: squatId, kind: 'e1rm', value_kg: 116.7, reps: 5, log_id: logId, achieved_at: ago(60) },
    ]),
  ];
  for (const r of await Promise.all(steps)) if (r.error) throw r.error;
  return { clientId, logId };
}

test('the client page shows the streak, the zoo book and the personal bests', async ({ page }) => {
  const { clientId } = await seedClient(`Page${unique()}`);
  await signInAsCoach(page);
  await page.goto(`/clients/${clientId}`);

  await expect(page.getByText('3-week streak')).toBeVisible();
  await expect(page.getByText('Zoo book: 2 of 60 stickers')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Latest stickers' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('img', { name: 'Axolotl' })).toBeVisible();

  const squat = page.getByRole('table', { name: 'Personal bests' }).getByRole('row').filter({ hasText: 'Barbell Squat' });
  await expect(squat).toContainText(/100 kg × 5|220 lb × 5/);
  await expect(squat).toContainText(/116\.7 kg|257 lb/);
});

test('a client with nothing yet shows an empty streak and no bests', async ({ page }) => {
  const u = await admin.auth.admin.createUser({ email: `stk-${unique()}@example.com`, password: 'client-password-123', email_confirm: true, user_metadata: { first_name: 'Fresh', last_name: 'Start' } });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  await signInAsCoach(page);
  await page.goto(`/clients/${u.data.user.id}`);
  await expect(page.getByText('No streak yet')).toBeVisible();
  await expect(page.getByText('No personal bests yet.')).toBeVisible();
});

test('a log that set a personal best shows a PR chip in activity and on the log page', async ({ page }) => {
  const { clientId, logId } = await seedClient(`Chip${unique()}`);
  await signInAsCoach(page);
  await page.goto(`/activity?client=${clientId}`);
  const row = page.getByRole('row').filter({ has: page.locator(`a[href$="/logs/${logId}"]`) });
  await expect(row.getByText('PR', { exact: true })).toBeVisible();

  await page.goto(`/clients/${clientId}/logs/${logId}`);
  await expect(page.getByText('PR', { exact: true })).toBeVisible();
});

test('a log with no personal best has no PR chip', async ({ page }) => {
  const { clientId, logId } = await seedClient(`NoChip${unique()}`);
  const cleared = await admin.from('awards').update({ result: { ladder: null, drop: null, rare: [], landmarks: [], milestone: null, prs: [] } }).eq('log_id', logId);
  if (cleared.error) throw cleared.error;
  await signInAsCoach(page);
  await page.goto(`/activity?client=${clientId}`);
  await expect(page.getByRole('link', { name: /^Stk / })).toBeVisible();
  await expect(page.getByText('PR', { exact: true })).toHaveCount(0);
});

test('a correction through the log page recomputes the client stats', async ({ page }) => {
  // The seeded stats claim a 3-week streak, but the client's only log is this week's. The recompute after the
  // correction works the stats out again from the logs, so the streak drops to 1.
  const { clientId, logId } = await seedClient(`Fix${unique()}`);
  await signInAsCoach(page);
  await page.goto(`/clients/${clientId}`);
  await expect(page.getByText('3-week streak')).toBeVisible();

  await page.goto(`/clients/${clientId}/logs/${logId}`);
  await page.getByRole('button', { name: 'Correct' }).click();
  await page.getByLabel('Set 1 reps').fill('6');
  await page.getByRole('button', { name: 'Save corrections' }).click();
  await expect(page.getByText('Edited by coach')).toBeVisible();

  await expect.poll(async () => (await admin.from('client_stats').select('streak, workouts').eq('client_id', clientId).single()).data).toEqual({ streak: 1, workouts: 1 });
  await page.goto(`/clients/${clientId}`);
  await expect(page.getByText('1-week streak')).toBeVisible();
});

test('the client page charts an exercise\'s estimated max over time, with a keyboard-reachable point readout', async ({ page }) => {
  // Three squat workouts, 80 / 90 / 100 kg for 5 reps, a week apart: three points rising.
  const u = await admin.auth.admin.createUser({ email: `stk-${unique()}@example.com`, password: 'client-password-123', email_confirm: true, user_metadata: { first_name: 'Chart', last_name: `Lifter${unique()}` } });
  if (u.error) throw u.error;
  const clientId = u.data.user.id;
  created.users.push(clientId);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: clientId, role: 'client' });
  if (m.error) throw m.error;
  for (const [daysAgo, weightKg] of [[14, 80], [7, 90], [0, 100]] as const) {
    const finished = new Date(Date.now() - daysAgo * 86_400_000 - 60_000).toISOString();
    created.logs.push(await seedLog(admin, { workspaceId, clientId, name: `Chart ${unique()}`, startedAt: new Date(Date.now() - daysAgo * 86_400_000 - 3_600_000).toISOString(), finishedAt: finished, weightKg, reps: 5 }));
  }

  await signInAsCoach(page);
  await page.goto(`/clients/${clientId}`);
  await page.getByLabel('Exercise', { exact: true }).selectOption({ label: 'Barbell Squat' });
  await expect(page.getByTestId('chart-point')).toHaveCount(3);
  // The newest workout (100 kg x 5, est. 116.7 kg) is the point read out first.
  await expect(page.getByTestId('chart-readout')).toContainText(/116\.7 kg|257 lb/);
  await expect(page.getByText(/Barbell Squat: 3 workouts/)).toBeVisible();

  // One tab stop: focus the chart and step back with the arrow keys.
  await page.getByTestId('line-chart').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('chart-readout')).toContainText(/105 kg|231 lb/); // 90 x 5
  await page.keyboard.press('Home');
  await expect(page.getByTestId('chart-readout')).toContainText(/93\.3 kg|206 lb/);
});

test('a client with no logged lifts shows no chart', async ({ page }) => {
  const u = await admin.auth.admin.createUser({ email: `stk-${unique()}@example.com`, password: 'client-password-123', email_confirm: true, user_metadata: { first_name: 'No', last_name: 'Lifts' } });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  await signInAsCoach(page);
  await page.goto(`/clients/${u.data.user.id}`);
  await expect(page.getByText('No lifts to chart yet.')).toBeVisible();
});
