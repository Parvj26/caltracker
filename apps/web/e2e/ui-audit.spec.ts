import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { demoWorkspace, freshClient, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';
import type { Database } from '@caltracker/shared';
import { seedLog, serviceClient, signInAsCoach } from './helpers';
import { AXE_ALLOW, UI_ALLOW, type AxeAllow, type Size, type UiAllow } from './ui-audit-allowlist';
import { SIZES, auditInPage, type Found } from './ui-audit-rules';

// The 3-size UI audit (docs/design/ui-audit.md). Opens every main coach page on a phone (390 x 844, touch), an iPad
// (820 x 1180, touch) and a desktop (1440 x 900) and checks the rulebook's automatic rules:
//   hscroll  the page never scrolls sideways
//   target   every visible control is at least 44 x 44 on touch sizes, 24 x 24 on desktop (WCAG 2.5.8)
//   text     no visible text under 12 px
//   overlap  no two visible controls on top of each other
//   logo     exactly one visible logo (sidebar or header)
//   heading  the page's main heading (h1) is visible on the first screen
// plus axe-core (serious and critical WCAG 2.2 AA problems) on phone and desktop.
// Known problems on screens not yet migrated are in ui-audit-allowlist.ts. Each test checks one group of pages at one
// size and reports every problem it found in one message. Read-only apart from the workout and program it seeds.

const CLIENT = '/clients/00000000-0000-4000-8000-0000000000c2';

type AuditPage = { name: string; path: string };
// `communityPost`: a coach post with a comment and a reaction, so Community's reaction chips and comment controls are
// checked too (an empty feed would hide them).
// `bodyMetrics`: two weight entries the coach logged, so the Body cards and a metric's page have a trend.
// `strengthLog`: two finished squat workouts for the demo client, so Metrics' Strength rows and the exercise page show.
// `assessment`: a fresh client with a finished Initial (ratings, numbers, notes) and a Retest 1 draft, so the tab's
// cycle card and findings, the summary and the run screen are all checked.
type Group = { name: string; pages: AuditPage[]; seed?: true; communityPost?: true; strengthLog?: true; bodyMetrics?: true; assessment?: true; signedOut?: AuditPage[] };

const GROUPS: Group[] = [
  {
    name: 'main pages',
    communityPost: true,
    pages: [
      { name: 'Home', path: '/home' },
      { name: 'Clients', path: '/clients' },
      { name: 'Messages', path: '/messages' },
      { name: 'Activity', path: '/activity' },
      { name: 'Community', path: '/community' },
    ],
  },
  {
    name: 'client page tabs',
    pages: [
      { name: 'Client overview', path: CLIENT },
      { name: 'Client training', path: `${CLIENT}/training` },
      { name: 'Client metrics', path: `${CLIENT}/metrics` },
      { name: 'Client food', path: `${CLIENT}/food` },
      { name: 'Client documents', path: `${CLIENT}/documents` },
      { name: 'Client limitations', path: `${CLIENT}/limitations` },
      { name: 'Client settings', path: `${CLIENT}/settings` },
    ],
  },
  {
    name: 'client metrics',
    strengthLog: true,
    bodyMetrics: true,
    pages: [
      { name: 'Client metrics', path: `${CLIENT}/metrics` },
      { name: 'Body metric', path: `${CLIENT}/metrics/body/weight_kg` },
      { name: 'Exercise progress', path: `${CLIENT}/metrics/strength/:squat` },
    ],
  },
  {
    name: 'library',
    seed: true,
    pages: [
      { name: 'Workouts', path: '/workouts' },
      { name: 'Workout builder', path: '/workouts/:workout' },
      { name: 'Exercises', path: '/exercises' },
      { name: 'Exercise', path: '/exercises/:exercise' },
      { name: 'Programs', path: '/programs' },
      { name: 'Program', path: '/programs/:program' },
      { name: 'Meals', path: '/meals' },
    ],
  },
  {
    name: 'assessments',
    assessment: true,
    pages: [
      { name: 'Assessments tab', path: '/clients/:client/limitations' },
      { name: 'Assessment summary', path: '/clients/:client/assessments/:done' },
      { name: 'Assessment run', path: '/clients/:client/assessments/:draft' },
      { name: 'Assessment findings', path: '/clients/:client/assessments/:draft/findings' },
      { name: 'Assessment findings (done)', path: '/clients/:client/assessments/:done/findings' },
      { name: 'Assessment exercises', path: '/clients/:client/assessments/:done/exercises' },
    ],
  },
  {
    name: 'account and sign-in',
    pages: [
      { name: 'Profile', path: '/profile' },
      { name: 'Help', path: '/help' },
    ],
    signedOut: [{ name: 'Sign in', path: '/sign-in' }],
  },
];

/** A fresh client of the demo workspace with a finished Initial and a Retest 1 draft. Delete the user to clean up. */
async function seedAssessments(admin: ReturnType<typeof serviceClient>): Promise<{ client: string; done: string; draft: string }> {
  const ws = await demoWorkspace(admin);
  const client = await freshClient(admin, ws, 'Audit', `Assess${unique().slice(-5)}`);
  const must = <R extends { data: unknown; error: unknown }>(r: R): NonNullable<R['data']> => {
    if (r.error || r.data === null) throw new Error(`Seeding the assessment failed: ${JSON.stringify(r.error)}`);
    return r.data as NonNullable<R['data']>;
  };

  const defs = must(await admin.from('assessment_test_definitions').select('id, test_key').is('workspace_id', null));
  const def = (key: string) => defs.find((d) => d.test_key === key)!.id;
  const cycle = must(await admin.from('assessment_cycles').insert({ workspace_id: ws, client_id: client, number: 1 }).select('id').single());
  const today = new Date().toISOString().slice(0, 10);
  const start = async (slot: 'initial' | 'retest_1', keys: string[]) => {
    const a = must(await admin.from('assessments').insert({ workspace_id: ws, client_id: client, cycle_id: cycle.id, slot, assessed_on: today, foot_arch_left: 'flat', foot_arch_right: 'normal' }).select('id').single());
    const tests = must(
      await admin.from('assessment_tests').insert(keys.map((k, i) => ({ workspace_id: ws, assessment_id: a.id, position: i, definition_id: def(k), test_key: k, definition_version: 1, definition: {} }))).select('id, test_key'),
    );
    return { id: a.id, test: (k: string) => tests.find((t) => t.test_key === k)!.id };
  };
  const initial = await start('initial', ['overhead_squat', 'shoulder_mobility', 'static_posture']);
  must(
    await admin.from('assessment_checkpoint_results').insert([
      { test_id: initial.test('overhead_squat'), workspace_id: ws, checkpoint_id: 'ohs.knee_valgus', side: 'L', severity: 'severe' },
      { test_id: initial.test('overhead_squat'), workspace_id: ws, checkpoint_id: 'ohs.knee_valgus', side: 'R', severity: 'slight' },
      { test_id: initial.test('overhead_squat'), workspace_id: ws, checkpoint_id: 'ohs.heel_rise', side: 'L', severity: 'slight' },
      { test_id: initial.test('overhead_squat'), workspace_id: ws, checkpoint_id: 'ohs.head_forward', side: 'none', severity: 'slight' },
      { test_id: initial.test('shoulder_mobility'), workspace_id: ws, checkpoint_id: 'shm.shoulder_hike', side: 'L', severity: 'slight' },
      { test_id: initial.test('static_posture'), workspace_id: ws, checkpoint_id: 'posture.head_forward', side: 'none', severity: 'slight' },
    ]).select('test_id'),
  );
  must(
    await admin.from('assessment_measure_results').insert([
      { test_id: initial.test('shoulder_mobility'), workspace_id: ws, measure_id: 'shm.reach_gap', side: 'L', value: 14, unit: 'cm', higher_is_better: false },
      { test_id: initial.test('shoulder_mobility'), workspace_id: ws, measure_id: 'shm.reach_gap', side: 'R', value: 11, unit: 'cm', higher_is_better: false },
    ]).select('test_id'),
  );
  must(await admin.from('assessment_tests').update({ status: 'done', note: 'Calves felt tight', follow_ups: { 'ohs.heel_lift_retest': 'better' } }).eq('assessment_id', initial.id).select('id'));
  // Step 2: the coach's confirmed findings on it (the map and the exercise groups read these).
  must(
    await admin.from('assessment_muscle_marks').insert([
      { assessment_id: initial.id, workspace_id: ws, muscle_id: 'glute_medius', side: 'L', status: 'under', review: 'confirmed', sources: ['ohs.knee_valgus'] },
      { assessment_id: initial.id, workspace_id: ws, muscle_id: 'glute_medius', side: 'R', status: 'under', review: 'confirmed', sources: ['ohs.knee_valgus'] },
      { assessment_id: initial.id, workspace_id: ws, muscle_id: 'adductors', side: 'L', status: 'over', review: 'confirmed', sources: ['ohs.knee_valgus'] },
      { assessment_id: initial.id, workspace_id: ws, muscle_id: 'tfl', side: 'R', status: 'over', review: 'rejected', sources: ['ohs.knee_valgus'] },
      { assessment_id: initial.id, workspace_id: ws, muscle_id: 'upper_traps', side: 'L', status: 'over', review: 'confirmed', sources: ['shm.shoulder_hike'] },
    ]).select('muscle_id'),
  );
  must(await admin.from('assessment_checks').insert({ assessment_id: initial.id, workspace_id: ws, check_id: 'ankle_mobility' }).select('check_id'));
  must(await admin.from('assessments').update({ status: 'done', score: 79 }).eq('id', initial.id).select('id'));
  const draft = await start('retest_1', ['overhead_squat', 'push_up']);
  return { client, done: initial.id, draft: draft.id };
}

/** axe runs on these sizes only (the tablet adds little and costs time). */
const AXE_SIZES: Size[] = ['phone', 'desktop'];

const applies = (e: { pages: string[] | '*'; sizes?: Size[] }, page: string, size: Size) =>
  (e.pages === '*' || e.pages.includes(page)) && (!e.sizes || e.sizes.includes(size));

const entryId = (e: UiAllow | AxeAllow) => `${e.rule} | ${e.pages === '*' ? '*' : e.pages.join(', ')} | ${e.selector ?? '(page)'}`;

async function open(page: Page, path: string) {
  await page.goto(path);
  // The main heading is the "page is ready" sign; a page without one is reported by the heading rule.
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300); // client-side lists and the Library/tab bars settle
}

