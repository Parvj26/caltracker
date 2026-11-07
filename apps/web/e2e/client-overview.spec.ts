import { expect, test, type Page } from '@playwright/test';
import { seedLog, serviceClient } from './helpers';

// The client page's tabs and Overview: Training counts, Highlights, Body metrics, Updates, Profile, and the coach's
// goal, limitations and notes; plus the Documents tab. Each test gets its own coach, workspace and client, so the
// numbers are exact. Dates are the machine's local dates, which is what the browser uses too.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const MS_DAY = 86_400_000;
const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const dayOffset = (n: number) => isoDay(new Date(Date.now() + n * MS_DAY));
const PASSWORD = 'coach-password-123';

type Setup = { coachEmail: string; workspaceId: string; coachId: string; clientId: string; userIds: string[] };
const made: Setup[] = [];

test.afterAll(async () => {
  for (const s of made) {
    const docs = await admin.from('client_documents').select('storage_path').eq('workspace_id', s.workspaceId);
    if (docs.data?.length) await admin.storage.from('client-documents').remove(docs.data.map((d) => d.storage_path));
    await admin.from('workout_logs').delete().eq('workspace_id', s.workspaceId);
    await admin.from('workouts').delete().eq('workspace_id', s.workspaceId);
    await admin.from('workspaces').delete().eq('id', s.workspaceId);
    for (const id of s.userIds) await admin.auth.admin.deleteUser(id);
  }
});

async function newUser(email: string, firstName: string, lastName: string): Promise<string> {
  const u = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName } });
  if (u.error) throw u.error;
  return u.data.user.id;
}

/** A coach (in kg) with one client, Tara Track, who joined 40 days ago through an accepted invite. */
async function setup(): Promise<Setup> {
  const coachEmail = `overview-coach-${unique()}@example.com`;
  const coachId = await newUser(coachEmail, 'Olga', 'Coach');
  const ws = await admin.from('workspaces').insert({ name: `Overview ${unique()}` }).select('id').single();
  if (ws.error) throw ws.error;
  const clientEmail = `tara-${unique()}@example.com`;
  const clientId = await newUser(clientEmail, 'Tara', 'Track');
  const s: Setup = { coachEmail, workspaceId: ws.data.id, coachId, clientId, userIds: [coachId, clientId] };
  made.push(s);
  for (const r of [
    await admin.from('workspace_members').insert({ workspace_id: s.workspaceId, user_id: coachId, role: 'owner' }),
    await admin.from('workspace_members').insert({
      workspace_id: s.workspaceId,
      user_id: clientId,
      role: 'client',
      created_at: new Date(Date.now() - 40 * MS_DAY).toISOString(),
    }),
    await admin.from('profiles').update({ units: 'kg' }).eq('id', coachId),
    await admin.from('profiles').update({ time_zone: 'Asia/Dubai' }).eq('id', clientId),
    await admin.from('client_invites').insert({
      workspace_id: s.workspaceId,
      created_by: coachId,
      email: clientEmail,
      first_name: 'Tara',
      last_name: 'Track',
      token_hash: `test-${unique()}`,
      accepted_at: new Date(Date.now() - 40 * MS_DAY).toISOString(),
      accepted_by: clientId,
    }),
  ]) {
    if (r.error) throw r.error;
  }
  return s;
}

async function plan(s: Setup, daysFromToday: number, name = 'Session'): Promise<string> {
  const r = await admin.from('workouts').insert({ workspace_id: s.workspaceId, client_id: s.clientId, scheduled_on: dayOffset(daysFromToday), name }).select('id').single();
  if (r.error) throw r.error;
  return r.data.id;
}

async function finish(s: Setup, workoutId: string | null, daysAgo: number, name = 'Session') {
  const at = new Date(Date.now() - daysAgo * MS_DAY);
  return seedLog(admin, {
    workspaceId: s.workspaceId,
    clientId: s.clientId,
    name,
    plannedWorkoutId: workoutId,
    startedAt: new Date(at.getTime() - 3_600_000).toISOString(),
    finishedAt: at.toISOString(),
  });
}

