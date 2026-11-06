import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { serviceClient, signInAsCoach } from './helpers';

// Community on the website: the coach posts (text and a photo), clients (signed in with the anon key, as the phone is)
// like, comment and report, and the coach pins, deletes, handles reports and removes a member from the community.
const admin = serviceClient();
// The database fills in who and where; the generated Insert types still list those columns.
type Insert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
const PASSWORD = 'client-password-123';
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const createdUsers: string[] = [];
let workspaceId: string;
let communityId: string;

// A 2 x 2 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeAll(async () => {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
  const c = await admin.from('communities').select('id').eq('workspace_id', workspaceId).eq('is_default', true).single();
  if (c.error) throw c.error;
  communityId = c.data.id;
});

test.afterAll(async () => {
  // Deleting the user takes their posts, comments, likes and reports' links with them.
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
});

async function newClient(firstName: string): Promise<{ id: string; phone: SupabaseClient<Database> }> {
  const email = `community-${unique()}@example.com`;
  const u = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: 'Tester' },
  });
  if (u.error) throw u.error;
  createdUsers.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  const phone = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await phone.auth.signInWithPassword({ email, password: PASSWORD });
  if (signedIn.error) throw signedIn.error;
  return { id: u.data.user.id, phone };
}

async function clientPost(phone: SupabaseClient<Database>, body: string): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await phone.rpc('create_community_post', { p_id: id, p_community_id: communityId, p_body: body });
  if (error) throw error;
  return id;
}

const post = (page: Page, text: string) => page.getByTestId('community-post').filter({ hasText: text });

async function openCommunity(page: Page) {
  await signInAsCoach(page);
  await page.getByRole('link', { name: 'Community', exact: true }).click();
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Community' })).toBeVisible();
  await expect(page.locator('[data-live="live"]')).toHaveCount(1, { timeout: 15_000 });
}

test('the coach posts with a photo, a client likes and comments live, and the coach pins and moderates', async ({ page }) => {
  const sam = await newClient('Sam');
  await openCommunity(page);

  const text = `Welcome to the group ${unique()} — see https://caltracker.app`;
  const composer = page.getByRole('region', { name: 'New post' });
  await composer.getByLabel('Write a post').fill(text);
  await composer.getByLabel('Add photos').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: PNG });
  await expect(composer.getByRole('img', { name: 'Photo 1' })).toBeVisible();
  await composer.getByRole('button', { name: 'Post', exact: true }).click();
  const mine = post(page, text);
  await expect(mine).toBeVisible();
  await expect(mine.getByRole('link', { name: 'https://caltracker.app' })).toHaveAttribute('target', '_blank');
  await expect(mine.getByRole('link', { name: 'Open photo 1 full size' })).toBeVisible();
  await expect(page.getByLabel('Write a post')).toHaveValue('');

  // The client sees it, with the coach's name, and gets a notification.
  const seen = await sam.phone.from('community_posts').select('id, body').eq('body', text).single();
  expect(seen.error).toBeNull();
  const postId = seen.data!.id;
  const note = await sam.phone.from('community_notifications').select('kind').eq('post_id', postId);
  expect(note.data).toEqual([{ kind: 'coach_post' }]);

  // The client likes and comments; the coach's open page updates by itself.
  expect((await sam.phone.from('community_likes').insert({ post_id: postId } as Insert<'community_likes'>)).error).toBeNull();
  expect((await sam.phone.from('community_comments').insert({ post_id: postId, body: 'Glad to be here!' } as Insert<'community_comments'>)).error).toBeNull();
  await expect(mine.getByTestId('likers')).toHaveText('Sam Tester likes this');
  await expect(mine.getByText('Glad to be here!')).toBeVisible();

  // Pin, then delete the client's comment.
  await mine.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(mine.getByText('Pinned', { exact: true })).toBeVisible();
  await expect(page.getByTestId('community-post').first()).toContainText(text);
  page.once('dialog', (d) => void d.accept());
  await mine.getByRole('button', { name: 'Delete comment' }).click();
  await expect(mine.getByText('Glad to be here!')).toHaveCount(0);

  // The coach can like too.
  await mine.getByRole('button', { name: '♡ Like' }).click();
  await expect(mine.getByTestId('likers')).toHaveText('You and Sam Tester like this');

  // Delete the post (and its photo).
  page.once('dialog', (d) => void d.accept());
  await mine.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(mine).toHaveCount(0);
  const gone = await admin.from('community_post_images').select('id').eq('post_id', postId);
  expect(gone.data).toEqual([]);
});

test('a client reports a post and the coach removes it from the Reports queue', async ({ page }) => {
  const kim = await newClient('Kim');
  const lee = await newClient('Lee');
  const text = `Buy my supplements ${unique()}`;
  await clientPost(kim.phone, text);
  const target = await lee.phone.from('community_posts').select('id').eq('body', text).single();
  const report = await lee.phone.rpc('report_community_content', { p_reason: 'spam', p_post_id: target.data!.id, p_note: 'Selling' });
  expect(report.error).toBeNull();
  // The reporter can't read reports back.
  expect((await lee.phone.from('community_reports').select('id')).data).toEqual([]);

  await openCommunity(page);
  await expect(post(page, text)).toBeVisible();
  await page.getByRole('link', { name: /^Reports/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  const card = page.getByTestId('report').filter({ hasText: text });
  await expect(card).toContainText('Lee Tester reported Kim Tester’s post');
  await expect(card).toContainText('Spam or selling');
  page.once('dialog', (d) => void d.accept());
  await card.getByRole('button', { name: 'Remove post' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText(`Kim Tester’s post: removed`).first()).toBeVisible();

  const after = await kim.phone.from('community_posts').select('id').eq('body', text);
  expect(after.data).toEqual([]);
});

test('the coach removes a client from the community only, then adds them back', async ({ page }) => {
  const max = await newClient('Max');
  await openCommunity(page);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Remove Max Tester from the community' }).click();
  await expect(page.getByRole('button', { name: 'Add Max Tester back to the community' })).toBeVisible();

  // Out of the community, still a client.
  expect((await max.phone.from('communities').select('id')).data).toEqual([]);
  expect((await max.phone.rpc('create_community_post', { p_id: crypto.randomUUID(), p_community_id: communityId, p_body: 'hi' })).error?.code).toBe('42501');
  expect((await max.phone.from('workspace_members').select('workspace_id')).data).toEqual([{ workspace_id: workspaceId }]);

  await page.getByRole('button', { name: 'Add Max Tester back to the community' }).click();
  await expect(page.getByRole('button', { name: 'Remove Max Tester from the community' })).toBeVisible();
  expect((await max.phone.from('communities').select('id')).data).toEqual([{ id: communityId }]);
});