async function axeProblems(page: Page, pageName: string, size: Size, used: Set<AxeAllow>): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const allow = AXE_ALLOW.filter((e) => applies(e, pageName, size));
  const out: string[] = [];
  for (const v of result.violations) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue;
    for (const node of v.nodes) {
      const selector = node.target.map(String).join(' ');
      const hit = [];
      for (const e of allow.filter((a) => a.rule === v.id)) {
        // No selector: the rule is excused on the whole page; otherwise the flagged element must match it.
        const ok = !e.selector || (await page.locator(selector).first().evaluate((el, s) => el.matches(s) || !!el.closest(s), e.selector).catch(() => false));
        if (ok) hit.push(e);
      }
      if (hit.length) {
        hit.forEach((e) => used.add(e));
        continue;
      }
      out.push(`axe ${v.id} (${v.impact}): ${v.help}. Element: ${node.html.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
  return out;
}

async function auditGroup(page: Page, size: Size, pages: AuditPage[], testInfo: TestInfo, report: string[], usedUi: Set<UiAllow>, usedAxe: Set<AxeAllow>) {
  const minTarget = size === 'desktop' ? 24 : 44;
  for (const p of pages) {
    await open(page, p.path);
    const entries = UI_ALLOW.filter((e) => applies(e, p.name, size));
    const allow = entries.map((e, i) => ({ i, rule: e.rule, ...(e.selector ? { selector: e.selector } : {}) }));
    const { found, used } = await page.evaluate(auditInPage, { minTarget, allow });
    used.forEach((i) => usedUi.add(entries[i]!));
    const lines: string[] = found.map((f: Found) => `${f.rule}: ${f.detail}`);
    if (AXE_SIZES.includes(size)) lines.push(...(await axeProblems(page, p.name, size, usedAxe)));
    if (lines.length) report.push(`## ${p.name} (${p.path}) at ${size}\n${lines.map((l) => `  - ${l}`).join('\n')}`);
  }
  // Entries that excused nothing here may be ready to delete (only a hint: seeded data varies between runs).
  const visited = pages.map((p) => p.name);
  const stale = [
    ...UI_ALLOW.filter((e) => visited.some((n) => applies(e, n, size)) && !usedUi.has(e)),
    ...(AXE_SIZES.includes(size) ? AXE_ALLOW.filter((e) => visited.some((n) => applies(e, n, size)) && !usedAxe.has(e)) : []),
  ];
  for (const e of stale) testInfo.annotations.push({ type: 'allow-list entry not needed here', description: `${entryId(e)} at ${size}` });
}

