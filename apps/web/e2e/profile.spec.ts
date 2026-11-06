import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

// A coach of its own, so renaming the business or changing the password never disturbs the shared demo coach.
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const PHOTO = join(__dirname, '..', '..', '..', 'scripts', 'fixtures', 'free-exercise-db', 'Barbell_Deadlift', '0.jpg');
const START_PASSWORD = 'profile-start-password-1';
const NEW_PASSWORD = 'profile-brand-new-password-2';

// scripts/ is an ES module package and the web app is CommonJS, so provisionCoach runs through tsx (as set-password does).
function provision(email: string): { userId: string; workspaceId: string } {
  const code = `
    import { createClient } from '@supabase/supabase-js';
    import { provisionCoach } from './provision-coach.ts';
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const r = await provisionCoach(admin, { email: process.argv[1], firstName: 'Fresh', lastName: 'Coach', workspaceName: 'Fresh Gym' });
    console.log('RESULT:' + JSON.stringify(r));
  `;
  const out = execFileSync('pnpm', ['--filter', '@caltracker/scripts', 'exec', 'tsx', '--input-type=module', '-e', code, email], {
    cwd: join(__dirname, '..', '..', '..'),
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_SITE_URL: 'http://localhost:3000' },
  });
  const line = out.split('\n').find((l) => l.startsWith('RESULT:'));
  if (!line) throw new Error(`provisionCoach gave no result:\n${out}`);
  return JSON.parse(line.slice('RESULT:'.length)) as { userId: string; workspaceId: string };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/clients$/);
}

