import { expect, test, type Page } from '@playwright/test';
import { addDays } from '@caltracker/shared';
import { serviceClient, signInAsCoach } from './helpers';

// Screen choices live in the address (written in place, not as new history steps), so Back, a reload or a shared
// link comes back to the same view; and leaving a client is one Back however many tabs were looked at.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { users: string[]; programs: string[]; workouts: string[] } = { users: [], programs: [], workouts: [] };
let workspaceId: string;

test.beforeAll(async () => {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
});

test.afterAll(async () => {
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
  if (created.programs.length) await admin.from('programs').delete().in('id', created.programs);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

async function newClient(firstName: string) {
  const last = `Navb${unique()}`;
  const u = await admin.auth.admin.createUser({
    email: `navb-${firstName.toLowerCase()}-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: last },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  return { id: u.data.user.id, name: `${firstName} ${last}` };
}

const browserToday = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
const sortSelect = (page: Page) => page.getByRole('main').locator('select').first();

const SIZES = [
  { name: 'iPhone', viewport: { width: 390, height: 844 }, isMobile: true },
  { name: 'iPad portrait', viewport: { width: 820, height: 1180 }, isMobile: false },
  { name: 'iPad landscape', viewport: { width: 1180, height: 820 }, isMobile: false },
];

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: true, isMobile: size.isMobile });

    test('Clients list filter and sort survive Back and reload; one Back leaves a client; Back to Clients never loops', async ({ page }) => {
      await signInAsCoach(page);
      const client = await newClient('Listy');
      await page.goto('/home');
      await page.goto('/clients');
      const chips = page.getByRole('group', { name: 'Filter clients' });
      await chips.getByRole('button', { name: /^Nothing planned/ }).click();
      await expect(chips.getByRole('button', { name: /^Nothing planned/ })).toHaveAttribute('aria-pressed', 'true');
      await sortSelect(page).selectOption('name');
      await expect(sortSelect(page)).toHaveValue('name');
      await expect(page).toHaveURL(/\/clients\?filter=nothing_planned&sort=name$/);

      // Into the client, through three tabs, then one Back: the list, as it was.
      await page.getByRole('link', { name: client.name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${client.id}$`));
      const tabs = page.getByRole('navigation', { name: 'Client sections' });
      await tabs.getByRole('link', { name: 'Training' }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/training`));
      await tabs.getByRole('link', { name: 'Body' }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/body`));
      await page.goBack();
      await expect(page).toHaveURL(/\/clients\?filter=nothing_planned&sort=name$/);
      await expect(chips.getByRole('button', { name: /^Nothing planned/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(sortSelect(page)).toHaveValue('name');

      // A reload keeps them too.
      await page.reload();
      await expect(page.getByRole('group', { name: 'Filter clients' }).getByRole('button', { name: /^Nothing planned/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(sortSelect(page)).toHaveValue('name');

      // Back to Clients steps back to the list (same filter), and Back from there leaves Clients: no loop.
      await page.getByRole('link', { name: client.name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${client.id}$`));
      await page.getByRole('link', { name: 'Back to Clients' }).click();
      await expect(page).toHaveURL(/\/clients\?filter=nothing_planned&sort=name$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/home/);
    });

    test('Body chart range and Overview period survive a reload', async ({ page }) => {
      await signInAsCoach(page);
      const client = await newClient('Rangey');
      await page.goto(`/clients/${client.id}/body`);
      await page.getByRole('list', { name: 'Chart range' }).getByRole('button', { name: 'All' }).click();
      await expect(page).toHaveURL(/[?&]range=all/);
      await expect(page.getByRole('list', { name: 'Chart range' }).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
      await page.reload();
      await expect(page.getByRole('list', { name: 'Chart range' }).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');

      await page.goto(`/clients/${client.id}`);
      await page.getByLabel('Period').selectOption('3m');
      await expect(page).toHaveURL(/[?&]period=3m/);
      await expect(page.getByLabel('Period')).toHaveValue('3m');
      await page.reload();
      await expect(page.getByLabel('Period')).toHaveValue('3m');
    });

    test('Home attention chip survives Back and reload', async ({ page }) => {
      await signInAsCoach(page);
      // A client who missed yesterday's workout, so the Missed chip shows.
      const client = await newClient('Missy');
      const today = await browserToday(page);
      const w = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: client.id, scheduled_on: addDays(today, -1), name: `Navb missed ${unique()}` }).select('id').single();
      if (w.error) throw w.error;
      created.workouts.push(w.data.id);
      await page.goto('/home');
      const group = page.getByRole('group', { name: 'Filter Needs attention' });
      await group.getByRole('button', { name: /^Missed/ }).click();
      await expect(page).toHaveURL(/[?&]needs=missed/);
      await expect(group.getByRole('button', { name: /^Missed/ })).toHaveAttribute('aria-pressed', 'true');
      await page.goto('/clients');
      await page.goBack();
      await expect(page.getByRole('group', { name: 'Filter Needs attention' }).getByRole('button', { name: /^Missed/ })).toHaveAttribute('aria-pressed', 'true');
      await page.reload();
      await expect(page.getByRole('group', { name: 'Filter Needs attention' }).getByRole('button', { name: /^Missed/ })).toHaveAttribute('aria-pressed', 'true');
    });
  });
}

test.describe('iPhone only', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the month view keeps the picked day across Back and reload', async ({ page }) => {
    await signInAsCoach(page);
    const client = await newClient('Monthy');
    const today = await browserToday(page);
    const month = today.slice(0, 7);
    // A day of this month that isn't today.
    const day = today.endsWith('-10') ? `${month}-11` : `${month}-10`;
    await page.goto(`/clients/${client.id}/training?view=month&from=${month}-01`);
    await page.locator(`[data-date="${day}"]`).getByRole('button').first().click();
    await expect(page).toHaveURL(new RegExp(`[?&]day=${day}`));
    await expect(page.locator(`[data-date="${day}"]`).getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`/clients/${client.id}/body`);
    await page.goBack();
    await expect(page.locator(`[data-date="${day}"]`).getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator(`[data-date="${day}"]`).getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  });

  test('a program keeps its week tab across Back and reload', async ({ page }) => {
    await signInAsCoach(page);
    const p = await admin.from('programs').insert({ workspace_id: workspaceId, name: `Navb weeks ${unique()}`, weeks: 3 }).select('id').single();
    if (p.error) throw p.error;
    created.programs.push(p.data.id);
    await page.goto(`/programs/${p.data.id}`);
    const tabs = page.getByRole('tablist', { name: 'Program week' });
    await tabs.getByRole('tab', { name: 'Week 3' }).click();
    await expect(page).toHaveURL(/[?&]week=3/);
    await expect(tabs.getByRole('tab', { name: 'Week 3' })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/programs');
    await page.goBack();
    await expect(page.getByRole('tablist', { name: 'Program week' }).getByRole('tab', { name: 'Week 3' })).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Program week' }).getByRole('tab', { name: 'Week 3' })).toHaveAttribute('aria-selected', 'true');
  });
});

test('the log page’s calendar link goes back to the week it came from', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await signInAsCoach(page);
  const client = await newClient('Weeky');
  const today = await browserToday(page);
  // A workout four weeks ago, opened from that week's calendar.
  const day = addDays(today, -28);
  const name = `Navb old ${unique()}`;
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: client.id, scheduled_on: day, name }).select('id').single();
  if (w.error) throw w.error;
  created.workouts.push(w.data.id);
  const calendar = `/clients/${client.id}/training?view=week&from=${day}`;
  await page.goto(calendar);
  await page.locator(`[data-date="${day}"]`).getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Log session' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/log/${w.data.id}$`));
  await page.getByRole('link', { name: /calendar$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/training\\?view=week&from=${day}$`));
});
