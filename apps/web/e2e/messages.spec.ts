import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { expect, test, type Page } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';

// Coach messages (docs/superpowers/specs/2026-11-05-messages-design.md). The coach's unread badge is shared by every
// test here, so the file runs in order, and each test makes (and removes) its own client.
test.describe.configure({ mode: 'serial' });

const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 100000)}`;
const userIds: string[] = [];
let workspaceId: string;
let coachId: string;

// A 1 x 1 PNG; the browser turns it into WebP before upload.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeAll(async () => {
  const { data: ws, error } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (error) throw error;
  workspaceId = ws.id;
  const { data: users, error: uErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (uErr) throw uErr;
  coachId = users.users.find((u) => u.email === 'coach@demo.local')!.id;
});

test.afterEach(async () => {
  // Deleting the user removes their conversation and messages with it.
  for (const id of userIds.splice(0)) await admin.auth.admin.deleteUser(id);
});

async function makeClient(first: string) {
  const email = `msg-${unique()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: first, last_name: 'Texter' },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: data.user.id, role: 'client' });
  if (m.error) throw m.error;
  return { id: data.user.id, email, name: `${first} Texter` };
}

async function conversationOf(clientId: string): Promise<string> {
  const up = await admin.from('conversations').upsert({ workspace_id: workspaceId, client_id: clientId }, { onConflict: 'workspace_id,client_id' }).select('id').single();
  if (up.error) throw up.error;
  return up.data.id;
}

/** A message from the client, inserted with the service role (the phone is not part of this test). */
async function clientSays(clientId: string, body: string) {
  const conversationId = await conversationOf(clientId);
  const { error } = await admin.from('messages').insert({ conversation_id: conversationId, workspace_id: workspaceId, sender_id: clientId, body });
  if (error) throw error;
  return conversationId;
}

/** A client of the API signed in as a real user (anon key + password), so RLS applies. */
async function signedInAs(email: string, password: string) {
  const out = execSync('supabase status -o env', { encoding: 'utf8' });
  const get = (name: string) => out.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm'))?.[1];
  const as = createClient<Database>(get('API_URL')!, get('ANON_KEY')!, { auth: { persistSession: false } });
  const signedIn = await as.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return as;
}

/** The client marks the conversation read, signed in as themselves. */
async function clientReads(email: string, conversationId: string) {
  const as = await signedInAs(email, 'client-password-123');
  const { error } = await as.rpc('mark_conversation_read', { p_conversation_id: conversationId });
  if (error) throw error;
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Inbox/ });
async function unreadTotal(page: Page): Promise<number> {
  const label = (await nav(page).getAttribute('aria-label')) ?? '';
  return Number(/(\d+) unread/.exec(label)?.[1] ?? 0);
}
const inboxRow = (page: Page, name: string) => page.getByRole('list', { name: 'Conversations' }).getByRole('link', { name: new RegExp(`^${name}`) });

test('the coach sends text and a photo and both appear', async ({ page }) => {
  const client = await makeClient('Sendy');
  await signInAsCoach(page);
  await page.goto(`/messages/${client.id}`);
  await expect(page.getByRole('heading', { name: client.name })).toBeVisible();

  const box = page.getByLabel('Message', { exact: true });
  await box.fill('Great session today 💪');
  await box.press('Enter');
  const log = page.getByRole('log');
  await expect(log.getByText('Great session today 💪')).toBeVisible();
  await expect(log.getByText('Today', { exact: true })).toBeVisible();
  await expect(box).toHaveValue('');

  // Shift+Enter makes a new line instead of sending.
  await box.fill('line one');
  await box.press('Shift+Enter');
  await box.pressSequentially('line two');
  await expect(box).toHaveValue('line one\nline two');
  await box.fill('');

  await page.getByLabel('Choose photos').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('list', { name: 'Photos to send' }).getByRole('img', { name: 'Photo 1' })).toBeVisible();
  await box.fill('Form check');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const sent = log.locator('[data-message="sent"]').filter({ hasText: 'Form check' });
  await expect(sent).toBeVisible();
  const photo = sent.getByRole('img', { name: 'Photo 1' });
  await expect(photo).toBeVisible();
  // The private photo loads through its signed URL.
  await expect.poll(() => photo.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  const stored = await admin.from('messages').select('body, image_paths, sender_id').eq('body', 'Form check').single();
  expect(stored.error).toBeNull();
  expect(stored.data!.sender_id).toBe(coachId);
  expect(stored.data!.image_paths).toHaveLength(1);
  expect(stored.data!.image_paths[0]).toMatch(new RegExp(`^${workspaceId}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(webp|jpg)$`));
});