async function scan(s: Setup, daysAgo: number, values: Record<string, number>) {
  const m = await admin
    .from('body_measurements')
    .insert({ workspace_id: s.workspaceId, client_id: s.clientId, measured_on: dayOffset(-daysAgo), source: 'coach', entered_by: s.coachId })
    .select('id')
    .single();
  if (m.error) throw m.error;
  const v = await admin.from('body_measurement_values').insert(Object.entries(values).map(([metric_key, value]) => ({ measurement_id: m.data.id, metric_key, value })));
  if (v.error) throw v.error;
}

async function signIn(page: Page, s: Setup) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(s.coachEmail);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

const CARD_IDS: Record<string, string> = {
  Training: 'training-heading',
  Highlights: 'highlights-heading',
  'Body metrics': 'body-heading',
  Updates: 'updates-heading',
  Profile: 'profile-heading',
  'Goal & countdown': 'goal-heading',
  'Limitations & injuries': 'limitations-heading',
  Notes: 'notes-heading',
};
/** An Overview card, found by the heading that labels it. */
const card = (page: Page, heading: string) => page.locator(`[aria-labelledby="${CARD_IDS[heading]}"]`);

test('Overview is the default tab and shows training, highlights, body metrics, updates and profile', async ({ page }) => {
  const s = await setup();
  // Last 7 days: yesterday done, 3 days ago missed (1 of 2), plus one the client added 2 days ago.
  // Last 30 days: also 10 days ago done (2 of 3). Next week (Monday to Sunday): 2 planned.
  await finish(s, await plan(s, -1, 'Upper A'), 1, 'Upper A');
  await plan(s, -3);
  await finish(s, await plan(s, -10), 10);
  await finish(s, null, 2, 'Extra run');
  const mondayIn = 7 - ((new Date().getDay() + 6) % 7);
  await plan(s, mondayIn);
  await plan(s, mondayIn + 2);
  const stats = await admin.from('client_stats').insert({ workspace_id: s.workspaceId, client_id: s.clientId, lifetime_volume_kg: 12345, pr_count: 4, workouts: 9 });
  if (stats.error) throw stats.error;
  await scan(s, 20, { weight_kg: 82, body_fat_pct: 20, smm_kg: 35 });
  await scan(s, 3, { weight_kg: 80.5, body_fat_pct: 19.2, smm_kg: 35.4 });

  await signIn(page, s);
  await page.goto(`/clients/${s.clientId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Tara Track' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Client sections' }).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/^Tara Track · Clients/);

  const training = card(page, 'Training');
  await expect(training.getByText('Last 7 days')).toBeVisible();
  await expect(training.locator('dd').nth(0)).toHaveText('1/2');
  // The workout Tara added herself counts in both windows, apart from the plan.
  await expect(training.getByText('+1 added by the client')).toHaveCount(2);
  await expect(training.locator('dd').nth(1)).toHaveText('2/3');
  await expect(training.locator('dd').nth(2)).toHaveText('2');

  const highlights = card(page, 'Highlights');
  await expect(highlights.getByText('12,345 kg')).toBeVisible();
  await expect(highlights.locator('dd').nth(2)).toHaveText('4');

  const body = card(page, 'Body metrics');
  await expect(body.getByRole('button', { name: /^Weight: 80\.5 kg, −1\.5 kg over last 4 weeks/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(body.getByRole('button', { name: /^Body fat: 19\.2%, −0\.8% over last 4 weeks/ })).toBeVisible();
  await expect(body.getByRole('group', { name: /^Weight, last 4 weeks chart/ })).toBeVisible();
  await body.getByRole('button', { name: /^Skeletal muscle mass/ }).click();
  await expect(body.getByRole('group', { name: /^Skeletal muscle mass, last 4 weeks chart/ })).toBeVisible();
  // All time: the same two scans, so the same change.
  await body.getByLabel('Period').selectOption('all');
  await expect(body.getByRole('button', { name: /^Weight: 80\.5 kg, −1\.5 kg over all time/ })).toBeVisible();

  const updates = card(page, 'Updates');
  await expect(updates.getByRole('link', { name: /^Tara logged Upper A for / })).toBeVisible();
  await expect(updates.getByText('Tara logged Extra run')).toBeVisible();
  await expect(updates.getByRole('link', { name: /^Body scan added for / }).first()).toBeVisible();
  await expect(updates.getByText('1d', { exact: true }).first()).toBeVisible();

  const profile = card(page, 'Profile');
  await expect(profile.getByRole('link', { name: /^tara-.*@example\.com$/ })).toBeVisible();
  await expect(profile.getByText(/Dubai \(Asia\/Dubai\)/)).toBeVisible();
});

test('the coach keeps a goal, limitations and notes; the header flags injury notes', async ({ page }) => {
  const s = await setup();
  await signIn(page, s);
  await page.goto(`/clients/${s.clientId}`);
  await expect(page.getByText('Injury notes')).toHaveCount(0);

  const goal = card(page, 'Goal & countdown');
  await goal.getByRole('button', { name: 'Set a goal' }).click();
  await goal.getByLabel('Goal', { exact: true }).fill('Run the Dubai half marathon');
  await goal.getByLabel('Target date (optional)').fill(dayOffset(10));
  await goal.getByRole('button', { name: 'Save goal' }).click();
  await expect(goal.getByText('10 days to go')).toBeVisible();
  await expect(goal.getByText('Run the Dubai half marathon')).toBeVisible();
  await expect(goal.getByText('Shared with Tara.')).toBeVisible();

  const limits = card(page, 'Limitations & injuries');
  await limits.getByRole('button', { name: 'Edit limitations and injuries' }).click();
  await limits.getByLabel('Limitations and injuries').fill('Left knee: no deep squats.');
  await limits.getByRole('button', { name: 'Save' }).click();
  await expect(limits.getByText('Left knee: no deep squats.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Injury notes' })).toBeVisible();

  const notes = card(page, 'Notes');
  await notes.getByLabel('New note').fill('Prefers morning sessions.');
  await notes.getByRole('button', { name: 'Add note' }).click();
  await expect(notes.getByRole('status')).toHaveText('Note added.');
  await notes.getByLabel('New note').fill('Travelling in December.');
  await notes.getByRole('button', { name: 'Add note' }).click();
  // Newest first.
  await expect(notes.getByRole('listitem').first()).toContainText('Travelling in December.');
  await notes.getByRole('listitem').filter({ hasText: 'Prefers morning' }).getByRole('button', { name: 'Edit' }).click();
  await notes.getByLabel('Edit note').fill('Prefers early morning sessions.');
  await notes.getByRole('button', { name: 'Save' }).click();
  await expect(notes.getByText('Prefers early morning sessions.')).toBeVisible();
  await notes.getByRole('listitem').filter({ hasText: 'Travelling' }).getByRole('button', { name: 'Delete' }).click();
  await notes.getByRole('group', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(notes.getByText('Travelling in December.')).toHaveCount(0);

  // Everything is saved: a reload shows the same, and the client could read only the goal (RLS, proven in pgTAP).
  await page.reload();
  await expect(card(page, 'Goal & countdown').getByText('10 days to go')).toBeVisible();
  await expect(card(page, 'Notes').getByText('Prefers early morning sessions.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Injury notes' })).toBeVisible();
  const rows = await admin.from('client_notes').select('body').eq('client_id', s.clientId);
  expect(rows.data?.map((r) => r.body)).toEqual(['Prefers early morning sessions.']);
});

test('the tabs open Training, Body, Documents and Settings, and old links still land in the right place', async ({ page }) => {
  const s = await setup();
  await signIn(page, s);
  await page.goto(`/clients/${s.clientId}`);
  const tabs = page.getByRole('navigation', { name: 'Client sections' });

  await tabs.getByRole('link', { name: 'Training' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${s.clientId}/training$`));
  await expect(page.getByRole('heading', { name: 'Training', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assign program' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Training' })).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/^Training · Tara Track · Clients/);

  await tabs.getByRole('link', { name: 'Body' }).click();
  await expect(page.getByRole('heading', { name: 'Body scans' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add scan' })).toBeVisible();

  await tabs.getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('heading', { name: 'Add a document' })).toBeVisible();

  await tabs.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Remove Tara Track' })).toBeVisible();

  // Home's Add scan shortcut, and links made before the tabs. An old Assign link (?assign=1) lands on Training,
  // with nothing popping up.
  await page.goto(`/clients/${s.clientId}?assign=1`);
  await expect(page).toHaveURL(new RegExp(`/clients/${s.clientId}/training$`));
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The calendar's own view and starting week are kept too.
  await page.goto(`/clients/${s.clientId}?view=2w&from=${dayOffset(0)}`);
  await expect(page).toHaveURL(new RegExp(`/clients/${s.clientId}/training\\?view=2w&from=${dayOffset(0)}$`));
  await page.goto(`/clients/${s.clientId}?scan=1`);
  await expect(page).toHaveURL(new RegExp(`/clients/${s.clientId}/body`));
  await expect(page.getByRole('dialog', { name: 'Add a scan' })).toBeVisible();
});

