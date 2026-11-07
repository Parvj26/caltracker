import { expect, test, type Locator, type Page } from '@playwright/test';
import { COACH_EMAIL, seedLog, seedSectionedWorkout, serviceClient, setRow, signInAsCoach } from './helpers';

// The client calendar's 1, 2 and 4-week views (and the month view beside them), stepping, the remembered view,
// editing a past workout and dragging in a week view. Each test seeds its own uniquely named workouts on the demo
// client and removes them afterwards.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const seeded: string[] = [];
const logs: string[] = [];
let clientId: string;
let coachId: string;
let workspaceId: string;

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const client = data.users.find((u) => u.email === 'client@demo.local');
  const coach = data.users.find((u) => u.email === COACH_EMAIL);
  if (!client || !coach) throw new Error('Demo users not found; run pnpm db:reset.');
  clientId = client.id;
  coachId = coach.id;
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
});

test.afterAll(async () => {
  if (logs.length) await admin.from('workout_logs').delete().in('id', logs);
  if (seeded.length) await admin.from('workouts').delete().in('id', seeded);
});

/* ---------- Plain YYYY-MM-DD maths (UTC only, never local time) ---------- */
const MS_DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(toMs(d) + n * MS_DAY).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(toMs(d)).getUTCDay() || 7; // Monday 1 ... Sunday 7
const mondayOf = (d: string) => addDays(d, 1 - weekday(d));
const dm = (d: string, year: boolean) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }).format(new Date(toMs(d)));
const monthName = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(toMs(d)));
/** The range label the app shows: "26 Oct – 8 Nov 2026", or both years across a new year. */
const rangeLabel = (start: string, end: string) => `${dm(start, start.slice(0, 4) !== end.slice(0, 4))} – ${dm(end, true)}`;

const browserToday = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
const cells = (page: Page) => page.locator('[data-date]');
const day = (page: Page, date: string): Locator => page.locator(`[data-date="${date}"]`);
const card = (page: Page, date: string, name: string) => day(page, date).getByRole('listitem').filter({ hasText: name });
const viewLink = (page: Page, label: string) => page.getByRole('navigation', { name: 'Calendar view' }).getByRole('link', { name: label, exact: true });

async function expectWeeks(page: Page, start: string, weeks: number) {
  await expect(cells(page)).toHaveCount(weeks * 7);
  await expect(cells(page).first()).toHaveAttribute('data-date', start);
  await expect(cells(page).last()).toHaveAttribute('data-date', addDays(start, weeks * 7 - 1));
  await expect(page.getByRole('heading', { level: 2, name: rangeLabel(start, addDays(start, weeks * 7 - 1)) })).toBeVisible();
}