for (const { size, use } of SIZES) {
  test.describe(`UI audit at ${size} (${use.viewport.width}x${use.viewport.height})`, () => {
    test.use(use);

    for (const group of GROUPS) {
      test(`${group.name} follow the UI rules`, async ({ page }, testInfo) => {
        testInfo.setTimeout(120_000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const admin = serviceClient();
        const ids: Record<string, string> = {};
        const cleanup: (() => PromiseLike<unknown>)[] = [];
        if (group.seed) {
          const ws = await demoWorkspace(admin);
          const tag = `uia-${unique()}`;
          ids.workout = await seedLibraryWorkout(admin, ws, `${tag} Workout`);
          ids.program = await seedProgram(admin, ws, `${tag} Program`, 1, [{ week: 1, day: 1, workoutId: ids.workout }]);
          const ex = await admin.from('exercises').select('id').eq('name', 'Barbell Squat').is('workspace_id', null).limit(1).single();
          if (ex.error) throw ex.error;
          ids.exercise = ex.data.id;
          cleanup.push(() => admin.from('programs').delete().eq('id', ids.program!), () => admin.from('workouts').delete().eq('id', ids.workout!));
        }
        if (group.strengthLog) {
          const ws = await demoWorkspace(admin);
          const ex = await admin.from('exercises').select('id').eq('name', 'Barbell Squat').is('workspace_id', null).limit(1).single();
          if (ex.error) throw ex.error;
          ids.squat = ex.data.id;
          const clientId = CLIENT.split('/').at(-1)!;
          const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
          for (const [ago, weightKg] of [[20, 60], [5, 65]] as const) {
            const logId = await seedLog(admin, { workspaceId: ws, clientId, name: `UI audit ${unique()}`, startedAt: day(ago), sets: 2, weightKg });
            cleanup.push(() => admin.from('workout_logs').delete().eq('id', logId));
          }
        }
        if (group.bodyMetrics) {
          const ws = await demoWorkspace(admin);
          const clientId = CLIENT.split('/').at(-1)!;
          const isoDay = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
          const rows = await admin
            .from('body_metrics')
            .insert([30, 2].map((ago, i) => ({ workspace_id: ws, client_id: clientId, metric_key: 'weight_kg', value: 72 - i, measured_on: isoDay(ago), source: 'manual', entered_by_role: 'coach' })))
            .select('id');
          if (rows.error) throw rows.error;
          for (const r of rows.data) cleanup.push(() => admin.from('body_metrics').delete().eq('id', r.id));
        }
        if (group.assessment) {
          Object.assign(ids, await seedAssessments(admin));
          cleanup.push(() => admin.auth.admin.deleteUser(ids.client!));
        }
        if (group.communityPost) {
          const ws = await demoWorkspace(admin);
          const community = await admin.from('communities').select('id').eq('workspace_id', ws).eq('is_default', true).single();
          if (community.error) throw community.error;
          const owner = await admin.from('workspace_members').select('user_id').eq('workspace_id', ws).eq('role', 'owner').limit(1).single();
          if (owner.error) throw owner.error;
          const posted = await admin
            .from('community_posts')
            .insert({ community_id: community.data.id, workspace_id: ws, author_id: owner.data.user_id, body: `UI audit post ${unique()}` })
            .select('id')
            .single();
          if (posted.error) throw posted.error;
          const postId = posted.data.id;
          cleanup.push(() => admin.from('community_posts').delete().eq('id', postId));
          // The trigger fills in the community and workspace from the post.
          const reacted = await admin
            .from('community_reactions')
            .insert({ post_id: postId, user_id: owner.data.user_id, reaction: 'fire' } as Database['public']['Tables']['community_reactions']['Insert']);
          if (reacted.error) throw reacted.error;
        }
        const fill = (p: AuditPage) => ({ ...p, path: p.path.replace(/:(\w+)/g, (_, k: string) => ids[k]!) });
        const report: string[] = [];
        const usedUi = new Set<UiAllow>();
        const usedAxe = new Set<AxeAllow>();
        try {
          await signInAsCoach(page);
          await auditGroup(page, size, group.pages.map(fill), testInfo, report, usedUi, usedAxe);
          if (group.signedOut) {
            await page.context().clearCookies();
            await auditGroup(page, size, group.signedOut, testInfo, report, usedUi, usedAxe);
          }
        } finally {
          for (const c of cleanup) await c();
        }
        const message = `UI audit found ${report.length} page(s) breaking the rules at ${size}. Fix the screen, or (only for a screen not yet migrated) see docs/design/ui-audit.md.\n\n${report.join('\n\n')}`;
        expect(report, message).toEqual([]);
      });
    }
  });
}
