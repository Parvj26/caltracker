import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { browserToday, demoWorkspace, freshClient, seedLibraryWorkout, unique } from './assign-helpers';
import { serviceClient, showInvites, signInAsCoach } from './helpers';
import { SIZES, auditInPage } from './ui-audit-rules';
import type { Size } from './ui-audit-allowlist';

// Luis's coach fixes (approved mockups CW1-CW5), at phone, iPad and desktop sizes:
//   CW1 "+ New workout" from a client's "Add a workout" window (with and without "Also save to Library")
//   CW2 "Save to Library" in a calendar workout's ⋯ menu ("In Library", and a name already in the Library)
//   CW3 the Rest box's quick picks
//   CW4 a pending invite's window (rename, new email, Change plan, expired link)
//   CW5 the Overview cards' title links and "+ Create '<query>'" in the exercise search
// Each pop-up is also checked with the UI audit's rules (no sideways scroll, tap targets, overlaps, tiny text).
// Screenshots go to CW_SHOTS_DIR when it is set (for comparing with the mockups by eye).

const admin = serviceClient();
const SHOTS = process.env.CW_SHOTS_DIR;
const cleanup: (() => PromiseLike<unknown>)[] = [];
test.afterAll(async () => {
  for (const c of cleanup.reverse()) await c();
});

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** The UI audit's in-page rules, inside one open pop-up. */
/**
 * Waits until the page's own requests have been quiet for `quietMs`: no router fetch still in flight after an action
 * (closing a pop-up, a server action's revalidate). Opening a pop-up while one is pending makes Next.js reload the
 * whole page (an app race, reported in PR #197), which would take the pop-up away mid-test. Call it right after the
 * action, so the fetch it starts is counted. (page.waitForLoadState('networkidle') can't do this: on a page that has
 * already loaded it returns at once.)
 */
async function settle(page: Page, quietMs = 500) {
  let inFlight = 0;
  let lastChange = Date.now();
  const started = () => {
    inFlight += 1;
    lastChange = Date.now();
  };
  const ended = () => {
    inFlight = Math.max(0, inFlight - 1);
    lastChange = Date.now();
  };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  try {
    await expect.poll(() => inFlight === 0 && Date.now() - lastChange >= quietMs, { timeout: 15_000, intervals: [100] }).toBe(true);
  } finally {
    page.off('request', started);
    page.off('requestfinished', ended);
    page.off('requestfailed', ended);
  }
}