/** Drag with real pointer events: press, move in 10 steps (past the 4 px activation distance), release. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error('Drag source or target is not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function seedWorkout(name: string, date: string, exercises: string[] = ['Barbell Squat']): Promise<string> {
  const id = await seedSectionedWorkout(admin, {
    workspaceId,
    clientId,
    name,
    scheduledOn: date,
    sections: [],
    blocks: exercises.map((e) => ({ exercises: [e] })),
  });
  seeded.push(id);
  return id;
}

test('2 weeks by default; ‹ › step by the view; Today comes back; the picked view is remembered and in the address', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto(`/clients/${clientId}/training`);
  const today = await browserToday(page);
  const monday = mondayOf(today);

  await expect(viewLink(page, '2 Week')).toHaveAttribute('aria-current', 'page');
  await expectWeeks(page, monday, 2);
  await expect(page.locator('[aria-current="date"]')).toHaveAttribute('data-date', today);

  await page.getByRole('link', { name: 'Next 2 weeks' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?view=2w&from=${addDays(monday, 14)}$`));
  await expectWeeks(page, addDays(monday, 14), 2);
  await page.getByRole('link', { name: 'Previous 2 weeks' }).click();
  // Wait for each step to land: the link's address is worked out from the days on screen.
  await expectWeeks(page, monday, 2);
  await page.getByRole('link', { name: 'Previous 2 weeks' }).click();
  await expectWeeks(page, addDays(monday, -14), 2);
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expectWeeks(page, monday, 2);

  // 4 weeks: kept on reload, and remembered when the calendar is opened again without ?view=.
  await viewLink(page, '4 Week').click();
  await expect(page).toHaveURL(new RegExp(`\\?view=4w&from=${today}$`));
  await expect(viewLink(page, '4 Week')).toHaveAttribute('aria-current', 'page');
  await expectWeeks(page, monday, 4);
  await page.getByRole('link', { name: 'Next 4 weeks' }).click();
  await expectWeeks(page, addDays(monday, 28), 4);
  await page.reload();
  await expectWeeks(page, addDays(monday, 28), 4);
  await page.goto(`/clients/${clientId}/training`);
  await expect(viewLink(page, '4 Week')).toHaveAttribute('aria-current', 'page');
  await expectWeeks(page, monday, 4);
  // The server already renders the remembered view (no flash of 2 weeks first): 4 weeks of days in the HTML.
  const html = await (await page.context().request.get(`/clients/${clientId}/training`)).text();
  expect(html.match(/data-date="/g)?.length).toBe(28);

  // 1 week.
  await viewLink(page, '1 Week').click();
  await expectWeeks(page, monday, 1);
  await page.getByRole('link', { name: 'Previous week' }).click();
  await expectWeeks(page, addDays(monday, -7), 1);

  // Month: the whole month, and ‹ › move a month. An older ?month= link still opens the month.
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expectWeeks(page, monday, 1);
  await viewLink(page, 'Month').click();
  await expect(page.getByRole('table', { name: monthName(today) })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: monthName(today) })).toBeVisible();
  await page.getByRole('link', { name: 'Next month' }).click();
  const nextMonth = addDays(`${today.slice(0, 7)}-28`, 7).slice(0, 7);
  await expect(page.getByRole('table', { name: monthName(`${nextMonth}-01`) })).toBeVisible();
  await page.goto(`/clients/${clientId}/training?month=${today.slice(0, 7)}`);
  await expect(page.getByRole('table', { name: monthName(today) })).toBeVisible();
  await expect(viewLink(page, 'Month')).toHaveAttribute('aria-current', 'page');
});

test('week cards preview their exercises, "+ N more", ✓ done and "Logged by coach"', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  // Tomorrow: never missed, and on screen with yesterday in a 2-week view from yesterday's week.
  const date = addDays(today, 1);
  const big = `Preview ${unique()}`;
  await seedWorkout(big, date, ['Barbell Deadlift', 'Barbell Squat', 'Cable Crossover', 'Barbell Squat', 'Barbell Deadlift']);
  // Done and logged by the coach (an in-person session): the log's author is the coach, not the client.
  const coachDone = `Coach logged ${unique()}`;
  const doneDate = addDays(today, -1);
  const doneId = await seedWorkout(coachDone, doneDate);
  const log = await admin
    .from('workout_logs')
    .insert({
      workspace_id: workspaceId, client_id: clientId, workout_id: doneId, name: coachDone, status: 'completed',
      started_at: `${doneDate}T10:00:00Z`, finished_at: `${doneDate}T11:00:00Z`, last_activity_at: `${doneDate}T11:00:00Z`, logged_by: coachId,
    })
    .select('id')
    .single();
  if (log.error) throw log.error;
  logs.push(log.data.id);

  await page.goto(`/clients/${clientId}/training?view=2w&from=${doneDate}`);
  const preview = card(page, date, big);
  await expect(preview.locator('[title^="2× Barbell Deadlift · "]')).toBeVisible();
  await expect(preview.locator('[title^="2× Barbell Squat · "]')).toHaveCount(1);
  await expect(preview.locator('[title^="2× Cable Crossover · "]')).toBeVisible();
  await expect(preview.getByText('+ 2 more exercises', { exact: true })).toBeVisible();

  const done = card(page, doneDate, coachDone);
  await expect(done.getByRole('link', { name: `Done: view the ${coachDone} log` })).toBeVisible();
  await expect(done.getByText('Logged by coach', { exact: true })).toBeVisible();
  await expect(done.getByText('Missed', { exact: true })).toHaveCount(0);

  // The month view stays compact: names only.
  await page.goto(`/clients/${clientId}/training?view=month&from=${date}`);
  await expect(card(page, date, big)).toBeVisible();
  await expect(card(page, date, big).locator('[title^="2× Barbell Deadlift · "]')).toHaveCount(0);
});

test('a missed past workout can be edited: its card opens the editor and the change is saved', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  const pastDate = addDays(today, -2);
  const name = `Missed edit ${unique()}`;
  const id = await seedWorkout(name, pastDate);

  await page.goto(`/clients/${clientId}/training?view=1w&from=${pastDate}`);
  const missed = card(page, pastDate, name);
  await expect(missed.getByText('Missed', { exact: true })).toBeVisible();
  // Past days still can't take a drop, so the name isn't a drag handle; the menu offers Edit (and Log session).
  await expect(day(page, pastDate).getByRole('button', { name, exact: true })).toHaveCount(0);
  await missed.getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  await expect(day(page, pastDate).getByRole('menu', { name: `Options for ${name}` }).getByRole('menuitem')).toHaveText([
    'Log session',
    'Edit',
    'Move to another day',
    'Copy to…',
    'Delete',
  ]);
  await page.keyboard.press('Escape');

  // A click anywhere on the card opens the editor.
  await missed.locator('[title^="2× Barbell Squat · "]').click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/workouts/${id}$`));
  const reps = setRow(page, 'Barbell Squat', 'set 1').getByLabel(/^Reps/).first();
  await reps.fill('11');
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  const sets = await admin.from('workout_sets').select('position, target_reps_min').eq('workout_id', id).order('position');
  expect(sets.data?.[0]?.target_reps_min).toBe(11);

  // Back goes to the days around it, in the coach's own view.
  await page.getByRole('link', { name: /'s calendar$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/training\\?from=${pastDate}$`));
  await expect(card(page, pastDate, name).locator('[title^="2× Barbell Squat · "]')).toBeVisible();
});

test('a done workout: Edit results opens the correction form; its plan stays read-only', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  const pastDate = addDays(today, -3);
  const name = `Done edit ${unique()}`;
  const id = await seedWorkout(name, pastDate);
  const logId = await seedLog(admin, {
    workspaceId, clientId, name, plannedWorkoutId: id, startedAt: `${pastDate}T12:00:00Z`, finishedAt: `${pastDate}T12:40:00Z`,
  });
  logs.push(logId);

  await page.goto(`/clients/${clientId}/training?view=1w&from=${pastDate}`);
  const done = card(page, pastDate, name);
  await done.getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  const menu = day(page, pastDate).getByRole('menu', { name: `Options for ${name}` });
  await expect(menu.getByRole('menuitem')).toHaveText(['View log', 'Edit results', 'Copy to…', 'Delete']);
  await menu.getByRole('menuitem', { name: 'Edit results' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/logs/${logId}$`));
  await expect(page.getByRole('button', { name: 'Save corrections' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Correct', exact: true })).toHaveCount(0);

  // Its plan isn't edited: the editor's address opens the log instead.
  await page.goto(`/clients/${clientId}/workouts/${id}`);
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/logs/${logId}$`));
});

test('drag a workout by its card body in the 2-week view; a done one stays put and says why', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  const next = addDays(mondayOf(today), 7);
  const name = `Week drag ${unique()}`;
  const id = await seedWorkout(name, next);

  await page.goto(`/clients/${clientId}/training?view=2w&from=${today}`);
  await expect(day(page, next).getByRole('button', { name, exact: true })).toBeVisible();
  // Grab the card by its exercise preview, not its name.
  const body = card(page, next, name).locator('[title^="2× Barbell Squat · "]');
  const target = day(page, addDays(next, 2));
  // The second week's tall row can start below the fold; mouse events only reach what is on screen.
  await target.scrollIntoViewIfNeeded();
  const a = (await body.boundingBox())!;
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  // Mid-drag: days that take the drop are marked open, days before today locked.
  await expect(target).toHaveAttribute('data-drop', 'open');
  await expect(day(page, today)).toHaveAttribute('data-drop', 'open');
  if (mondayOf(today) < today) await expect(day(page, mondayOf(today))).toHaveAttribute('data-drop', 'locked');
  await page.mouse.up();
  await expect(target.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.locator('[data-drop]')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
  const moved = await admin.from('workouts').select('scheduled_on').eq('id', id).single();
  expect(moved.data?.scheduled_on).toBe(addDays(next, 2));
  await page.reload();
  await expect(day(page, addDays(next, 2)).getByRole('button', { name, exact: true })).toBeVisible();

  const doneName = `Week done ${unique()}`;
  const doneId = await seedWorkout(doneName, next);
  const logId = await seedLog(admin, { workspaceId, clientId, name: doneName, plannedWorkoutId: doneId, startedAt: new Date(Date.now() - 3_600_000).toISOString(), finishedAt: new Date().toISOString() });
  logs.push(logId);
  await page.reload();
  const done = card(page, next, doneName);
  await expect(done).toBeVisible();
  await expect(day(page, next).getByRole('button', { name: doneName, exact: true })).toHaveCount(0);
  await expect(done).toHaveAttribute('title', 'Done workouts stay on the day they were done');
  await expect(done).toHaveCSS('cursor', 'default');
  // Trying to drag it shows why, leaves it where it is, and doesn't open its log.
  await day(page, addDays(next, 2)).scrollIntoViewIfNeeded();
  await drag(page, done.locator('[title^="2× Barbell Squat · "]'), day(page, addDays(next, 2)));
  await expect(done.getByRole('status')).toHaveText('Done workouts stay on the day they were done');
  await expect(page).toHaveURL(/view=2w/);
  await expect(card(page, next, doneName)).toBeVisible();
  const stayed = await admin.from('workouts').select('scheduled_on').eq('id', doneId).single();
  expect(stayed.data?.scheduled_on).toBe(next);
});

test('on a narrow screen the week view is a list of days', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await signInAsCoach(page);
  const today = await browserToday(page);
  const monday = mondayOf(today);
  await page.goto(`/clients/${clientId}/training?view=1w&from=${today}`);
  await expect(cells(page)).toHaveCount(7);
  // One column: every day starts at the same left edge, each below the one before, and says its weekday.
  const boxes = await cells(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: r.y })));
  expect(new Set(boxes.map((b) => b.x)).size).toBe(1);
  boxes.slice(1).forEach((b, i) => expect(b.y).toBeGreaterThan(boxes[i]!.y));
  await expect(day(page, monday).getByText('Mon', { exact: false }).first()).toBeVisible();
});

test('after dragging a card back onto its own day, the next click still opens it', async ({ page }) => {
  await signInAsCoach(page);
  const today = await browserToday(page);
  const date = addDays(today, 2);
  const name = `Drag back ${unique()}`;
  const id = await seedWorkout(name, date);

  await page.goto(`/clients/${clientId}/training?view=1w&from=${date}`);
  const handle = day(page, date).getByRole('button', { name, exact: true });
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  // Pick it up, move well past the 4 px start distance, and put it down on its own day.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page).toHaveURL(/view=1w/);
  const moved = await admin.from('workouts').select('scheduled_on').eq('id', id).single();
  expect(moved.data?.scheduled_on).toBe(date);

  // A real click on the card now opens the editor. (dnd-kit ignores clicks for 50 ms after a drag ends, and a
  // person can't click that fast; before the fix, every later click was ignored too.)
  await page.waitForTimeout(300);
  await card(page, date, name).locator('[title^="2× Barbell Squat · "]').click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/workouts/${id}$`));
});

test.describe('on a touch screen (iPad, phone)', () => {
  test.use({ hasTouch: true, viewport: { width: 420, height: 640 } });

  /** Real touch input through Chrome's input pipeline, so a swipe scrolls natively. */
  async function touchInput(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
    return {
      async gesture(from: { x: number; y: number }, to: { x: number; y: number }, holdMs: number) {
        await send('touchStart', from.x, from.y);
        if (holdMs) await page.waitForTimeout(holdMs);
        for (let i = 1; i <= 10; i++) {
          await send('touchMove', from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
          await page.waitForTimeout(16);
        }
        await send('touchEnd', to.x, to.y);
      },
    };
  }
  const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

  test('a swipe across a card scrolls the calendar and leaves the card where it is', async ({ page }) => {
    await signInAsCoach(page);
    const today = await browserToday(page);
    // The last day on screen: always today or later, and with plenty of calendar above it to scroll back to.
    const date = addDays(mondayOf(today), 13);
    const name = `Swipe ${unique()}`;
    const id = await seedWorkout(name, date);

    await page.goto(`/clients/${clientId}/training?view=2w&from=${today}`);
    const body = card(page, date, name).locator('[title^="2× Barbell Squat · "]');
    await expect(body).toBeVisible();
    await body.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const before = (await body.boundingBox())!;
    const touch = await touchInput(page);
    // Finger down on the card and straight down the screen, without holding: the calendar scrolls back up.
    await touch.gesture(centre(before), { x: centre(before).x, y: centre(before).y + 200 }, 0);
    await page.waitForTimeout(500);
    const after = (await body.boundingBox())!;
    expect(after.y - before.y).toBeGreaterThan(100);
    await expect(page.locator('[data-drop]')).toHaveCount(0);
    await expect(page).toHaveURL(/view=2w/);
    const stayed = await admin.from('workouts').select('scheduled_on').eq('id', id).single();
    expect(stayed.data?.scheduled_on).toBe(date);
  });

  test('a long press picks a card up and drops it on another day', async ({ page }) => {
    await signInAsCoach(page);
    const today = await browserToday(page);
    const date = addDays(mondayOf(today), 13);
    const target = addDays(date, -1);
    const name = `Long press ${unique()}`;
    const id = await seedWorkout(name, date);

    await page.goto(`/clients/${clientId}/training?view=2w&from=${today}`);
    const body = card(page, date, name).locator('[title^="2× Barbell Squat · "]');
    await expect(body).toBeVisible();
    await body.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const from = centre((await body.boundingBox())!);
    const to = centre((await day(page, target).boundingBox())!);
    const touch = await touchInput(page);
    // Hold past the 250 ms long press, then move onto the day before and let go.
    await touch.gesture(from, to, 450);
    await expect(day(page, target).getByRole('button', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    const moved = await admin.from('workouts').select('scheduled_on').eq('id', id).single();
    expect(moved.data?.scheduled_on).toBe(target);
  });
});