test.describe('coach profile', () => {
  test.describe.configure({ mode: 'serial' });
  const email = `profile-${randomUUID()}@example.test`;
  let ids: { userId: string; workspaceId: string };
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    ids = provision(email);
    const set = await admin.auth.admin.updateUserById(ids.userId, { password: START_PASSWORD, email_confirm: true });
    if (set.error) throw set.error;
    page = await browser.newPage({ baseURL: 'http://localhost:3000' });
    await signIn(page, email, START_PASSWORD);
    await page.goto('/profile');
  });

  test.afterAll(async () => {
    await page.close();
    await admin.from('workspaces').delete().eq('id', ids.workspaceId);
    await admin.auth.admin.deleteUser(ids.userId);
  });

  const sidebarProfile = () => page.locator('[data-coach-sidebar]').getByRole('link', { name: 'Profile' });

  test('the sidebar has a Profile item with initials, and the page shows the email read-only', async () => {
    await expect(sidebarProfile()).toBeVisible();
    await expect(sidebarProfile().locator('img')).toHaveCount(0);
    await expect(sidebarProfile()).toContainText('FC');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue(email);
    await expect(page.getByLabel('Email')).toHaveJSProperty('readOnly', true);
  });

  test('saving with no changes shows the tick and no error', async () => {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '✓ Saved' })).toBeVisible();
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  });

  test('edit every field, save, and the values survive a reload', async () => {
    await page.getByLabel('First name').fill('Jordan');
    await page.getByLabel('Last name').fill('Rivera');
    await page.getByLabel('Business name').fill('Rivera Strength');
    await page.getByLabel('Bio').fill('Strength coach.\nFormer sprinter.');
    await page.getByLabel('Units').selectOption('lb');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '✓ Saved' })).toBeVisible();
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel('First name')).toHaveValue('Jordan');
    await expect(page.getByLabel('Last name')).toHaveValue('Rivera');
    await expect(page.getByLabel('Business name')).toHaveValue('Rivera Strength');
    await expect(page.getByLabel('Bio')).toHaveValue('Strength coach.\nFormer sprinter.');
    await expect(page.getByLabel('Units')).toHaveValue('lb');
    await expect(page.locator('[data-coach-sidebar]').getByText('Rivera Strength')).toBeVisible();
    await expect(sidebarProfile()).toContainText('JR');
    const row = await admin.from('workspaces').select('name').eq('id', ids.workspaceId).single();
    expect(row.data?.name).toBe('Rivera Strength');
  });

  test('a 301-character bio is blocked by the counter and the form, and nothing is saved', async () => {
    await page.getByLabel('Bio').fill('a'.repeat(300));
    await expect(page.getByText('300 / 300')).toBeVisible();
    await page.getByLabel('Bio').fill('a'.repeat(301));
    await expect(page.getByText('301 / 300')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Keep your bio to 300 characters or fewer.' })).toBeVisible();
    const row = await admin.from('profiles').select('bio').eq('id', ids.userId).single();
    expect(row.data?.bio).toBe('Strength coach.\nFormer sprinter.');
    await page.reload();
    await expect(page.getByLabel('Bio')).toHaveValue('Strength coach.\nFormer sprinter.');
  });

  test('upload a photo: the sidebar shows an image; remove it: initials come back', async () => {
    await page.getByLabel('Choose a photo').setInputFiles(PHOTO);
    await expect(page.getByRole('status').filter({ hasText: 'Photo updated.' })).toBeVisible();
    const img = sidebarProfile().locator('img');
    await expect(img).toBeVisible();
    // The private file really loads through its signed link.
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    const files = await admin.storage.from('avatars').list(ids.userId);
    expect(files.data?.map((f) => f.name).sort()).toEqual(['avatar-thumb.webp', 'avatar.webp']);
    const row = await admin.from('profiles').select('avatar_path').eq('id', ids.userId).single();
    expect(row.data?.avatar_path).toBe(`${ids.userId}/avatar.webp`);

    await page.reload();
    await expect(sidebarProfile().locator('img')).toBeVisible();

    await page.getByRole('button', { name: 'Remove photo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Photo removed.' })).toBeVisible();
    await expect(sidebarProfile().locator('img')).toHaveCount(0);
    await expect(sidebarProfile()).toContainText('JR');
    const after = await admin.from('profiles').select('avatar_path').eq('id', ids.userId).single();
    expect(after.data?.avatar_path).toBeNull();
    const left = await admin.storage.from('avatars').list(ids.userId);
    expect(left.data ?? []).toHaveLength(0);
  });

  test('a file that is not a picture is refused with a friendly message', async () => {
    await page.getByLabel('Choose a photo').setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not an image') });
    await expect(page.getByRole('alert').filter({ hasText: "That image couldn't be used. Try a JPEG or PNG." })).toBeVisible();
    await expect(sidebarProfile().locator('img')).toHaveCount(0);
  });

  test('change password: wrong current is refused, the right one works, and the new password signs in', async ({ browser }) => {
    const current = page.getByLabel('Current password');
    const next = page.getByLabel('New password', { exact: true });
    const confirm = page.getByLabel('Confirm new password');
    const submit = page.getByRole('button', { name: 'Change password' });

    await current.fill('definitely-not-it-1');
    await next.fill(NEW_PASSWORD);
    await confirm.fill(NEW_PASSWORD);
    await submit.click();
    await expect(page.getByRole('alert').filter({ hasText: "That's not your current password." })).toBeVisible();

    await current.fill(START_PASSWORD);
    await confirm.fill('something-else-entirely');
    await submit.click();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();

    try {
      await confirm.fill(NEW_PASSWORD);
      await submit.click();
      await expect(page.getByRole('status').filter({ hasText: 'Password changed.' })).toBeVisible();
      await expect(current).toHaveValue('');

      const fresh = await browser.newPage({ baseURL: 'http://localhost:3000' });
      await signIn(fresh, email, NEW_PASSWORD);
      await fresh.close();
      // The old password no longer works.
      const old = await createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      }).auth.signInWithPassword({ email, password: START_PASSWORD });
      expect(old.error).not.toBeNull();
    } finally {
      // Put the original password back, whatever happened.
      await admin.auth.admin.updateUserById(ids.userId, { password: START_PASSWORD, email_confirm: true });
    }
  });
});
