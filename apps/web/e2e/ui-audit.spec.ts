import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { demoWorkspace, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';
import type { Database } from '@caltracker/shared';
import { serviceClient, signInAsCoach } from './helpers';
import { AXE_ALLOW, UI_ALLOW, type AxeAllow, type Size, type UiAllow } from './ui-audit-allowlist';

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
type Group = { name: string; pages: AuditPage[]; seed?: true; communityPost?: true; signedOut?: AuditPage[] };

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
      { name: 'Client body', path: `${CLIENT}/body` },
      { name: 'Client food', path: `${CLIENT}/food` },
      { name: 'Client documents', path: `${CLIENT}/documents` },
      { name: 'Client settings', path: `${CLIENT}/settings` },
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
    name: 'account and sign-in',
    pages: [
      { name: 'Profile', path: '/profile' },
      { name: 'Help', path: '/help' },
    ],
    signedOut: [{ name: 'Sign in', path: '/sign-in' }],
  },
];

const SIZES: { size: Size; use: { viewport: { width: number; height: number }; isMobile: boolean; hasTouch: boolean } }[] = [
  { size: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { size: 'tablet', use: { viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true } },
  { size: 'desktop', use: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false } },
];

/** axe runs on these sizes only (the tablet adds little and costs time). */
const AXE_SIZES: Size[] = ['phone', 'desktop'];

const applies = (e: { pages: string[] | '*'; sizes?: Size[] }, page: string, size: Size) =>
  (e.pages === '*' || e.pages.includes(page)) && (!e.sizes || e.sizes.includes(size));

const entryId = (e: UiAllow | AxeAllow) => `${e.rule} | ${e.pages === '*' ? '*' : e.pages.join(', ')} | ${e.selector ?? '(page)'}`;

type Found = { rule: string; detail: string };

/**
 * Runs in the page. Returns the problems found and which allow-list entries (by index) excused something.
 * Self-contained: Playwright sends this function's source to the browser, so it can't use anything from outside.
 */
function auditInPage(args: { minTarget: number; allow: { i: number; rule: string; selector?: string }[] }) {
  const found: { rule: string; detail: string }[] = [];
  const used = new Set<number>();
  const W = innerWidth;

  const excused = (rule: string, ...els: Element[]) => {
    for (const a of args.allow) {
      if (a.rule !== rule) continue;
      if (!a.selector || els.some((el) => el.matches(a.selector!))) {
        used.add(a.i);
        return true;
      }
    }
    return false;
  };
  // A short way to point at an element: tag, its CSS module class names (unhashed) and its name.
  const describe = (el: Element) => {
    const classes = [...el.classList].map((c) => c.replace(/^.*?_(?=[a-zA-Z])/, '')).filter(Boolean).slice(0, 2);
    const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || el.getAttribute('name') || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    return `<${el.tagName.toLowerCase()}${classes.map((c) => ` _${c}`).join('')}>${name ? ` "${name}"` : ''}`;
  };
  type Box = { l: number; t: number; r: number; b: number };
  /** The part of the element the user can see (cut by scrolling/clipping parents and the screen's sides), or null. */
  const shown = (el: Element): Box | null => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
    if (el.closest('[inert]')) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return null; // visually hidden (screen-reader only)
    const box = { l: Math.max(rect.left, 0), t: rect.top, r: Math.min(rect.right, W), b: rect.bottom };
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const p = a.getBoundingClientRect();
        box.l = Math.max(box.l, p.left);
        box.t = Math.max(box.t, p.top);
        box.r = Math.min(box.r, p.right);
        box.b = Math.min(box.b, p.bottom);
      }
      if (s.position === 'fixed') break;
    }
    return box.r - box.l > 1 && box.b - box.t > 1 ? box : null;
  };
  /** The pinned bar (fixed or sticky) an element sits in: page content scrolling under a pinned bar is by design. */
  const pinnedIn = (el: Element): Element | null => {
    for (let a: Element | null = el; a; a = a.parentElement) {
      const p = getComputedStyle(a).position;
      if (p === 'fixed' || p === 'sticky') return a;
    }
    return null;
  };

  // hscroll
  const sw = document.scrollingElement!.scrollWidth;
  if (sw > W + 1 && !excused('hscroll')) found.push({ rule: 'hscroll', detail: `page is ${sw}px wide on a ${W}px screen` });

  // target + overlap
  const controls: { el: Element; box: Box; pin: Element | null }[] = [];
  const seen = new Set<Element>();
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary')) {
    // A field inside a label is tapped through its label, so the label is the target (label > input).
    const target = (el.matches('input, select, textarea') && el.closest('label')) || el;
    if (seen.has(target)) continue;
    seen.add(target);
    const box = shown(target);
    if (!box) continue;
    // Inline text links inside a sentence are exempt (WCAG 2.5.8 "inline" exception).
    if (target.matches('a') && target.closest('p') && getComputedStyle(target).display === 'inline') continue;
    controls.push({ el: target, box, pin: pinnedIn(target) });
    const r = target.getBoundingClientRect();
    if ((r.width < args.minTarget - 0.5 || r.height < args.minTarget - 0.5) && !excused('target', target)) {
      found.push({ rule: 'target', detail: `${describe(target)} is ${Math.round(r.width)}x${Math.round(r.height)} (min ${args.minTarget})` });
    }
  }
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!;
      const b = controls[j]!;
      if (a.pin !== b.pin || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.box.r, b.box.r) - Math.max(a.box.l, b.box.l);
      const h = Math.min(a.box.b, b.box.b) - Math.max(a.box.t, b.box.t);
      if (w > 2 && h > 2 && !excused('overlap', a.el, b.el)) {
        found.push({ rule: 'overlap', detail: `${describe(a.el)} overlaps ${describe(b.el)} by ${Math.round(w)}x${Math.round(h)}` });
      }
    }
  }

  // text
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const tiny = new Set<string>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent?.trim() || el.closest('script, style, noscript')) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size >= 12 || !shown(el) || excused('text', el)) continue;
    const line = `${describe(el)} is ${size}px`;
    if (!tiny.has(line)) found.push({ rule: 'text', detail: line });
    tiny.add(line);
  }

  // logo
  const logos = [...document.querySelectorAll('[role=img][aria-label="CalTracker"]')].filter((el) => shown(el)).length;
  if (logos !== 1 && !excused('logo')) found.push({ rule: 'logo', detail: `${logos} visible logos (want exactly 1)` });

  // heading
  const h1 = [...document.querySelectorAll('h1')].find((el) => shown(el));
  if (!h1) {
    if (!excused('heading')) found.push({ rule: 'heading', detail: 'no visible main heading (h1)' });
  } else {
    const r = h1.getBoundingClientRect();
    if ((r.top < 0 || r.bottom > innerHeight) && !excused('heading', h1)) {
      found.push({ rule: 'heading', detail: `${describe(h1)} is not on the first screen (top ${Math.round(r.top)})` });
    }
  }
  return { found, used: [...used] };
}

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