test('documents: upload a PDF, share it, rename it, delete it; videos are refused', async ({ page }) => {
  const s = await setup();
  await signIn(page, s);
  await page.goto(`/clients/${s.clientId}/documents`);

  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') });
  await expect(page.getByText(/Videos and other files can’t be added/)).toBeVisible();

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'Medical clearance.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Medical clearance');
  await page.getByLabel('Share with Tara (they can open it in the app)').check();
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added Medical clearance.' })).toBeVisible();

  const list = page.getByRole('list', { name: 'Documents, newest first' });
  const item = list.getByRole('listitem').first();
  // The link is made on click and opens in a new tab (the file itself is stubbed: only the signed address matters).
  await page.context().route('**/storage/v1/object/sign/client-documents/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>file</title>ok' }));
  const popupOpened = page.waitForEvent('popup');
  await item.getByRole('button', { name: /^Medical clearance/ }).click();
  const popup = await popupOpened;
  await popup.waitForURL(new RegExp(`/storage/v1/object/sign/client-documents/${s.workspaceId}/${s.clientId}/`));
  await popup.close();
  await expect(item.getByText(/PDF · \d+ B · .* · Shared with Tara/)).toBeVisible();
  const row = await admin.from('client_documents').select('shared_with_client, storage_path, size_bytes').eq('client_id', s.clientId).single();
  expect(row.data?.shared_with_client).toBe(true);
  expect(row.data?.storage_path.startsWith(`${s.workspaceId}/${s.clientId}/`)).toBe(true);

  await item.getByLabel('Share Medical clearance with Tara').uncheck();
  await expect(list.getByText(/· Only you/)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'No longer shared.' })).toBeVisible();

  await list.getByRole('button', { name: 'Rename Medical clearance' }).click();
  await list.getByLabel('Document name').fill('Clearance 2026');
  await list.getByRole('button', { name: 'Save' }).click();
  await expect(list.getByRole('button', { name: /^Clearance 2026/ })).toBeVisible();

  await list.getByRole('button', { name: 'Delete Clearance 2026' }).click();
  await list.getByRole('group', { name: 'Delete Clearance 2026?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No documents yet.')).toBeVisible();
  const files = await admin.storage.from('client-documents').list(`${s.workspaceId}/${s.clientId}`);
  expect(files.data ?? []).toEqual([]);
});