async function auditPopup(page: Page, size: Size, scope = 'dialog[open]') {
  // Pop-ups open with a light scale and fade: measure them once their animations have finished.
  await page.locator(scope).first().evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  // A filled search box shows its × inside the box, by design.
  const allow = [{ i: 0, rule: 'overlap', selector: '[aria-label="Clear search"]' }];
  const result = await page.evaluate(auditInPage, { minTarget: size === 'desktop' ? 24 : 44, allow, scope });
  expect(result.found.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
}

async function newClient(first: string, last: string) {
  const workspaceId = await demoWorkspace(admin);
  const id = await freshClient(admin, workspaceId, first, last);
  cleanup.push(async () => {
    await admin.from('workouts').delete().eq('client_id', id);
    await admin.auth.admin.deleteUser(id);
  });
  return { workspaceId, id };
}

/** "+ Exercise" inside whatever is open: tick one exercise and add it. */
async function addExercise(page: Page, exercise: string) {
  await page.getByRole('button', { name: '+ Exercise', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add exercises' });
  await picker.getByLabel('Search exercises').fill(exercise);
  await picker.getByRole('option', { name: exercise, exact: true }).click();
  await picker.getByRole('button', { name: 'Add 1 exercise', exact: true }).click();
  await expect(picker).toBeHidden();
}

const menuFor = (page: Page, name: string) => page.getByRole('button', { name: `Options for ${name}` }).first();

for (const { size, use } of SIZES) {
  test.describe(`${size}`, () => {
    test.use(use);

    // ---------- CW1 ----------
    test('CW1: + New workout builds a workout for the client’s day, in the Library only when asked', async ({ page }) => {
      const tag = unique();
      const { workspaceId, id } = await newClient('Vaishali', `Kohli ${tag}`);
      await signInAsCoach(page);
      await page.goto(`/clients/${id}/training`);
      await page.getByRole('button', { name: '+ Add workout' }).first().click();
      const add = page.getByRole('dialog', { name: 'Add a workout' });
      await expect(add.getByRole('button', { name: /New workout/ })).toBeVisible();
      await expect(add.getByText('Build it here.')).toBeVisible();
      await shot(page, `cw1-${size}-add-a-workout`);
      await auditPopup(page, size);
      await add.getByRole('button', { name: /New workout/ }).click();

      const sheet = page.getByRole('dialog', { name: 'New workout' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText(`Vaishali Kohli ${tag} ·`, { exact: false })).toBeVisible();
      const library = sheet.getByRole('checkbox', { name: 'Also save to Library' });
      await expect(library).not.toBeChecked();
      await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
      await shot(page, `cw1-${size}-new-workout-empty`);
      await auditPopup(page, size);

      // Not ticked: on her calendar only.
      const name = `Vaishali Upper ${tag}`;
      await sheet.getByLabel('Workout name').fill(name);
      await addExercise(page, 'Barbell Squat');
      await shot(page, `cw1-${size}-new-workout-first-exercise`);
      // The phone editor opens the exercise on its own screen: back to the list first.
      const done = page.getByRole('button', { name: 'Done', exact: true });
      if (await done.isVisible()) await done.click();
      await sheet.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByText(`Added ${name} to`)).toBeVisible();
      const today = await browserToday(page);
      const onDay = await admin.from('workouts').select('id, scheduled_on, source_workout_id').eq('client_id', id).eq('name', name);
      expect(onDay.data).toEqual([expect.objectContaining({ scheduled_on: today, source_workout_id: null })]);
      const inLib = await admin.from('workouts').select('id').eq('workspace_id', workspaceId).is('client_id', null).eq('name', name);
      expect(inLib.data).toEqual([]);

      // Ticked: in the Library too, and the calendar copy comes from it.
      await page.getByRole('button', { name: '+ Add workout' }).first().click();
      await page.getByRole('dialog', { name: 'Add a workout' }).getByRole('button', { name: /New workout/ }).click();
      const libName = `Vaishali Lower ${tag}`;
      await sheet.getByLabel('Workout name').fill(libName);
      await addExercise(page, 'Barbell Squat');
      if (await done.isVisible()) await done.click();
      await sheet.getByRole('checkbox', { name: 'Also save to Library' }).check();
      await sheet.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByText(`Added ${libName} to`)).toBeVisible();
      await expect(page.getByText('and saved it to your Library')).toBeVisible();
      const lib = await admin.from('workouts').select('id').eq('workspace_id', workspaceId).is('client_id', null).eq('name', libName).single();
      cleanup.push(() => admin.from('workouts').delete().eq('id', lib.data!.id));
      const copy = await admin.from('workouts').select('source_workout_id').eq('client_id', id).eq('name', libName).single();
      expect(copy.data?.source_workout_id).toBe(lib.data!.id);
    });

    // ---------- CW2 ----------
    test('CW2: Save to Library saves the plan, says In Library for an untouched copy, and asks for a name on a clash', async ({ page }) => {
      const tag = unique();
      const { workspaceId, id } = await newClient('Vaishali', `Kohli ${tag}`);
      const libName = `Monday Upper ${tag}`;
      const libId = await seedLibraryWorkout(admin, workspaceId, libName);
      cleanup.push(() => admin.from('workouts').delete().eq('workspace_id', workspaceId).is('client_id', null).like('name', `%${tag}%`));
      await signInAsCoach(page);
      await page.goto(`/clients/${id}/training`);

      // An untouched copy of a library workout: "✓ In Library", not usable.
      await page.getByRole('button', { name: '+ Add workout' }).first().click();
      await page.getByRole('dialog', { name: 'Add a workout' }).getByRole('button', { name: libName }).click();
      await expect(page.getByText(`Added ${libName} to`)).toBeVisible();
      await page.reload();
      await menuFor(page, libName).click();
      const inLibrary = page.getByRole('menuitem', { name: /In Library/ });
      await expect(inLibrary).toHaveAttribute('aria-disabled', 'true');
      await shot(page, `cw2-${size}-in-library`);
      await page.keyboard.press('Escape');

      // Edited for her: "Save to Library" -> the name is taken -> "<name> (Vaishali, <day>)".
      const copy = await admin.from('workouts').select('id').eq('client_id', id).eq('name', libName).single();
      const setRow = await admin.from('workout_sets').select('id').eq('workout_id', copy.data!.id).limit(1).single();
      await admin.from('workout_sets').update({ target_reps_min: 12, target_reps_max: 12 }).eq('id', setRow.data!.id);
      await admin.from('workouts').update({ customised_at: new Date().toISOString() }).eq('id', copy.data!.id);
      await page.reload();
      await menuFor(page, libName).click();
      const items = page.getByRole('menuitem');
      await expect(items.nth((await items.count()) - 2)).toHaveText('Save to Library');
      await expect(items.nth((await items.count()) - 1)).toHaveText('Delete');
      await shot(page, `cw2-${size}-menu`);
      await page.getByRole('menuitem', { name: 'Save to Library' }).click();
      const ask = page.getByRole('dialog', { name: 'Save to Library' });
      const suggested = ask.getByLabel('Name');
      await expect(suggested).toHaveValue(new RegExp(`^${libName} \\(Vaishali, \\w{3} \\d{1,2} \\w{3}\\)$`));
      await expect(ask.getByText(`“${libName}” is already in your Library.`)).toBeVisible();
      await shot(page, `cw2-${size}-name-clash`);
      await auditPopup(page, size);
      const newName = await suggested.inputValue();
      await ask.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(ask).toBeHidden();
      await expect(page.getByText('Saved to Library')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open', exact: true })).toBeVisible();
      await shot(page, `cw2-${size}-saved`);
      // The plan went over (12 reps), as a new library workout; the calendar workout and the original are unchanged.
      const saved = await admin.from('workouts').select('id').eq('workspace_id', workspaceId).is('client_id', null).eq('name', newName).single();
      const sets = await admin.from('workout_sets').select('target_reps_max').eq('workout_id', saved.data!.id).order('position');
      expect(sets.data?.[0]?.target_reps_max).toBe(12);
      const original = await admin.from('workout_sets').select('target_reps_max').eq('workout_id', libId).order('position');
      expect(original.data?.[0]?.target_reps_max).toBe(8);
      await page.getByRole('link', { name: 'Open', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/workouts/${saved.data!.id}$`));
    });

    // ---------- CW3 ----------
    test('CW3: the Rest box shows quick picks only while it has focus, and a pick keeps the focus', async ({ page }) => {
      const workspaceId = await demoWorkspace(admin);
      const wid = await seedLibraryWorkout(admin, workspaceId, `Rest picks ${unique()}`);
      cleanup.push(() => admin.from('workouts').delete().eq('id', wid));
      // With a rest (the Rest box shows only when the exercise has one).
      await admin.from('workout_sets').update({ rest_seconds: 60 }).eq('workout_id', wid);
      await signInAsCoach(page);
      await page.goto(`/workouts/${wid}`);
      // Phones and iPad portrait list the exercises; a tap opens one on its own screen (wider screens show its sets).
      const listRow = page.getByRole('button', { name: /^Barbell Squat: / }).locator('visible=true');
      await expect(page.getByLabel('Rest (m:ss)').locator('visible=true').or(listRow).first()).toBeVisible();
      if (await listRow.count()) await listRow.first().click();
      const rest = page.getByLabel('Rest (m:ss)').locator('visible=true').first();
      const picks = page.getByRole('group', { name: 'Quick rest' });
      await expect(picks).toHaveCount(0);
      await rest.click();
      await expect(picks).toBeVisible();
      await expect(picks.getByRole('button')).toHaveText(['0:30', '1:00', '1:30', '2:00']);
      await shot(page, `cw3-${size}-rest-focused`);
      await picks.getByRole('button', { name: '1:30' }).click();
      await expect(rest).toBeFocused();
      await expect(rest).toHaveValue('1:30');
      await expect(picks.getByRole('button', { name: '1:30' })).toHaveAttribute('aria-pressed', 'true');
      await expect(picks.getByRole('button', { name: '1:00' })).toHaveAttribute('aria-pressed', 'false');
      // Typing straight after a pick replaces it (shown as typed until the box is left).
      await page.keyboard.type('200');
      await expect(rest).toHaveValue('200');
      await expect(picks.getByRole('button', { name: '2:00' })).toHaveAttribute('aria-pressed', 'true');
      // The picks stay inside the screen.
      const box = (await picks.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(use.viewport.width);
      await auditPopup(page, size, '[aria-label="Quick rest"]');
      await page.keyboard.press('Tab');
      await expect(picks).toHaveCount(0);
      await expect(rest).toHaveValue('2:00');
    });

    // ---------- CW4 ----------
    test('CW4: a pending invite opens its window: rename, a new email, change plan, and an expired link', async ({ page }) => {
      const tag = unique();
      const workspaceId = await demoWorkspace(admin);
      const coach = await admin.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'owner').single();
      const programs = await admin.from('programs').select('id, name').eq('workspace_id', workspaceId).limit(1);
      const now = Date.now();
      const email = `ana-${tag}@example.com`;
      const fresh = await admin
        .from('client_invites')
        .insert({ workspace_id: workspaceId, email, first_name: 'Ana', last_name: `Torres ${tag}`, token_hash: `cw4a-${tag}`, created_by: coach.data!.user_id })
        .select('id')
        .single();
      const old = new Date(now - 20 * 86_400_000);
      const expired = await admin
        .from('client_invites')
        .insert({
          workspace_id: workspaceId,
          email: `ben-${tag}@example.com`,
          first_name: 'Ben',
          last_name: `Okafor ${tag}`,
          token_hash: `cw4b-${tag}`,
          created_by: coach.data!.user_id,
          sent_at: old.toISOString(),
          expires_at: new Date(old.getTime() + 14 * 86_400_000).toISOString(),
        })
        .select('id')
        .single();
      cleanup.push(() => admin.from('client_invites').delete().eq('workspace_id', workspaceId).like('last_name', `%${tag}`));
      await signInAsCoach(page);
      const filtered = settle(page);
      await showInvites(page);
      await filtered;

      // The whole row opens it; Resend and ⋯ stay on the row.
      const row = page.locator(`[data-invite-id="${fresh.data!.id}"]`);
      await expect(row.getByRole('button', { name: `Resend invite to ${email}` })).toBeVisible();
      await row.getByRole('button', { name: new RegExp(`^Ana Torres ${tag}, invite`) }).click();
      // One pop-up at a time; its title follows the name as it is saved.
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByText('Waiting for them to join · Invited today')).toBeVisible();
      await expect(sheet.getByText('Nothing yet')).toBeVisible();
      await shot(page, `cw4-${size}-sheet`);
      await auditPopup(page, size);

      // Name: saved on leaving the box.
      await sheet.getByLabel('Name').fill(`Ana Maria Torres ${tag}`);
      await sheet.getByLabel('Email').focus();
      await expect(sheet.getByText('Saved', { exact: true })).toBeVisible();
      const renamed = await admin.from('client_invites').select('first_name, last_name').eq('id', fresh.data!.id).single();
      expect(renamed.data).toEqual({ first_name: 'Ana', last_name: `Maria Torres ${tag}` });

      // Change plan: the invite window's own step.
      if (programs.data?.[0]) {
        await sheet.getByRole('button', { name: 'Change plan' }).click();
        const planSheet = page.getByRole('dialog', { name: 'Change plan' });
        await planSheet.getByRole('button', { name: 'Program', exact: true }).click();
        await planSheet.getByLabel('Program').selectOption(programs.data[0].id);
        await shot(page, `cw4-${size}-change-plan`);
        await page.getByRole('button', { name: 'Save plan' }).click();
        await expect(page.getByRole('dialog').getByText(new RegExp(`${programs.data[0].name} · starts`))).toBeVisible();
      }

      // A new email: "Save and resend to …"; the old invite goes, a new one keeps the name (and plan).
      const newEmail = `ana-new-${tag}@example.com`;
      await page.getByRole('dialog').getByLabel('Email').fill(newEmail);
      const move = page.getByRole('button', { name: `Save and resend to ${newEmail}` });
      await expect(move).toBeVisible();
      await expect(page.getByText('The old link stops working.')).toBeVisible();
      await shot(page, `cw4-${size}-email-changed`);
      await move.click();
      await expect(page.getByRole('dialog').getByText(/Invite sent|Sent|sent/).first()).toBeVisible({ timeout: 20_000 });
      const gone = await admin.from('client_invites').select('id').eq('id', fresh.data!.id);
      expect(gone.data).toEqual([]);
      const moved = await admin.from('client_invites').select('id, first_name, last_name, client_invite_plan_items(program_id)').eq('email', newEmail).single();
      expect(moved.data).toMatchObject({ first_name: 'Ana', last_name: `Maria Torres ${tag}` });
      if (programs.data?.[0]) expect(moved.data!.client_invite_plan_items).toEqual([{ program_id: programs.data[0].id }]);
      // Closing starts a router fetch for the page under it: let it finish before the next pop-up opens (opened during
      // it, Next.js reloads the whole page; an app race, reported in PR #197).
      const closed = settle(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page).not.toHaveURL(/[?&]sheet=/);
      await closed;

      // Expired: the chip, and Resend invite leads.
      const expiredRow = page.locator(`[data-invite-id="${expired.data!.id}"]`);
      await expiredRow.getByRole('button', { name: /link expired/ }).click();
      const benSheet = page.getByRole('dialog', { name: `Ben Okafor ${tag}` });
      await expect(benSheet.getByText('Link expired')).toBeVisible();
      await expect(benSheet.getByText('Waiting for them to join · Invited 20 days ago')).toBeVisible();
      const buttons = benSheet.getByRole('button');
      const labels = await buttons.allInnerTexts();
      const firstAction = labels.find((l) => l.trim() !== '×' && l.trim() !== '');
      expect(firstAction?.trim()).toBe('Resend invite');
      await shot(page, `cw4-${size}-expired`);
      await auditPopup(page, size);
      // Cancel invite… closes this, then asks.
      await benSheet.getByRole('button', { name: 'Cancel invite…' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Cancel this invite?' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'Cancel invite', exact: true }).click();
      await expect(expiredRow).toHaveCount(0);
    });

    // ---------- CW5 ----------
    test('CW5: Overview title rows are links; an empty card says so with the grey button', async ({ page }) => {
      const { id } = await newClient('Vaishali', `Kohli ${unique()}`);
      await signInAsCoach(page);
      await page.goto(`/clients/${id}`);
      const card = (heading: string) => page.locator(`section[aria-labelledby="${heading}"], [aria-labelledby="${heading}"]`).first();
      const training = card('training-heading').getByRole('link', { name: 'Training', exact: true });
      await expect(training).toHaveAttribute('href', `/clients/${id}/training`);
      await expect(card('highlights-heading').getByRole('link', { name: 'Highlights All time' })).toHaveAttribute('href', `/clients/${id}/training#bests-heading`);
      await expect(card('body-heading').getByRole('link', { name: 'Body metrics', exact: true })).toHaveAttribute('href', `/clients/${id}/metrics`);
      await expect(page.getByText('No workouts yet.')).toBeVisible();
      await expect(page.getByRole('link', { name: '+ Log metric' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'See bests and stickers' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Open calendar' })).toHaveCount(0);
      await shot(page, `cw5-${size}-overview`);
      await training.click();
      await expect(page).toHaveURL(new RegExp(`/clients/${id}/training`));
    });

    test('CW5: an exercise search with no match creates the exercise in place and ticks it', async ({ page }) => {
      const tag = unique();
      const workspaceId = await demoWorkspace(admin);
      cleanup.push(() => admin.from('exercises').delete().eq('workspace_id', workspaceId).like('name', `%${tag}%`));
      // A near-identical one already there: "Did you mean …?".
      await admin.from('exercises').insert({ workspace_id: workspaceId, source: 'custom', name: `Sandbag Carry X${tag}`, tracking_type: 'weight_time' });
      await signInAsCoach(page);
      await page.goto('/workouts/new');
      await page.getByRole('button', { name: '+ Exercise', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Add exercises' });
      const query = `farmer sled ${tag}`;
      await picker.getByLabel('Search exercises').fill(query);
      await expect(picker.getByText(`No exercises match “${query}”`, { exact: false })).toBeVisible();
      const create = picker.getByRole('button', { name: `+ Create “Farmer sled ${tag}”` });
      await expect(create).toBeVisible();
      await shot(page, `cw5-${size}-search-empty`);
      await create.click();
      await expect(picker.getByLabel('Name')).toHaveValue(`Farmer sled ${tag}`);
      await expect(picker.getByLabel('Tracking')).toHaveValue('reps');
      // Typing a name that is the existing one with other spacing and case: "Did you mean …?".
      await picker.getByLabel('Name').fill(`sand bag carry x${tag}`);
      await expect(picker.getByText(`Sandbag Carry X${tag}`)).toBeVisible();
      await expect(picker.getByRole('button', { name: 'Use it' })).toBeVisible();
      await shot(page, `cw5-${size}-did-you-mean`);
      await auditPopup(page, size);
      await picker.getByLabel('Name').fill(`Farmer sled ${tag}`);
      await picker.getByRole('button', { name: 'Create', exact: true }).click();
      // Created for this workspace, listed and ticked.
      const option = picker.getByRole('option', { name: new RegExp(`Farmer sled ${tag}`) });
      await expect(option).toBeVisible();
      await expect(picker.getByRole('button', { name: 'Add 1 exercise' })).toBeEnabled();
      await shot(page, `cw5-${size}-created`);
      const made = await admin.from('exercises').select('source, tracking_type').eq('workspace_id', workspaceId).eq('name', `Farmer sled ${tag}`).single();
      expect(made.data).toEqual({ source: 'custom', tracking_type: 'reps' });
      expect(page.context().pages()).toHaveLength(1);
    });
  });
}

// The built-in library has the common conditioning moves (Burpee and friends, scripts/caltracker-extra-exercises.json).
test('the exercise library has Burpee, Jumping Jack, Bear Crawl, High Knees and Skater Jump', async () => {
  const { data } = await admin.from('exercises').select('name').is('workspace_id', null).in('name', ['Burpee', 'Jumping Jack', 'Bear Crawl', 'High Knees', 'Skater Jump']);
  expect((data ?? []).map((r) => r.name).sort()).toEqual(['Bear Crawl', 'Burpee', 'High Knees', 'Jumping Jack', 'Skater Jump']);
});

