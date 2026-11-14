import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { formatPlainDay } from '@caltracker/shared';
import { serviceClient, signInAsCoach } from './helpers';

// The invite window (+ Invite client): one client with an optional plan, or many from a CSV. Invites show on the
// Clients list as "Invited" until they join; a plan chosen while inviting goes on their calendar when they do.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const MS_DAY = 86_400_000;
const dayOffset = (n: number) => new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() + n * MS_DAY));
const shortDay = formatPlainDay;

const cleanup: Array<() => Promise<unknown>> = [];
test.afterAll(async () => {
  for (const step of cleanup.reverse()) await step();
});

test.beforeEach(async ({ page }) => {
  await signInAsCoach(page);
});

async function openInvite(page: Page) {
  await page.getByRole('button', { name: '+ Invite client' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a client' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillPerson(page: Page, firstName: string, lastName: string, email: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill(firstName);
  await dialog.getByLabel('Last name').fill(lastName);
  await dialog.getByLabel('Email').fill(email);
}

/** The CSV upload is the invite window's second tab. */
async function openCsvTab(page: Page) {
  const dialog = await openInvite(page);
  await dialog.getByRole('tab', { name: 'Many (CSV)' }).click();
  return dialog;
}

/** A library workout and a 2-week program using it (days 1 and 3 of week 1, day 1 of week 2), in Demo Coaching. */
async function seedLibrary(tag: string) {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  const workout = await admin.from('workouts').insert({ workspace_id: ws.data.id, name: `A Start Lib ${tag}` }).select('id, name').single();
  if (workout.error) throw workout.error;
  const program = await admin.from('programs').insert({ workspace_id: ws.data.id, name: `A Start Program ${tag}`, weeks: 2 }).select('id, name').single();
  if (program.error) throw program.error;
  const slots = await admin.from('program_workouts').insert([
    { program_id: program.data.id, workspace_id: ws.data.id, week: 1, day: 1, workout_id: workout.data.id },
    { program_id: program.data.id, workspace_id: ws.data.id, week: 1, day: 3, workout_id: workout.data.id },
    { program_id: program.data.id, workspace_id: ws.data.id, week: 2, day: 1, workout_id: workout.data.id },
  ]);
  if (slots.error) throw slots.error;
  cleanup.push(async () => {
    await admin.from('programs').delete().eq('id', program.data.id);
    await admin.from('workouts').delete().eq('id', workout.data.id);
  });
  return { workspaceId: ws.data.id, workout: workout.data, program: program.data };
}

/** The invited person joins (what the accept-invite Edge Function does after they choose a password). */
async function joinAs(email: string, firstName: string, lastName: string): Promise<string> {
  const user = await admin.auth.admin.createUser({ email, password: 'client-password-123', email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName } });
  if (user.error) throw user.error;
  const id = user.data.user.id;
  cleanup.push(async () => {
    await admin.from('workout_logs').delete().eq('client_id', id);
    await admin.from('workouts').delete().eq('client_id', id);
    await admin.from('program_assignments').delete().eq('client_id', id);
    await admin.from('client_invites').delete().eq('email', email);
    await admin.from('workspace_members').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  });
  const invite = await admin.from('client_invites').select('id').eq('email', email).is('accepted_at', null).single();
  if (invite.error) throw invite.error;
  const accepted = await admin.rpc('accept_invite_for', { p_invite_id: invite.data.id, p_user_id: id });
  if (accepted.error) throw accepted.error;
  expect(accepted.data).toBe('ok');
  return id;
}

test('invite one client: the Sent screen, then they show as Invited and can be resent', async ({ page }) => {
  const email = `new-${unique()}@example.com`;
  const dialog = await openInvite(page);
  await expect(dialog.getByText("They'll sign in to the app with this email.")).toBeVisible();
  await fillPerson(page, 'New', 'Client', email);
  await expect(dialog.getByText(/What New gets:/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Send invite' }).click();

  const sent = page.getByRole('dialog', { name: 'Invite sent to New' });
  await expect(sent.getByText(email)).toBeVisible();
  await expect(sent.getByText(/The link works until \d{1,2} \w+\./)).toBeVisible();
  await expect(sent.getByText('Choose a password in the CalTracker app')).toBeVisible();
  // The raw link is never sent back to the dashboard, so there is no copy button.
  await expect(sent.getByRole('button', { name: /Copy/ })).toHaveCount(0);
  await sent.getByRole('button', { name: 'Done' }).click();
  await expect(sent).toBeHidden();

  const row = page.getByRole('table', { name: 'Clients', exact: true }).getByRole('row').filter({ hasText: email });
  await expect(row).toContainText('New Client');
  await expect(row).toContainText('Invited today');
  await expect(row).toContainText('Not joined yet');
  // No plan yet: the Plan cell says so (it used to show the email under the "Plan" label).
  await expect(row.getByRole('cell').last()).toContainText('Nothing planned');
  await expect(row.getByRole('cell').last()).not.toContainText(email);
  // A resend right after sending changes nothing: the link already in the inbox keeps working.
  await row.getByRole('button', { name: `Resend invite to ${email}` }).click();
  await expect(row.getByText(/Already sent a moment ago/)).toBeVisible();
});

test('invite with a program: it shows on the Invited row and goes on their calendar when they join', async ({ page }) => {
  const tag = unique();
  const { program } = await seedLibrary(tag);
  const email = `prog-${tag}@example.com`;
  const start = dayOffset(2);
  await page.reload();
  const dialog = await openInvite(page);
  await fillPerson(page, 'Pat', `Program${tag}`, email);
  await dialog.getByRole('button', { name: 'Program', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Program', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // The select's name is its label plus the program it shows.
  await dialog.getByRole('combobox', { name: /^Program/ }).selectOption({ label: program.name });
  await dialog.getByLabel('Start date').fill(start);
  await dialog.getByRole('button', { name: 'Send invite' }).click();

  const sent = page.getByRole('dialog', { name: 'Invite sent to Pat' });
  await expect(sent.getByText(`Their ${program.name} program begins ${shortDay(start)}`)).toBeVisible();
  await sent.getByRole('button', { name: 'Done' }).click();

  const table = page.getByRole('table', { name: 'Clients', exact: true });
  const row = table.getByRole('row').filter({ hasText: `Pat Program${tag}` });
  await expect(row).toContainText('Invited today');
  await expect(row).toContainText(program.name);
  await expect(row).toContainText(`starts ${shortDay(start)}`);

  // They join: the program is on their calendar from its start day, and the list shows them as a client with it.
  const clientId = await joinAs(email, 'Pat', `Program${tag}`);
  const copies = await admin.from('workouts').select('scheduled_on, assignment_id').eq('client_id', clientId).order('scheduled_on');
  expect(copies.error).toBeNull();
  expect(copies.data!.map((w) => w.scheduled_on)).toEqual([start, dayOffset(4), dayOffset(9)]);
  expect(copies.data!.every((w) => w.assignment_id !== null)).toBe(true);
  await page.reload();
  const joined = table.locator(`[data-client-id="${clientId}"]`);
  await expect(joined).toContainText(program.name);
  await expect(joined).not.toContainText('Invited');
});

test('invite with a single workout: pick it, choose the day, and it lands on that day when they join', async ({ page }) => {
  const tag = unique();
  const { workout } = await seedLibrary(tag);
  const email = `single-${tag}@example.com`;
  const day = dayOffset(3);
  await page.reload();
  const dialog = await openInvite(page);
  await fillPerson(page, 'Sid', `Single${tag}`, email);
  await dialog.getByRole('button', { name: 'Single workout', exact: true }).click();
  await dialog.getByLabel('Search workouts').fill(workout.name);
  await dialog.getByRole('button', { name: workout.name, exact: true }).click();
  await expect(dialog.getByRole('list', { name: 'Chosen workouts' })).toContainText(workout.name);
  await dialog.getByLabel(`Day for ${workout.name}`).fill(day);
  await expect(dialog.getByRole('button', { name: '+ Add another workout' })).toBeVisible();
  await expect(dialog.getByText(`${workout.name} will be on their calendar for ${shortDay(day)} when they join`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Send invite' }).click();

  const sent = page.getByRole('dialog', { name: 'Invite sent to Sid' });
  await expect(sent.getByText(`${workout.name} is on their calendar for ${shortDay(day)}`)).toBeVisible();
  await sent.getByRole('button', { name: 'Done' }).click();

  const row = page.getByRole('table', { name: 'Clients', exact: true }).getByRole('row').filter({ hasText: `Sid Single${tag}` });
  await expect(row).toContainText('Invited today');
  await expect(row).toContainText(`Single workout: ${workout.name}`);

  const clientId = await joinAs(email, 'Sid', `Single${tag}`);
  const copies = await admin.from('workouts').select('scheduled_on, name, assignment_id').eq('client_id', clientId);
  expect(copies.data).toEqual([{ scheduled_on: day, name: workout.name, assignment_id: null }]);
});

test('re-inviting with "Nothing yet" clears a plan chosen earlier, so it is not applied when they join', async ({ page }) => {
  const tag = unique();
  const { workout } = await seedLibrary(tag);
  const email = `clear-${tag}@example.com`;
  await page.reload();
  let dialog = await openInvite(page);
  await fillPerson(page, 'Cleo', `Clear${tag}`, email);
  await dialog.getByRole('button', { name: 'Single workout', exact: true }).click();
  await dialog.getByLabel('Search workouts').fill(workout.name);
  await dialog.getByRole('button', { name: workout.name, exact: true }).click();
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  await page.getByRole('dialog', { name: 'Invite sent to Cleo' }).getByRole('button', { name: 'Done' }).click();
  const row = page.getByRole('table', { name: 'Clients', exact: true }).getByRole('row').filter({ hasText: `Cleo Clear${tag}` });
  await expect(row).toContainText(`Single workout: ${workout.name}`);

  // The same email again, with Nothing yet (the default).
  dialog = await openInvite(page);
  await fillPerson(page, 'Cleo', `Clear${tag}`, email);
  await expect(dialog.getByRole('button', { name: 'Nothing yet', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  await page.getByRole('dialog', { name: 'Invite sent to Cleo' }).getByRole('button', { name: 'Done' }).click();
  await expect(row).not.toContainText('Single workout');
  await expect(row).toContainText(email);

  const clientId = await joinAs(email, 'Cleo', `Clear${tag}`);
  const copies = await admin.from('workouts').select('id').eq('client_id', clientId);
  expect(copies.data).toEqual([]);
});

test('the chosen single workout is marked in the picker', async ({ page }) => {
  const tag = unique();
  const { workout } = await seedLibrary(tag);
  await page.reload();
  const dialog = await openInvite(page);
  await dialog.getByRole('button', { name: 'Single workout', exact: true }).click();
  await dialog.getByLabel('Search workouts').fill(workout.name);
  await dialog.getByRole('button', { name: workout.name, exact: true }).click();
  await dialog.getByRole('button', { name: '+ Add another workout' }).click();
  await dialog.getByLabel('Search workouts').fill(workout.name);
  const pick = dialog.getByRole('button', { name: workout.name, exact: true });
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await expect(pick).toContainText('✓ chosen');
});

test('invites are listed newest first, after the clients', async ({ page }) => {
  const run = unique();
  const add = async (firstName: string, lastName: string, email: string) => {
    const dialog = await openInvite(page);
    await fillPerson(page, firstName, lastName, email);
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await page.getByRole('dialog', { name: `Invite sent to ${firstName}` }).getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('table', { name: 'Clients', exact: true }).getByRole('row').filter({ hasText: email })).toBeVisible();
  };
  // Added first, and first by last name: newest-first must still put it below the later one.
  const older = `older-${run}@example.com`;
  const newer = `newer-${run}@example.com`;
  await add('Ada', 'Aardvark', older);
  await add('Zoe', 'Zulu', newer);
  await page.reload();
  const rows = await page.getByRole('table', { name: 'Clients', exact: true }).getByRole('row').allTextContents();
  const at = (text: string) => rows.findIndex((r) => r.includes(text));
  expect(at(newer)).toBeGreaterThan(-1);
  expect(at(newer)).toBeLessThan(at(older));
  expect(at('Demo Client')).toBeLessThan(at(newer));
});

test('a 45-row CSV is sent in chunks and every row is reported', async ({ page }) => {
  const run = unique();
  // Older single Name column: still accepted and split on the first space.
  const lines = ['Name,Email', ...Array.from({ length: 45 }, (_, i) => `Bulk ${i},bulk${i}-${run}@example.com`)];
  await openCsvTab(page);
  await page.getByLabel('Invite many clients from a spreadsheet (CSV)').setInputFiles({
    name: 'bulk.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(lines.join('\n')),
  });
  await page.getByRole('button', { name: 'Send 45 invites' }).click();
  await expect(page.getByRole('table', { name: 'CSV preview' }).getByText('Invite sent')).toHaveCount(45, { timeout: 60_000 });
});

test('while a CSV is sending, a new file cannot be picked and the send cannot be restarted', async ({ page }) => {
  const run = unique();
  // Hold the send (a server action POST to this page) until the checks below have run.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/clients', async (route) => {
    if (route.request().method() === 'POST') await held;
    await route.continue();
  });
  await openCsvTab(page);
  const fileInput = page.getByLabel('Invite many clients from a spreadsheet (CSV)');
  await fileInput.setInputFiles({
    name: 'busy.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Name,Email\nBusy One,busy1-${run}@example.com\nBusy Two,busy2-${run}@example.com`),
  });
  await page.getByRole('button', { name: 'Send 2 invites' }).click();
  await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await expect(fileInput).toBeDisabled();

  release();
  await expect(page.getByRole('table', { name: 'CSV preview' }).getByText('Invite sent')).toHaveCount(2);
  await expect(fileInput).toBeEnabled();
});

test('empty first name shows an inline error and sends nothing', async ({ page }) => {
  const email = `noname-${unique()}@example.com`;
  const dialog = await openInvite(page);
  await dialog.getByLabel('Last name').fill('Only');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'Enter a first name' })).toBeVisible();
  await expect(dialog.getByLabel('First name')).toHaveAttribute('aria-invalid', 'true');
  // Focused while invalid: the magenta border stays, and an ink outline still shows where focus is.
  await dialog.getByLabel('First name').focus();
  await expect(dialog.getByLabel('First name')).toHaveCSS('outline-style', 'solid');
  await expect(dialog.getByLabel('First name')).not.toHaveCSS('outline-width', '0px');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(email)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(email)).toHaveCount(0);
});

test('CSV upload previews valid rows and line errors, then sends the valid ones', async ({ page }) => {
  const run = unique();
  const csv = readFileSync(join(__dirname, 'fixtures', 'clients.csv'), 'utf8').replaceAll('{{RUN}}', run);
  const dialog = await openCsvTab(page);
  await page.getByLabel('Invite many clients from a spreadsheet (CSV)').setInputFiles({
    name: 'clients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });

  const preview = page.getByRole('table', { name: 'CSV preview' });
  await expect(preview.getByRole('row')).toHaveCount(4); // header + 3 rows
  // Separate First Name / Last Name columns, as in an Everfit export.
  await expect(preview.getByRole('row').filter({ hasText: `alice-${run}@example.com` }).getByRole('cell')).toHaveText([
    'Alice',
    'Example',
    `alice-${run}@example.com`,
    '',
  ]);
  await expect(page.getByText('Line 5: Invalid email: not-an-email')).toBeVisible();
  await expect(page.getByText(/Line 6: Duplicate email/)).toBeVisible();

  await page.getByRole('button', { name: 'Send 3 invites' }).click();
  await expect(preview.getByText('Invite sent')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Close' }).click();

  const list = page.getByRole('table', { name: 'Clients', exact: true });
  for (const who of ['alice', 'bob', 'cara']) {
    // Exactly one row each, so the duplicate line produced no second copy.
    await expect(list.getByRole('row').filter({ hasText: `${who}-${run}@example.com` })).toHaveCount(1);
  }
  await expect(list.getByText('not-an-email')).toHaveCount(0);
});

test('the demo client is listed under Clients', async ({ page }) => {
  const clients = page.getByRole('table', { name: 'Clients', exact: true });
  await expect(clients.getByRole('row').filter({ hasText: 'Demo Client' })).toBeVisible();
  await expect(page.getByText('No clients yet')).toHaveCount(0);
});