test('a message from the client appears live, raises the badge, and opening the conversation clears it', async ({ page }) => {
  const client = await makeClient('Livia');
  await signInAsCoach(page);
  await page.goto('/messages');
  await expect(page.getByText('Pick a client to see your conversation.')).toBeVisible();
  const before = await unreadTotal(page);

  const conversationId = await clientSays(client.id, 'Hi coach, quick question');
  await expect.poll(() => unreadTotal(page)).toBe(before + 1);
  const row = inboxRow(page, client.name);
  await expect(row).toContainText('Hi coach, quick question');
  await expect(row).toHaveAttribute('data-unread', '1');

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/messages/${client.id}$`));
  await expect(page.getByRole('log').getByText('Hi coach, quick question')).toBeVisible();
  await expect.poll(() => unreadTotal(page)).toBe(before);
  await expect(inboxRow(page, client.name)).toHaveAttribute('data-unread', '0');

  // With the conversation open, a new message shows without a reload and does not count as unread.
  await admin.from('messages').insert({ conversation_id: conversationId, workspace_id: workspaceId, sender_id: client.id, body: 'Also: thanks!' });
  await expect(page.getByRole('log').getByText('Also: thanks!')).toBeVisible();
  await expect.poll(() => unreadTotal(page)).toBe(before);
});

test('"Seen" appears once the client has read the coach\'s message', async ({ page }) => {
  const client = await makeClient('Seena');
  await signInAsCoach(page);
  await page.goto(`/messages/${client.id}`);
  const box = page.getByLabel('Message', { exact: true });
  await box.fill('Did you do your stretches?');
  await box.press('Enter');
  const bubble = page.getByRole('log').locator('[data-message="sent"]').filter({ hasText: 'Did you do your stretches?' });
  await expect(bubble).toBeVisible();
  await expect(bubble.getByText('Seen')).toHaveCount(0);

  const { data } = await admin.from('conversations').select('id').eq('client_id', client.id).single();
  await clientReads(client.email, data!.id);
  await expect(bubble.getByText('Seen')).toBeVisible();
});

test('the Message button on the client page opens that conversation', async ({ page }) => {
  const client = await makeClient('Deepa');
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}`);
  await page.getByRole('link', { name: 'Message', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/messages/${client.id}$`));
  await expect(page.getByRole('heading', { name: client.name })).toBeVisible();
});

test('a message sent while Realtime was not delivering shows up when the window is focused again', async ({ page }) => {
  const client = await makeClient('Fokus');
  // Realtime never connects, as after a laptop sleeps: only the focus refetch can catch up.
  await page.routeWebSocket(/realtime/, () => {});
  await signInAsCoach(page);
  await page.goto(`/messages/${client.id}`);
  await expect(page.getByRole('heading', { name: client.name })).toBeVisible();

  await clientSays(client.id, 'Sent while you were away');
  await page.waitForTimeout(1500);
  await expect(page.getByText('Sent while you were away')).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('log').getByText('Sent while you were away')).toBeVisible();
});

test('a long message and a burst of emoji wrap inside the bubble', async ({ page }) => {
  const client = await makeClient('Wrapa');
  await signInAsCoach(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/messages/${client.id}`);
  const box = page.getByLabel('Message', { exact: true });
  await box.fill(`${'supercalifragilistic'.repeat(12)} ${'😀'.repeat(150)}`);
  await box.press('Enter');
  const bubble = page.getByRole('log').locator('[data-message]').first();
  await expect(bubble).toBeVisible();
  const log = page.getByRole('log');
  expect(await log.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const [b, l] = await Promise.all([bubble.boundingBox(), log.boundingBox()]);
  expect(b!.x + b!.width).toBeLessThanOrEqual(l!.x + l!.width);
});

test('a past client\'s page shows their history read-only', async ({ page }) => {
  const client = await makeClient('Pasta');
  await clientSays(client.id, 'Thanks for everything, coach');
  const pc = await admin.from('past_clients').insert({
    workspace_id: workspaceId,
    user_id: client.id,
    email: client.email,
    first_name: 'Pasta',
    last_name: 'Texter',
    joined_at: new Date().toISOString(),
    removed_by: coachId,
  });
  if (pc.error) throw pc.error;
  const gone = await admin.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', client.id);
  if (gone.error) throw gone.error;

  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}`);
  await expect(page.getByRole('log').getByText('Thanks for everything, coach')).toBeVisible();
  await expect(page.getByText("you can read the history but can't send new messages")).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Message', exact: true })).toHaveCount(0);

  // Not in the inbox.
  await page.goto('/messages');
  await expect(inboxRow(page, client.name)).toHaveCount(0);
  // The database refuses a new message too.
  const conv = await admin.from('conversations').select('id').eq('client_id', client.id).single();
  const as = await signedInAs('coach@demo.local', 'demo-password-123');
  const blocked = await as.from('messages').insert({ conversation_id: conv.data!.id, body: 'hello?', workspace_id: workspaceId });
  expect(blocked.error).not.toBeNull();
});
