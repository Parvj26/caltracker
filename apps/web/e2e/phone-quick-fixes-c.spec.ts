import { devices, expect, test } from '@playwright/test';
import { demoWorkspace, freshClient, seedLibraryWorkout, unique } from './assign-helpers';
import { seedSectionedWorkout, serviceClient, signInAsCoach } from './helpers';

// iPhone quick fixes C (2026-11-12 Safari review): the ⌘K hint, the invite window, the Workouts search and the
// session logger's Previous / Next. Chromium with iPhone sizes and touch (the browser can't be chosen per spec). Each
// CI shard starts from an empty database, so every test makes its own data and removes it afterwards.

const admin = serviceClient();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];

const created = { workouts: [] as string[], users: [] as string[], inviteEmails: [] as string[] };
test.afterAll(async () => {
  if (created.users.length) await admin.from('workout_logs').delete().in('client_id', created.users);
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
  if (created.inviteEmails.length) await admin.from('client_invites').delete().in('email', created.inviteEmails);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

const browserToday = (page: import('@playwright/test').Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));

test.describe('iPhone 13 (390 x 664 page area)', () => {
  test.use({ ...iphone13 });

  test('Home search shows no ⌘K / Ctrl K hint on a phone (there is no keyboard to press it on)', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/home');
    await expect(page.getByRole('combobox', { name: 'Find a client' })).toHaveAttribute('placeholder', 'Find a client');
  });

  test('the invite window says "What they get:" before a name, and the Sent view opens at its top', async ({ page }) => {
    test.slow();
    const email = `phone-invite-${unique()}@example.com`;
    created.inviteEmails.push(email);
    await signInAsCoach(page);
    await page.goto('/clients');
    await page.getByRole('button', { name: '+ Invite client' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a client' });
    await expect(dialog.getByText('What they get:', { exact: true })).toBeVisible();

    // Someone else's details: no spell-check, autocorrect or contact AutoFill on the name and email boxes.
    for (const label of ['First name', 'Last name', 'Email']) {
      const box = dialog.getByLabel(label);
      await expect(box).toHaveAttribute('autocomplete', 'off');
      await expect(box).toHaveAttribute('spellcheck', 'false');
      await expect(box).toHaveAttribute('autocorrect', 'off');
    }
    await expect(dialog.getByLabel('Email')).toHaveAttribute('autocapitalize', 'none');

    await dialog.getByLabel('First name').fill('Pia');
    await expect(dialog.getByText('What Pia gets:', { exact: true })).toBeVisible();
    await dialog.getByLabel('Last name').fill(`Phone${unique()}`);
    await dialog.getByLabel('Email').fill(email);
    // The Send button is at the bottom of the scrolled form.
    await dialog.getByRole('button', { name: 'Send invite' }).click();

    const sent = page.getByRole('dialog', { name: 'Invite sent to Pia' });
    await expect(sent.getByRole('heading', { name: 'Invite sent to Pia' })).toBeInViewport({ ratio: 1 });
    await expect.poll(() => sent.evaluate((d) => d.scrollTop)).toBe(0);
    await sent.getByRole('button', { name: 'Done' }).click();
  });

  test('Workouts search forgives a typo and filters as you type', async ({ page }) => {
    const tag = unique();
    const name = `Mobility ${tag}`;
    created.workouts.push(await seedLibraryWorkout(admin, await demoWorkspace(admin), name));
    await signInAsCoach(page);
    await page.goto('/workouts');
    const box = page.getByRole('searchbox', { name: 'Search' });
    // No Search tap needed: the list narrows as the coach types, typos forgiven ("mobilty").
    await box.fill(`mobilty ${tag}`);
    const list = page.getByRole('table', { name: 'Workouts' });
    await expect(list.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(list.getByRole('row')).toHaveCount(2); // header + the one match
    await expect(page).toHaveURL(new RegExp(`[?&]q=mobilty(\\+|%20)${tag}`));
    await box.fill(`zzzz ${tag}`);
    await expect(page.getByText('No workouts match.')).toBeVisible();
  });

  test('the session logger brings the next exercise\'s name into view after Next and Previous', async ({ page }) => {
    test.slow();
    const ws = await demoWorkspace(admin);
    const client = await freshClient(admin, ws, 'Lou', `Logger${unique()}`);
    created.users.push(client);
    await signInAsCoach(page);
    const today = await browserToday(page);
    const workoutId = await seedSectionedWorkout(admin, {
      workspaceId: ws,
      clientId: client,
      name: `Pager ${unique()}`,
      scheduledOn: today,
      sections: [],
      blocks: [{ exercises: ['Barbell Squat'] }, { exercises: ['Pushups'] }],
    });
    created.workouts.push(workoutId);

    await page.goto(`/clients/${client}/log/${workoutId}`);
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Barbell Squat' })).toBeVisible();

    const next = page.getByRole('button', { name: 'Next →' });
    await next.scrollIntoViewIfNeeded();
    await next.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Pushups' })).toBeInViewport();

    const previous = page.getByRole('button', { name: '← Previous' });
    await previous.scrollIntoViewIfNeeded();
    await previous.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Barbell Squat' })).toBeInViewport();
  });
});

test('Home search shows the keyboard hint on a computer', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/home');
  await expect(page.getByRole('combobox', { name: 'Find a client' })).toHaveAttribute('placeholder', /^Find a client {2}(⌘K|Ctrl K)$/);
});
