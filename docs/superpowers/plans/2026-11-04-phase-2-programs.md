# Phase 2: Design Refresh and Programs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every phase-1 screen wears the CalTracker design system (sign-in first). A coach then builds workouts (straight sets, supersets/circuits, warm-up and drop sets) in a workspace library, arranges them into multi-week programs on a drag-and-drop grid, and assigns programs or single workouts to a client's calendar. The client sees that calendar (view-only) in the phone app.

**Architecture:** A new `packages/design-tokens` package is the single source of colours, type, radii and spacing. The web app turns it into CSS custom properties; the mobile app reads it through `useTheme()`. Workouts are relational rows: `workouts` → `workout_blocks` → `workout_exercises` → `workout_sets`. One set of tables holds both library templates (`client_id is null`) and client calendar instances (`client_id` + `scheduled_on`). Children inherit `workspace_id`/`client_id` from their parent through a trigger, so RLS policies (and later PowerSync sync rules) never need joins. Assignment is a `security definer` Postgres function that deep-copies templates into client-owned instances in one transaction. Builder editing logic is made of pure functions in `packages/shared`.

**Tech Stack:** Existing stack (Node 24, pnpm 10, Turborepo, TypeScript strict, Supabase + pgTAP, Next.js 16 App Router, Expo SDK 58 / Expo Router, Zod 4, Vitest 5, Playwright, Maestro). New: `@dnd-kit/core` (web drag-and-drop), `@expo-google-fonts/bricolage-grotesque`, `@expo-google-fonts/caveat`, `expo-font`, `expo-splash-screen`. The implementer installs current versions and pins them exactly, as phase 1 did.

**Spec:** `docs/superpowers/specs/2026-11-03-coaching-app-design.md` (Section 15 item 2; Section 4 Workouts, Programs, Assignment; constraints from Sections 3, 5, 6 Units, 10, 11, 12) and `docs/superpowers/specs/2026-11-03-design-system-design.md` (Sections 2–5, 9, 10). Approved mockups: `docs/design/mockups/*.html`. Conventions follow `docs/superpowers/plans/2026-11-03-phase-1-foundation.md`.

## Global Constraints

- TypeScript `strict`; no `any` without a comment explaining why. Run typecheck, lint and all tests, and show the output before calling any task done.
- Database changes only through new files in `supabase/migrations/` (timestamps `20261104000100` onward). Never edit an applied migration.
- Every new table: RLS enabled; explicit `revoke all … from anon, authenticated, service_role`, then least-privilege column grants to `authenticated` and `select, insert, update, delete` to `service_role` (hosted "auto-expose" is off). pgTAP proves anon gets 42501, other workspaces can't get in, and other clients can't get in. New tables are added to `supabase/tests/service_role_grants.test.sql`.
- `security definer` functions use `set search_path = ''`, `revoke execute … from public, anon`, and check authorization explicitly at the top.
- After every migration: `pnpm db:reset && pnpm db:types`. CI diffs the generated `packages/shared/src/database.types.ts`.
- Volume, PR, streak, badge and **unit** logic lives only in `packages/shared` as pure tested functions. Apps never convert kg/lb themselves.
- Tracking types are exactly `weight_reps`, `reps`, `time`, `distance`. Set types are exactly `normal`, `warmup`, `drop`. A `drop` set is attached to the preceding non-drop set of the same exercise. A drop has optional targets (or "to failure") and no rest timer (`rest_seconds = 0`).
- Weights are stored in kg (`numeric(7,3)`), durations in seconds, distances in metres. Display converts using the viewer's `profiles.units` (`kg` | `lb`).
- Assignment **copies** workouts. Editing or deleting a template never changes existing client calendars. Editing a client's workout never changes the template.
- Calendar dates are plain `YYYY-MM-DD` (`date` in SQL, `IsoDate` string in TS). Date maths never goes through `Date` in local time. "Today" is computed in the viewer's browser or device, never on the server (Workers run in UTC).
- Sync-readiness for phase 3 (PowerSync, not built now): UUID primary keys (client-generatable), `updated_at` maintained by trigger on every new table, `workspace_id` (and `client_id` on instance rows) denormalized onto every row. Hard deletes, no soft-delete columns.
- Not in Version 1 (do not build): AMRAP/EMOM/interval blocks, %-of-max/RPE prescriptions, automatic progression, video uploads, session booking. Also out of this phase: workout logging and the Start button (phase 3), ⌘K search, coach home tiles.
- Design: components read colours only through tokens (`--ct-*` on web, `useTheme()` on mobile). Light-only. Text on pastel tiles is always `ink` `#121212`, never muted. At most one handwritten note per screen, with real text (screen readers read it). Tap targets ≥ 44 pt.
- Hosting stays portable: no Cloudflare/Vercel-specific APIs. Fonts via `next/font/google` (self-hosted at build).
- Git: branches `feature/phase-2-design-refresh` (Tasks 1–6) and `feature/phase-2-programs` (Tasks 7–19), cut from `main`. Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push or open PRs only when the product owner asks.

## Review Focus

1. **Template edited after assignment.** The coach changes "Upper A" in the library (or in the program) after assigning it. Clients' calendars must not change. Editing one client's copy must not touch the library. (Tests in Tasks 13 and 16.)
2. **Pounds round trip.** A coach using lb types 135 lb. It must show as 135 lb when reopened (not 134.99), and as 61.2 kg to a kg client. (Tests in Tasks 7 and 14.)
3. **Time zones and calendar edges.** A coach in Los Angeles at 9 pm, or a client in Auckland, sees "today" as their own local date. Program dates that cross DST changes, month ends and year ends land on the right days. (Tests in Tasks 7 and 16.)
4. **Double-clicked or retried assignment.** Clicking Assign twice, or a network retry, must not put two copies of a 12-week program on the calendar. (Tests in Tasks 13 and 16.)
5. **Removing something still in use.** Deleting a library workout that programs use, deleting a custom exercise that workouts use, or shrinking a program from 6 to 4 weeks while weeks 5–6 hold workouts: each needs a clear warning or refusal, never a crash or a silent half-delete. (Tests in Tasks 10, 12 and 15.)

---

## File Structure

```
packages/design-tokens/                 NEW @caltracker/design-tokens
  src/colors.ts                         ColorToken, colors.light
  src/typography.ts                     fontFamilies, typeScale
  src/scale.ts                          space, radius, borderWidth, shadow, buttonBase, tapTarget
  src/contrast.ts                       contrastRatio, CONTRAST_PAIRS
  src/css.ts                            toCssVariables
  src/index.ts
  test/{contrast,css,tokens}.test.ts

packages/shared/src/
  units/units.ts                        kg/lb + m/km/mi conversion and formatting
  dates/dates.ts                        IsoDate maths, week/month ranges, program day → date
  workouts/schema.ts                    WorkoutDoc Zod schema + rules
  workouts/drop-sets.ts                 groupDropSets, setLabels
  workouts/targets.ts                   TARGET_FIELDS, formatSetTarget, formatRest
  workouts/doc-ops.ts                   pure builder edits
  workouts/tree.ts                      WORKOUT_TREE_SELECT, WorkoutTreeRow, workoutRowToDoc
  programs/schema.ts                    ProgramInput, AssignProgramInput, ScheduleWorkoutInput

supabase/migrations/
  20261104000100_workouts.sql           workouts + blocks + exercises + sets, helpers, RLS
  20261104000200_save_workout.sql       save_workout(ws, doc)
  20261104000300_programs.sql           programs, program_workouts, RLS
  20261104000400_assignments.sql        program_assignments, copy/assign/schedule/unassign
supabase/tests/
  00_helpers.sql                        + create_exercise, create_workout
  workouts_rls.test.sql, save_workout.test.sql, programs_rls.test.sql, assignments.test.sql

apps/web/src/
  app/layout.tsx, app/globals.css       fonts, tokens, base styles
  components/ui/*                       Button, TextField, Card, Tile, Chip, HandNote, Logo, AuthShell
  components/workout-builder/*          WorkoutBuilder (library + client instance)
  components/calendar/*                 MonthCalendar
  app/(coach)/layout.tsx                sidebar shell
  app/(coach)/workouts/**               library list + builder pages + actions
  app/(coach)/programs/**               list + grid builder + actions
  app/(coach)/clients/[clientId]/**     client page, calendar, assign, instance editor
  styles.test.ts                        no raw colours outside tokens
  e2e/{branding,workouts,programs,calendar}.spec.ts

apps/mobile/src/
  theme/{theme.ts,typography.ts,use-theme.ts,fonts.ts}
  components/ui/*                       Button, TextField, Card, HandNote, Logo, Screen
  app/(app)/(tabs)/{_layout,today,workouts}.tsx
  app/(app)/workout/[id].tsx            read-only workout detail
  lib/workouts.ts                       calendar + detail queries
  .maestro/calendar.yaml
```

---

## Part A: Design refresh (branch `feature/phase-2-design-refresh`)

### Task 1: `packages/design-tokens`

**Files:**
- Create: `packages/design-tokens/{package.json,tsconfig.json,vitest.config.ts}`, `src/{colors,typography,scale,contrast,css,index}.ts`, `test/{tokens,contrast,css}.test.ts`

**Interfaces:**
- Produces (package `@caltracker/design-tokens`, `exports "." → ./src/index.ts`, scripts `typecheck`/`lint`/`test` like `packages/shared`):
  - `type ColorToken = 'bg'|'surface'|'surfaceSidebar'|'border'|'ink'|'inkMuted'|'lime'|'pink'|'blue'|'drop'|'magenta'|'magentaDeep'|'amber'|'celebrateBg'|'tape'`
  - `colors: { light: Record<ColorToken, string> }`, `type ThemeName = keyof typeof colors`. Values are copied verbatim from design spec §2; `inkMuted = 'rgba(18, 18, 18, 0.6)'`.
  - `fontFamilies = { sans: 'Bricolage Grotesque', hand: 'Caveat' } as const`
  - `type TypeRole = 'screenTitle'|'bigNumber'|'sectionHeading'|'body'|'caption'|'button'|'hand'`; `typeScale: Record<TypeRole, { family: 'sans'|'hand'; weight: 500|700|800; size: { phone: number; tablet: number; web: number }; trackingEm?: number; rotateDeg?: number; muted?: boolean; tabular?: boolean }>`. Values: screenTitle 800, 22/24/24, −0.02. bigNumber 800, 26/26/26, tabular. sectionHeading 700, 16/16/16. body 500, 15. caption 500, 12, muted. button 800, 15/16/16, +0.03. hand 700 Caveat, 20/20/20, rotate −3.
  - `space = { 1: 4, 2: 8, 2.5: 10, 3: 12, 3.5: 14, 4: 16, 4.5: 18, 6: 24 }` (4-pt grid, keys = multiples of 4)
  - `radius = { input: 12, button: 16, card: 20, pill: 999 }`, `borderWidth = { card: 2, secondaryButton: 1.5 }`, `buttonBase = 4`, `pressDepth = 2`
  - `shadow = { sticker: '0 2px 6px rgba(0,0,0,.2)' }`, `stickerRing = 3`
  - `tapTarget = { min: 44, logging: 54 }`, `buttonMinHeight = { phone: 48, tablet: 52, web: 48 }`, `breakpoints = { tablet: 600, split: 1000, webSidebarCollapse: 900 }`
  - `contrastRatio(fg: string, bg: string): number`: WCAG 2.x relative luminance. Accepts `#RRGGBB`, `#FFF` and `rgba()`. An alpha foreground is blended onto `bg` first.
  - `CONTRAST_PAIRS: ReadonlyArray<{ fg: ColorToken | 'white'; bg: ColorToken; min: number; use: string }>`
  - `toCssVariables(theme?: ThemeName): string`: returns one `:root{…}` rule. Colour names are kebab-case `--ct-<token>` (`--ct-surface-sidebar`, `--ct-ink-muted`, `--ct-magenta-deep`, `--ct-celebrate-bg`). Also `--ct-radius-{input,button,card,pill}`, `--ct-space-{1,2,2-5,3,3-5,4,4-5,6}` in px, `--ct-shadow-sticker`, and `--ct-size-<role>` using the `web` size in px.

- [ ] **Step 1: Write failing tests.**
  - `tokens.test.ts`: every hex in design spec §2 matches (`colors.light.lime === '#C8F169'`, `magentaDeep === '#B32C6C'`, … all 15 tokens).
  - `contrast.test.ts`: `contrastRatio('#121212', '#FFFFFF')` ≈ 18.73 (±0.01). Every `CONTRAST_PAIRS` entry passes its `min`. The pairs list must include: ink on bg/surface/surfaceSidebar ≥ 15. ink on lime/pink/blue/drop/celebrateBg/tape ≥ 12. inkMuted on bg/surface/surfaceSidebar ≥ 4.5. white on ink ≥ 15. magenta on bg ≥ 3 (large text only). white on magenta ≥ 3. A documenting test asserts `contrastRatio(colors.light.inkMuted, colors.light.pink) < 4.5`, which is why captions on pastel tiles use `ink`.
  - `css.test.ts`: `toCssVariables()` starts with `:root{`. It contains `--ct-lime:#C8F169;`, `--ct-surface-sidebar:#F6F6F4;`, `--ct-radius-card:20px;` and `--ct-size-screen-title:24px;`. It contains no `undefined`.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/design-tokens test` → FAIL (package missing).
- [ ] **Step 3: Implement the package** with the signatures above. Add it to `apps/web` and `apps/mobile` dependencies as `workspace:*`.
- [ ] **Step 4: Run** `pnpm install && pnpm check` → PASS.
- [ ] **Step 5: Commit** `feat(design-tokens): add design token package with contrast checks`

---

### Task 2: Web theme foundation and branded sign-in (highest priority)

**Files:**
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/(auth)/sign-in/{page.tsx,sign-in-form.tsx,sign-in.module.css}`
- Create: `apps/web/src/components/ui/{button,text-field,card,tile,chip,hand-note,logo,auth-shell}.tsx` + `ui.module.css`, `apps/web/src/styles.test.ts`, `apps/web/e2e/branding.spec.ts`

**Interfaces:**
- Consumes: `toCssVariables`, tokens (Task 1).
- Produces (web UI kit, used by every later web task):
  - `<Button variant?: 'primary'|'secondary'|'finish' (default primary) pending?: boolean …ButtonHTMLAttributes>`. `pending` sets `disabled` and `aria-busy`. Primary: ink fill, white label, `box-shadow: 0 var(--ct-base) 0 var(--ct-lime)`, radius 16, min-height 48. `:active` moves down 2 px with a 2 px base. Secondary: 1.5 px ink outline, transparent. Finish: magenta fill, magenta-deep base, label ≥ 19 px/800.
  - `<TextField label: string; error?: string; hint?: string …InputHTMLAttributes>`. A `<label>` wraps the input, so `getByLabel(label)` keeps working. `surface` fill, radius 12, 2 px transparent border that turns ink on focus. Errors use `role="alert"`, in ink with a magenta ⚠ marker (never colour alone).
  - `<Card>`: white, 2 px `border`, radius 20. `<Tile tone: 'lime'|'pink'|'blue'|'grey' label value>`: caption in ink. `<Chip tone>`.
  - `<HandNote>{text}</HandNote>`: Caveat 700, magenta, 20 px, rotated −3°, real text.
  - `<Logo size?: 'md'|'lg'>`: `Cal` on a lime pill + `Tracker`, as in `coach-dashboard.html` `.logo`. Wrapped in an element with `aria-label="CalTracker"`.
  - `<AuthShell title: string; note?: string; children>`: at ≥ 900 px, a two-column page. The left panel has a `lime` background, `<Logo size="lg">` and the tagline "Build programs. Log sessions. Celebrate every PR." The right column holds a `<Card>` with an `h1` title, the optional `HandNote` and the children. Below 900 px it is a single column: logo on top, then the card, with a 16 px gutter.
- Root layout: `Bricolage_Grotesque({ subsets:['latin'], weight:['500','700','800'], variable:'--ct-font-sans' })` and `Caveat({ subsets:['latin'], weight:'700', variable:'--ct-font-hand' })` on `<html>`. Add `<style id="ct-tokens">{toCssVariables()}</style>` in `<head>` and `<meta name="color-scheme" content="light">`.
- `globals.css`: only `var(--ct-*)`. Body uses Bricolage 500 15 px on `--ct-bg`. Focus ring is a 2 px ink outline with 2 px offset. Under `prefers-reduced-motion`, the press transform is removed.

- [ ] **Step 1: Write failing tests.**
  - `e2e/branding.spec.ts`, "sign-in page is branded": on `/sign-in`, `getByLabel('CalTracker')` is visible. `getComputedStyle(documentElement).getPropertyValue('--ct-lime').trim()` is `'#C8F169'`. Body `fontFamily` contains `Bricolage`. The Sign in button's background is `rgb(18, 18, 18)` and its `boxShadow` contains `rgb(200, 241, 105)`. The text "Welcome back, coach!" is visible.
  - `src/styles.test.ts`: scans `src/**/*.css` for `/#[0-9a-fA-F]{3,8}\b|rgba?\(/`. It fails on any match, except files listed in `const PENDING_RESTYLE = [...]`, which starts with the clients and exercises CSS modules. A second assertion fails when a listed file no longer contains raw colours ("remove it from PENDING_RESTYLE"), so the list can only shrink.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:e2e -- branding` → FAIL.
- [ ] **Step 3: Implement** the layout, globals, UI kit and sign-in on `AuthShell`: title "Sign in", note "Welcome back, coach!". Keep the existing labels, button name, error copy and the `?error=link` alert.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:e2e` → PASS. Existing `sign-in.spec.ts` is unchanged and green.
- [ ] **Step 5: Screenshot check:** `pnpm --filter web dev`. Capture `/sign-in` at 1280×800 and 390×844 and compare by eye with the mockup palette. No horizontal scroll at 390 px.
- [ ] **Step 6: Commit** `feat(web): add design tokens, fonts and UI kit; restyle sign-in`

---

### Task 3: Web: restyle the other auth pages and the invite page

**Files:**
- Modify: `apps/web/src/app/(auth)/forgot-password/*`, `(auth)/set-password/*`, `app/auth/confirm/page.tsx`, `app/not-a-coach/page.tsx`, `app/invite/[token]/{page.tsx,invite.module.css}`
- Test: `apps/web/e2e/branding.spec.ts` (extend)

**Interfaces:**
- Consumes: `AuthShell`, `Button`, `TextField`, `Card`, `Logo`, `HandNote` (Task 2).

- [ ] **Step 1: Extend `branding.spec.ts`** with a loop over `/forgot-password`, `/set-password`, `/auth/confirm` (no token: its error state), `/not-a-coach` (signed in as `client@demo.local`) and `/invite/not-a-real-token`. Each must show `getByLabel('CalTracker')`, have a Bricolage body font, and have no element whose computed `color` is `rgb(176, 0, 32)` (the old `#b00020`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Restyle** each page on `AuthShell`. Keep all existing headings, labels, button names and messages, because `set-password.spec.ts`, `invite-page.spec.ts` and the forgot-password tests assert them. The invite page shows the coach's workspace name in the card title and the note "Let's get moving!" in the valid state only (one note per screen). Expired, accepted and not-found states use the same shell without a note.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(web): restyle password, confirm, not-a-coach and invite pages`

---

### Task 4: Web: coach sidebar shell and Clients page

**Files:**
- Modify: `apps/web/src/app/(coach)/{layout.tsx,coach.module.css}`, `(coach)/clients/*.tsx`, `clients.module.css`, `apps/web/src/styles.test.ts` (shrink `PENDING_RESTYLE`)
- Create: `apps/web/src/app/(coach)/nav-link.tsx` (client component, `usePathname` for the active state)
- Test: `apps/web/e2e/branding.spec.ts` (extend)

**Interfaces:**
- Produces: the coach shell, a 190 px `surface-sidebar` column with `Logo`, workspace name (caption) and nav: **Clients, Workouts, Programs, Exercises**. The active item is an ink fill with white text, radius 12 (per `coach-dashboard.html`). Sign out sits at the bottom. Below 900 px the sidebar collapses to a 56 px icon rail with `aria-label`s. Tasks 14–16 add the Workouts and Programs routes, which 404 until then.

- [ ] **Step 1: Extend the test:** on `/clients`, the nav link "Clients" has `aria-current="page"` and background `rgb(18, 18, 18)`. The page has `--ct-*`-driven card borders. Existing `clients.spec.ts` stays green.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the shell. Restyle the Clients page: a title row, the add-client form and CSV upload in a `Card`, and the clients/invites lists as rows with pastel initials avatars (radius 999). Statuses become `Chip`s: pending = grey, expired = amber outline + text "Expired", with another coach = pink. All existing copy is kept. Remove `clients.module.css` from `PENDING_RESTYLE`.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(web): add coach sidebar shell and restyle clients page`

---

### Task 5: Web: restyle the exercise library

**Files:**
- Modify: `apps/web/src/app/(coach)/exercises/**/*.tsx`, `exercises.module.css`, `apps/web/src/styles.test.ts` (`PENDING_RESTYLE` becomes `[]`)

- [ ] **Step 1: Extend `branding.spec.ts`:** `/exercises` shows the search field via `getByLabel` (existing label), and tracking-type filters render as chips with `aria-pressed`. Existing `exercises.spec.ts` stays green.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Restyle** the list (cards with thumbnail, name, tracking-type chip), detail (override form in a `Card`, "Watch form on YouTube" as a secondary `Button`) and new-exercise form with the UI kit. Copy is unchanged. Empty `PENDING_RESTYLE`.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:e2e` → PASS. `styles.test.ts` now forbids raw colours in all web CSS.
- [ ] **Step 5: Commit** `feat(web): restyle exercise library`

---

### Task 6: Mobile theme, fonts and restyled auth screens

**Files:**
- Create: `apps/mobile/src/theme/{theme.ts,typography.ts,use-theme.ts,fonts.ts}`, `apps/mobile/src/theme/typography.test.ts`, `apps/mobile/src/theme/no-raw-colours.test.ts`, `apps/mobile/src/components/ui/{button,text-field,card,hand-note,logo,screen}.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx` (load fonts, hold splash), `(auth)/{sign-in,sign-up,check-email}.tsx`, `auth/confirmed.tsx`, `(app)/home.tsx`, `app.json` (`expo-font` plugin with the four font files), `package.json`
- Delete: `apps/mobile/src/lib/styles.ts`

**Interfaces:**
- Consumes: `@caltracker/design-tokens`.
- Produces:
  - `fonts.ts`: `FONT_ASSETS` (for `useFonts`) and `fontFamilyFor(family: 'sans'|'hand', weight: 500|700|800): string` → `'BricolageGrotesque_500Medium' | 'BricolageGrotesque_700Bold' | 'BricolageGrotesque_800ExtraBold' | 'Caveat_700Bold'`.
  - `typography.ts`: `textStyle(role: TypeRole, device: 'phone'|'tablet'): TextStyle`, which is pure. It returns `fontFamily`, `fontSize` and `letterSpacing = trackingEm × fontSize`. Muted roles get colour `inkMuted`, hand gets colour `magenta` and `transform: [{ rotate: '-3deg' }]`, and tabular roles get `fontVariant: ['tabular-nums']`.
  - `use-theme.ts`: `useTheme(): { colors: Record<ColorToken,string>; text: (role: TypeRole) => TextStyle; space; radius; device: 'phone'|'tablet' }`. `device` is `'tablet'` when `useWindowDimensions().width >= 600`. Always the light theme in V1.
  - UI: `<Button title variant?: 'primary'|'secondary'|'finish' onPress testID? disabled?>`. Primary has an ink fill and a 4 px lime base view underneath, and moves down 2 px when pressed (fades instead under Reduce Motion via `AccessibilityInfo.isReduceMotionEnabled`). Min height 48 on phone, 52 on tablet. `<TextField label testID …TextInputProps>` has a visible label and `accessibilityLabel={label}`. Also `<Card>`, `<HandNote>`, `<Logo>`, and `<Screen>` (safe-area, `bg`, 16 px gutter, `KeyboardAvoidingView`).

- [ ] **Step 1: Write failing tests.**
  - `typography.test.ts`: `textStyle('screenTitle','phone')` deep-equals `{ fontFamily: 'BricolageGrotesque_800ExtraBold', fontSize: 22, letterSpacing: -0.44, color: '#121212' }`. `textStyle('screenTitle','tablet').fontSize === 24`. `textStyle('hand','phone')` has `fontFamily: 'Caveat_700Bold'`, `color: '#E0408A'` and `transform: [{ rotate: '-3deg' }]`. `textStyle('caption','phone').color === 'rgba(18, 18, 18, 0.6)'`.
  - `no-raw-colours.test.ts`: scans `src/**/*.{ts,tsx}` outside `src/theme/` for quoted `'#[0-9a-fA-F]{3,8}'` or `rgba?\(` and fails on any match.
- [ ] **Step 2: Run** `pnpm --filter mobile test` → FAIL.
- [ ] **Step 3: Implement** the theme and UI kit. In the root layout, call `SplashScreen.preventAutoHideAsync()` and render nothing until `useFonts(FONT_ASSETS)` resolves. If font loading fails, continue with system fonts rather than hanging. Restyle every screen. Sign-in shows `Logo`, title "Sign in" and the note "Let's train!". Keep **every `testID` and every visible string** the Maestro flows assert (`'Ask your coach for an invite'`, `'Welcome to Demo Coaching'`, `'We sent a link to …'`, `Check again`, `Sign out`, `Not Now` handling). Links become ink, underlined text buttons, not blue.
- [ ] **Step 4: Run** `pnpm --filter mobile test && pnpm check`, then `pnpm --filter mobile e2e` (all four Maestro flows) → PASS.
- [ ] **Step 5: Manual check** on the iOS simulator: sign-in and sign-up at default text size and at the largest Dynamic Type size. The layout reflows (scrolls) and does not truncate.
- [ ] **Step 6: Commit** `feat(mobile): add theme, bundled fonts and restyle auth screens`
- [ ] **Step 7: Checkpoint (product owner).** Tell the product owner that the design refresh is complete. Ask whether to push and open a PR so it merges and deploys to staging now (they can then check the branded login on `staging.caltracker.app` and in Expo Go). PR description per CLAUDE.md, including "try on your phone: sign in / sign up screens".

---

### Task 6b: First and last name (product owner request, 2026-11-04)

The product owner asked for a separate last name when inviting clients. Today there is one `full_name` field everywhere.

**Files:**
- Create: `supabase/migrations/<timestamp>_first_last_name.sql`, `supabase/tests/<n>_first_last_name.test.sql`
- Modify: `packages/shared/src/invites/{schema.ts,csv.ts}` (+ tests), `packages/shared/src/database.types.ts` (regenerated), `apps/web/src/app/(coach)/clients/{add-client-form.tsx,csv-upload.tsx,page.tsx,resend-button.tsx}`, `supabase/functions/send-invite/index.ts` (+ tests), `apps/mobile/src/app/(auth)/sign-up.tsx`, `scripts/provision-coach.ts` (+ tests), affected e2e and Maestro flows

**Decisions:**
- `profiles` and `client_invites` get `first_name text not null default ''` and `last_name text not null default ''`. `full_name` stays as a generated column (`trim(first_name || ' ' || last_name)`) so existing reads keep working. Backfill: split existing `full_name` on the first space.
- The `handle_new_user` trigger reads `first_name`/`last_name` from user metadata and falls back to splitting `full_name`. Column grants mirror today's `full_name` grants.
- First name is required. Last name is optional (some people use one name), max 100 characters each.
- CSV accepts `First name` + `Last name` columns (also `first_name`/`last_name`/`Given name`/`Surname`), or the old single `Name` column (split on the first space). Everfit exports use separate columns, so test with that header shape.
- Emails greet by first name ("Hi Parv"). Lists sort by last name, then first name.

- [ ] **Step 1: Write failing tests:** pgTAP (backfill split, generated full_name, grants, RLS unchanged), shared CSV tests (both header shapes, single-name row, last name empty), schema tests.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the migration, shared parsing and validation, the web form (two fields side by side), the CSV preview columns, send-invite greeting, mobile sign-up (two fields) and provision-coach (`--first-name`/`--last-name`; the deploy workflow inputs become `coach_first_name`/`coach_last_name`).
- [ ] **Step 4: Run** `pnpm check`, `pnpm db:test`, function tests, integration and e2e → PASS.
- [ ] **Step 5: Commit** `feat: split client and coach names into first and last name`

---

## Part B: Programs (branch `feature/phase-2-programs`, from `main` after Part A merges)

### Task 7: Shared units and calendar dates

**Files:**
- Create: `packages/shared/src/units/units.ts`, `packages/shared/src/dates/dates.ts`, `packages/shared/test/units/units.test.ts`, `packages/shared/test/dates/dates.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/package.json` (test script runs twice: `vitest run && TZ=Pacific/Auckland vitest run`)

**Interfaces:**
- Produces:
  - `type Units = 'kg' | 'lb'`. `KG_PER_LB = 0.45359237`. `M_PER_MILE = 1609.344`.
  - `toKg(value: number, unit: Units): number`: rounded to 3 decimals, matching `numeric(7,3)`.
  - `fromKg(kg: number, unit: Units): number`: rounded to 1 decimal.
  - `formatWeight(kg: number, unit: Units): string` → `'60 kg'`, `'135 lb'`, `'61.2 kg'`, with trailing `.0` dropped.
  - `type DistanceUnit = 'km' | 'mi'`. `distanceUnitFor(units: Units): DistanceUnit` (kg → km, lb → mi). `toMeters(value: number, unit: DistanceUnit): number` is rounded to 2 decimals. `formatDistance(m: number, units: Units): string`: values below 1000 m show `'400 m'` (kg users). Otherwise `'5 km'` / `'3.11 mi'` (2 decimals max, trailing zeros dropped).
  - `formatDuration(seconds: number): string` → `'45 s'`, `'1:30'`, `'1:00:00'`.
  - `type IsoDate = string` (`YYYY-MM-DD`) and `IsoDateSchema` (Zod, also rejects `2026-02-30`).
  - `addDays(d: IsoDate, n: number): IsoDate`, `diffDays(a: IsoDate, b: IsoDate): number`, `isoWeekday(d: IsoDate): 1..7` (Mon = 1), `startOfWeek(d: IsoDate): IsoDate` (Monday), `monthGrid(month: 'YYYY-MM'): IsoDate[][]` (Monday-first weeks covering the month, 4–6 rows), `localToday(timeZone?: string): IsoDate` (`Intl.DateTimeFormat('en-CA', { timeZone })`). All maths is UTC-based integer day arithmetic.
  - `programDayToDate(start: IsoDate, week: number, day: number): IsoDate` = `addDays(start, (week - 1) * 7 + (day - 1))`. `programEndDate(start: IsoDate, weeks: number): IsoDate` = `addDays(start, weeks * 7 - 1)`.

- [ ] **Step 1: Write failing tests.**
  - units: `fromKg(toKg(135,'lb'),'lb') === 135`. `toKg(135,'lb') === 61.235`. `formatWeight(61.235,'kg') === '61.2 kg'`. `formatWeight(60,'kg') === '60 kg'`. Round trips are exact for every integer 1..1000 lb and every 0.5 step 0.5..500 kg (loop). `toMeters(5,'km') === 5000`. `formatDistance(5000,'lb') === '3.11 mi'`. `formatDistance(400,'kg') === '400 m'`. `formatDuration(90) === '1:30'`.
  - dates: `addDays('2026-12-31',1) === '2027-01-01'`. `addDays('2028-02-28',1) === '2028-02-29'`. `programDayToDate('2026-03-28',1,2) === '2026-03-29'` (EU DST) and `programDayToDate('2026-03-07',2,2) === '2026-03-15'` (US DST). `programEndDate('2026-11-09',4) === '2026-12-06'`. `isoWeekday('2026-11-09') === 1`. `monthGrid('2026-11')` has 6 rows, starts `'2026-10-26'` and ends `'2026-12-06'`. `localToday('Pacific/Auckland')` and `localToday('America/Los_Angeles')` for a mocked instant `2026-11-04T08:30:00Z` give `'2026-11-04'` and `'2026-11-04'`. At `2026-11-04T11:30:00Z` they give `'2026-11-05'` and `'2026-11-04'` (`vi.setSystemTime`). `IsoDateSchema.safeParse('2026-02-30').success === false`.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS under both time zones.
- [ ] **Step 5: Commit** `feat(shared): add unit conversion and calendar date helpers`

---

### Task 8: Shared workout document: schema, drop sets, targets

**Files:**
- Create: `packages/shared/src/workouts/{schema,drop-sets,targets}.ts`, `packages/shared/test/workouts/{schema,drop-sets,targets}.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `TrackingType`, `Units`, formatters (Task 7).
- Produces:
  - `SET_TYPES = ['normal','warmup','drop'] as const`, `type SetType`. `BLOCK_KINDS = ['straight','superset'] as const`, `type BlockKind`.
  - `WorkoutSetDoc = z.object({ id: uuid, setType, targetRepsMin: int 1..1000 | null, targetRepsMax: int 1..1000 | null, targetWeightKg: number 0..1000 | null, targetDurationS: int 1..86400 | null, targetDistanceM: number >0..1_000_000 | null, toFailure: boolean, restSeconds: int 0..3600, note: string ≤500 | null })`
  - `WorkoutExerciseDoc = z.object({ id: uuid, exerciseId: uuid, exerciseName: string, trackingType: TrackingType, note: string ≤500 | null, sets: WorkoutSetDoc[] 1..20 })`. `exerciseName`/`trackingType` are display and validation fields only and are not written by `save_workout`.
  - `WorkoutBlockDoc = z.object({ id: uuid, kind: BlockKind, exercises: WorkoutExerciseDoc[] 1..10 })`
  - `WorkoutDoc = z.object({ id: uuid, name: string trim 1..100, notes: string ≤2000 | null, blocks: WorkoutBlockDoc[] 1..30 })` with `superRefine` rules and these exact messages:
    - straight with ≠1 exercise → `'A straight-sets block has exactly one exercise.'`
    - superset with <2 → `'A superset needs at least two exercises.'`
    - first set is `drop` → `'A drop set must follow a normal or warm-up set.'`
    - superset exercises with different counts of non-drop sets → `'Every exercise in a superset needs the same number of rounds.'`
    - `targetRepsMin > targetRepsMax` → `'Minimum reps can't be more than maximum reps.'`
    - a target that isn't valid for the tracking type is non-null → `'<field> doesn't apply to <tracking type label>.'`
    - `toFailure` on a non-drop set → `'Only drop sets can be "to failure".'`
    - a drop with `restSeconds ≠ 0` is **transformed** to 0 (drops have no rest timer)
    - no blocks → `'Add at least one exercise.'`
    - Issue `path`s point at the offending field so the builder can show errors inline.
  - `groupDropSets<T extends { setType: SetType }>(sets: readonly T[]): Array<{ set: T; drops: T[] }>`: throws `Error('A drop set must follow a normal or warm-up set.')` on a leading drop.
  - `setLabels(sets: readonly { setType: SetType }[]): string[]`: warm-ups `'W'`, normal sets numbered `'1'`, `'2'`… (warm-ups and drops don't count), drops `'↳'`.
  - `TARGET_FIELDS: Record<TrackingType, ReadonlyArray<'reps'|'weight'|'duration'|'distance'>>` = `{ weight_reps: ['reps','weight'], reps: ['reps'], time: ['duration'], distance: ['distance'] }`
  - `formatSetTarget(set: WorkoutSetDoc, trackingType: TrackingType, units: Units): string` → `'8 reps · 60 kg'`, `'8–10 reps · 135 lb'`, `'45 s'`, `'5 km'`, `'To failure'`, and `'—'` when no targets are set.
  - `formatRest(seconds: number): string` → `'Rest 1:30'`, or `''` for 0.

- [ ] **Step 1: Write failing tests** covering each rule and message above with minimal fixtures. Also: a valid doc with a straight block (warm-up, 3 normal, 1 drop after set 3) and a 2-exercise × 3-round superset parses. `groupDropSets([n, d, d, n, d])` gives two groups with 2 and 1 drops. `setLabels([w, n, n, d, n])` deep-equals `['W','1','2','↳','3']`. `formatSetTarget` gives `'8–10 reps · 135 lb'` for min 8, max 10, 61.235 kg in lb, and `'8 reps · 60 kg'` when min equals max.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(shared): add workout document schema, drop-set grouping and target formatting`

---

### Task 9: Shared builder operations

**Files:**
- Create: `packages/shared/src/workouts/doc-ops.ts`, `packages/shared/test/workouts/doc-ops.test.ts`

**Interfaces:**
- Consumes: `WorkoutDoc` and its parts (Task 8).
- Produces (pure and immutable; every op takes `makeId: () => string` where it creates rows, so React Native and tests stay deterministic):
  - `emptyWorkout(makeId, name?: string): WorkoutDoc` (zero blocks; the builder starts here and the schema rejects saving it empty)
  - `type ExercisePick = { id: string; name: string; trackingType: TrackingType }`
  - `addStraightBlock(doc, ex: ExercisePick, makeId)`: 3 normal sets with null targets and `restSeconds: 90`
  - `addSuperset(doc, exs: ExercisePick[] /* ≥2 */, makeId)`: 3 rounds. Rest 0 on every exercise except the last, which gets 90 (rest per round).
  - `addExerciseToSuperset(doc, blockId, ex, makeId)`: matches the current round count
  - `removeBlock(doc, blockId)`, `moveBlock(doc, blockId, toIndex)`, `removeExercise(doc, blockId, workoutExerciseId)`. Removing the second-to-last exercise of a superset turns the block into `straight`.
  - `addSet(doc, blockId, workoutExerciseId, makeId)`: appends a `normal` set that copies the targets/rest of the last non-drop set
  - `addRound(doc, blockId, makeId)` / `removeRound(doc, blockId)`: superset only. Acts on every exercise at once, keeping the rest-per-round rule.
  - `addDrop(doc, blockId, workoutExerciseId, parentSetId, makeId)`: inserts after the parent's existing drops, with `restSeconds: 0` and null targets
  - `removeSet(doc, blockId, workoutExerciseId, setId)`: removing a parent also removes its drops. If the parent is the last non-drop set, it is a no-op (an exercise keeps ≥ 1 set).
  - `updateSet(doc, blockId, workoutExerciseId, setId, patch: Partial<Omit<WorkoutSetDoc,'id'>>)`
  - `replaceExercise(doc, blockId, workoutExerciseId, ex)`: nulls targets not in `TARGET_FIELDS[ex.trackingType]`

- [ ] **Step 1: Write failing tests**, one per op, using a counter-based `makeId`. Key cases: `addDrop` twice after set 2 → order `[n1, n2, d, d, n3]`. `removeSet(n2)` → `[n1, n3]`. `addRound` on a 2×3 superset → each exercise has 4 non-drop sets, and only the last exercise's sets have rest 90. `replaceExercise` from `weight_reps` to `time` nulls weight and reps. Every op's output passes `WorkoutDoc.parse` when the input did. Inputs are never mutated (`Object.freeze` a deep fixture).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(shared): add pure workout builder operations`

---

### Task 10: Database: workout tables with RLS

**Files:**
- Create: `supabase/migrations/20261104000100_workouts.sql`, `supabase/tests/workouts_rls.test.sql`
- Modify: `supabase/tests/00_helpers.sql`, `supabase/tests/service_role_grants.test.sql`, `packages/shared/src/database.types.ts` (regenerate)

**Interfaces:**
- Produces (SQL):
  - Enums `public.set_type ('normal','warmup','drop')` and `public.block_kind ('straight','superset')`.
  - `public.touch_updated_at()` trigger function (generic: `new.updated_at := now()`), attached `before update` on every table created in this phase.
  - Helpers (definer, stable, granted to `authenticated` only): `public.is_client_in(ws uuid, uid uuid) returns boolean` and `public.exercise_usable_in(ex uuid, ws uuid) returns boolean` (built-in, or a custom exercise of `ws`).
  - `workouts(id uuid pk default gen_random_uuid(), workspace_id uuid not null → workspaces on delete cascade, client_id uuid → auth.users on delete cascade, scheduled_on date, assignment_id uuid /* FK added in Task 13 */, source_workout_id uuid → workouts on delete set null, name text not null check length 1..100, notes text check length ≤2000, created_by uuid default auth.uid() → auth.users on delete set null, created_at, updated_at timestamptz not null default now(), check ((client_id is null) = (scheduled_on is null)))`. Indexes: `(workspace_id) where client_id is null`, `(client_id, scheduled_on)`.
  - `workout_blocks(id, workout_id → workouts on delete cascade, workspace_id, client_id, position smallint ≥0, kind block_kind, created_at, updated_at, unique (workout_id, position) deferrable initially deferred)`
  - `workout_exercises(id, block_id → workout_blocks on delete cascade, workout_id, workspace_id, client_id, position, exercise_id → exercises on delete restrict, note ≤500, …, unique (block_id, position) deferrable initially deferred)`
  - `workout_sets(id, workout_exercise_id → workout_exercises on delete cascade, workout_id, workspace_id, client_id, position, set_type, target_reps_min smallint 1..1000, target_reps_max smallint 1..1000, target_weight_kg numeric(7,3) 0..1000, target_duration_s int 1..86400, target_distance_m numeric(9,2) >0..1000000, to_failure boolean not null default false, rest_seconds smallint not null default 0 check 0..3600, note ≤500, …, check (target_reps_min <= target_reps_max), check (set_type <> 'drop' or rest_seconds = 0), check (not to_failure or set_type = 'drop'), unique (workout_exercise_id, position) deferrable initially deferred)`
  - `public.inherit_workout_owner()`: a `before insert` trigger (definer) on the three child tables. It overwrites `workout_id`/`workspace_id`/`client_id` from the parent row, so the API can never forge them.
  - Grants to `authenticated`: `select` on all four. `workouts`: insert `(id, workspace_id, client_id, scheduled_on, name, notes)`, update `(name, notes, scheduled_on)`, delete. Children: insert of the id, parent FK, position and payload columns. Update of position and payload (`kind`; `exercise_id, note`; set target/rest/note/type columns), but never parent FKs, `workspace_id` or `client_id`. Delete. All four tables to `service_role`.
  - Policies (use `(select auth.uid())`): select `is_coach_of(workspace_id) or client_id = (select auth.uid())`. `workouts` insert `is_coach_of(workspace_id) and (client_id is null or is_client_in(workspace_id, client_id))`. Update/delete `is_coach_of(workspace_id)`. Children insert/update/delete `is_coach_of(workspace_id)`. `workout_exercises` insert/update additionally require `exercise_usable_in(exercise_id, workspace_id)`. Clients write nothing in phase 2.
  - `00_helpers.sql`: `tests.create_exercise(ws uuid, name text, tt public.tracking_type default 'weight_reps') returns uuid` (null `ws` = built-in) and `tests.create_workout(ws uuid, name text, client uuid default null, on_date date default null, ex uuid default null) returns uuid`. The latter makes 1 straight block, 1 exercise (creating a built-in if `ex` is null), and sets normal(8 reps, 60 kg, rest 90) + drop(to_failure).

- [ ] **Step 1: Write failing pgTAP tests** (`workouts_rls.test.sql`). Fixtures: coach A, clients A1 and A2, coach B, client B1. A library workout in A, instances for A1 and A2 in A, a library workout in B, and a B custom exercise.
  - Privileges: anon has no privileges on the four tables. `authenticated` lacks update on `client_id`, `workspace_id`, `source_workout_id` and `assignment_id`. The child tables have no update on parent FKs. `service_role` has exactly S/I/U/D (added to `service_role_grants.test.sql`).
  - anon: `select` on each table throws 42501.
  - Coach A: reads A's library workout and both instances with all children. Reads 0 rows of B's. Creates a library workout + block + exercise + set. Updates a set's `target_weight_kg`. `updated_at` advances. Deletes a workout and its children cascade.
  - Coach A cannot: insert a workout with `workspace_id` = B (42501). Insert a block under B's workout (42501). Insert a workout for client B1 or for coach B as `client_id` (42501). Add B's custom exercise to A's workout (42501). Update B's set (0 rows changed).
  - Forgery: coach A inserting a block that names `workspace_id` or `client_id` explicitly throws 42501 (no column privilege). As postgres, inserting a set with a wrong `workspace_id`/`client_id` stores the parent's values (trigger).
  - Client A1: reads own instance and its children. Reads 0 of A2's instance, 0 of A's library workout (coach-only data) and 0 of B's. Insert/update/delete on all four affects nothing (42501 or 0 rows).
  - Constraints: a drop with `rest_seconds = 30` throws 23514. `to_failure` on a normal set throws 23514. Reps min 10, max 8 throws 23514. Negative weight throws 23514. `client_id` without `scheduled_on` throws 23514. Deleting A's custom exercise used by a workout throws 23503 (Review Focus 5).
- [ ] **Step 2: Run** `pnpm db:reset && pnpm db:test` → FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm db:types && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(db): add workout, block, exercise and set tables with RLS`

---

### Task 11: Database: `save_workout`

**Files:**
- Create: `supabase/migrations/20261104000200_save_workout.sql`, `supabase/tests/save_workout.test.sql`

**Interfaces:**
- Consumes: Task 10 tables. The JSON shape is `WorkoutDoc` (Task 8): camelCase keys `id, name, notes, blocks[].{id, kind, exercises[].{id, exerciseId, note, sets[].{id, setType, targetRepsMin, targetRepsMax, targetWeightKg, targetDurationS, targetDistanceM, toFailure, restSeconds, note}}}`. Other keys are ignored.
- Produces: `public.save_workout(p_workspace_id uuid, p_doc jsonb) returns uuid`. **Security invoker** (RLS applies to every write), `set search_path = ''`, execute granted to `authenticated` only. In one transaction it upserts the workout by `id` (insert as a library workout if new; on an existing row it updates only `name`, `notes` and `updated_at`, never `client_id`/`scheduled_on`). Then it upserts blocks/exercises/sets by `id` with `position` = array index (0-based), and deletes children of this workout whose ids are absent from the doc. DB guards: no blocks, straight ≠ 1 exercise, superset < 2, an exercise with no sets, or a leading drop raise `check_violation` (23514) with the same messages as Task 8. A child id that already belongs to a different parent raises 23514 `'Row % belongs to another workout.'`.

- [ ] **Step 1: Write failing tests:**
  - Coach A saves a new doc (straight block with 4 sets incl. 1 drop + a 2-exercise superset × 3) → 1 workout, 2 blocks, 3 exercises, 10 sets. Positions are 0-based in doc order. `client_id` is null.
  - Re-save with block order swapped, one set removed and one target changed → row ids are kept, positions updated, the removed set is gone, and the other rows are untouched. A `select count(*)` before/after shows no leftover rows.
  - Re-save an **instance** (A1's) → `client_id` and `scheduled_on` are unchanged. Re-saving the instance does not touch the library workout it came from (Review Focus 1, DB half).
  - Coach A with `p_workspace_id` = B → 42501. Coach A saving a doc whose `id` is B's workout → 42501, and B's row is unchanged.
  - Client A1 calling it → 42501.
  - A doc with a leading drop → 23514 with the drop message. A superset with 1 exercise → 23514. Zero blocks → 23514.
  - A doc reusing a set id from another of A's workouts → 23514 `belongs to another workout`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (plpgsql; `jsonb_array_elements … with ordinality`; `insert … on conflict (id) do update … where <table>.<parent_fk> = excluded.<parent_fk>`, then a `found`/row-count check for the cross-parent case). **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm db:types` → PASS.
- [ ] **Step 5: Commit** `feat(db): add save_workout for transactional builder saves`

---

### Task 12: Database: programs

**Files:**
- Create: `supabase/migrations/20261104000300_programs.sql`, `supabase/tests/programs_rls.test.sql`
- Modify: `supabase/tests/service_role_grants.test.sql`

**Interfaces:**
- Produces (SQL):
  - `programs(id uuid pk default gen_random_uuid(), workspace_id not null → workspaces on delete cascade, name text 1..100, description text ≤2000, weeks smallint not null default 4 check 1..52, created_by default auth.uid(), created_at, updated_at)`
  - `program_workouts(id uuid pk default gen_random_uuid(), program_id → programs on delete cascade, workspace_id /* inherited by trigger */, week smallint check 1..52, day smallint check 1..7, position smallint not null default 0, workout_id → workouts on delete cascade, created_at, updated_at)`, index `(program_id, week, day, position)`. Day `d` of week `w` means `start_date + (w-1)*7 + (d-1)`. Days are relative to the start date, not Mon–Sun.
  - `public.is_library_workout_of(w uuid, ws uuid) returns boolean` (definer): true when `workouts.client_id is null and workspace_id = ws`.
  - A `before insert` trigger copies `workspace_id` from `programs`.
  - Grants: `programs` select, insert `(id, workspace_id, name, description, weeks)`, update `(name, description, weeks)`, delete. `program_workouts` select, insert `(id, program_id, week, day, position, workout_id)`, update `(week, day, position)`, delete. `service_role` S/I/U/D.
  - Policies: everything `is_coach_of(workspace_id)`. `program_workouts` insert additionally requires `is_library_workout_of(workout_id, workspace_id)`. **Clients see no programs** (coach-only data).
  - `public.set_program_weeks(p_program_id uuid, p_weeks smallint) returns int` (invoker): in one transaction it deletes slots with `week > p_weeks`, updates `weeks`, and returns the number of slots removed. It is the only path the web uses to change weeks.

- [ ] **Step 1: Write failing tests:** anon 42501. Coach A CRUD on A's programs and slots. Coach A sees 0 of B's. Coach A cannot add B's library workout (or a client instance of A) to A's program (42501). A1 sees 0 programs and 0 slots, and writes nothing. Week 53 and day 0 throw 23514. `set_program_weeks(p, 4)` on a 6-week program with slots in weeks 2, 5, 6 returns 2 and leaves only the week-2 slot. Deleting a library workout removes its slots but leaves the program (Review Focus 5, DB half). Deleting a program cascades its slots.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm db:types` → PASS.
- [ ] **Step 5: Commit** `feat(db): add programs and program workout slots with RLS`

---

### Task 13: Database: assignment (copy into client calendars)

**Files:**
- Create: `supabase/migrations/20261104000400_assignments.sql`, `supabase/tests/assignments.test.sql`
- Modify: `supabase/tests/service_role_grants.test.sql`

**Interfaces:**
- Produces (SQL):
  - `program_assignments(id uuid pk, workspace_id not null, client_id not null → auth.users on delete cascade, program_id → programs on delete set null, program_name text not null, weeks smallint not null, start_date date not null, end_date date generated always as (start_date + (weeks * 7 - 1)) stored, cancelled_on date, created_by, created_at, updated_at)`. Clients and coaches can select (`is_coach_of(workspace_id) or client_id = auth.uid()`). No insert/update/delete grants for `authenticated`: writes happen only through the functions below.
  - `alter table workouts add foreign key (assignment_id) references program_assignments on delete set null`.
  - `public.copy_workout(p_source uuid, p_client uuid, p_date date, p_assignment uuid, p_new_id uuid) returns uuid`: definer, **execute revoked from `authenticated`** (internal). It deep-copies one workout with all children (new ids, same positions and targets) as an instance with `source_workout_id = p_source`.
  - `public.assign_program(p_assignment_id uuid, p_program_id uuid, p_client_id uuid, p_start_date date) returns uuid`: definer. It raises 42501 unless the caller `is_coach_of` the program's workspace and `is_client_in(that workspace, p_client_id)`. It is **idempotent**: an existing `p_assignment_id` with the same client and program returns the id without copying; an existing id with different arguments raises 23505. It snapshots `program_name` and `weeks`, then copies each slot ordered by `(week, day, position, created_at)` to `programDayToDate(start, week, day)`.
  - `public.schedule_workout(p_new_id uuid, p_workout_id uuid, p_client_id uuid, p_date date) returns uuid`: definer. The source must be a library workout of a workspace the caller coaches, and the client must be in it (else 42501). It is idempotent on `p_new_id`.
  - `public.unassign_program(p_assignment_id uuid, p_from_date date) returns int`: definer, coach of the assignment's workspace only. It deletes that assignment's workouts with `scheduled_on >= p_from_date` and sets `cancelled_on = p_from_date`. If no workouts of it remain, it deletes the assignment row instead. Returns the deleted workout count.
  - Moving and deleting a single calendar workout use plain `update workouts set scheduled_on` / `delete` under the Task 10 RLS.

- [ ] **Step 1: Write failing tests:**
  - A 2-week program with slots W1D1, W1D3, W2D1 (×2, positions 0 and 1) and start `2026-11-09` → A1 gets 4 instances on `2026-11-09`, `2026-11-11`, `2026-11-16`, `2026-11-16`. Each has `assignment_id`, `source_workout_id`, `client_id = A1` and fresh child ids with the same targets. `end_date = '2026-11-22'`.
  - Editing the template's set weight, renaming the template, or deleting the template after assignment → A1's instances are unchanged (`source_workout_id` becomes null on delete). Deleting the program → the assignment's `program_id` becomes null and the instances survive (Review Focus 1).
  - Calling `assign_program` twice with the same id → still 4 instances (Review Focus 4). The same id with another client → 23505.
  - Coach A assigning to B1, coach B assigning A's program, and A1 calling it → 42501 each. `copy_workout` called by coach A → 42501 (no execute).
  - `schedule_workout` copies a library workout onto `2026-11-12`. Passing an instance as the source → 42501. Calling twice with the same `p_new_id` → 1 row.
  - `unassign_program(id, '2026-11-16')` → returns 2, the two 11-16 instances are gone, the 11-09/11-11 ones remain, and `cancelled_on = '2026-11-16'`. `unassign_program(id, '2026-11-01')` on a fresh assignment deletes everything and the assignment row.
  - A1 can select own assignment, cannot select A2's, and cannot update its `start_date` (42501).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (set-based copies: build an old→new id map per level with `gen_random_uuid()` in a CTE or temp table, then insert children joined to the map). **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm db:types` → PASS.
- [ ] **Step 5: Commit** `feat(db): add program assignment and single-workout scheduling`

---

### Task 14: Web: workout library and builder

**Files:**
- Create: `packages/shared/src/workouts/tree.ts` + `packages/shared/test/workouts/tree.test.ts`, `apps/web/src/app/(coach)/workouts/{page.tsx,actions.ts,new/page.tsx,[id]/page.tsx,workouts.module.css}`, `apps/web/src/components/workout-builder/{workout-builder.tsx,block-editor.tsx,set-row.tsx,exercise-picker.tsx,builder.module.css}`, `apps/web/src/lib/workouts.ts`, `apps/web/e2e/workouts.spec.ts`
- Create: `apps/web/e2e/helpers.ts` (`signInAsCoach(page)`, `createWorkout(page, name: string): Promise<void>` that builds a 1-block Barbell Squat 3×8 @ 60 kg workout through the UI)
- Modify: `apps/web/src/lib/auth.ts` (`CoachContext` gains `units: Units` from `profiles.units`)

**Interfaces:**
- Consumes: `WorkoutDoc`, doc-ops, `setLabels`, `TARGET_FIELDS`, unit helpers (Tasks 7–9); `save_workout` (Task 11).
- Produces:
  - shared `WORKOUT_TREE_SELECT: string`: the PostgREST nested select of workout → blocks → exercises (with `exercises(name, tracking_type)`) → sets. `type WorkoutTreeRow` matches it. `workoutRowToDoc(row: WorkoutTreeRow): WorkoutDoc` sorts every level by `position`. Mobile reuses all three in Task 17.
  - `apps/web/src/lib/workouts.ts`: `loadWorkoutDoc(supabase, id): Promise<{ doc: WorkoutDoc; clientId: string | null; scheduledOn: IsoDate | null } | null>`.
  - `workouts/actions.ts`: `saveWorkout(doc: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string; issues?: { path: (string|number)[]; message: string }[] }>`. It calls `requireCoach()` for the workspace id, runs `WorkoutDoc.safeParse` and then `rpc('save_workout')`. `revalidatePath` covers `/workouts` and any `/clients/[id]` calendar. Also `deleteWorkout(id: string): Promise<{ ok: boolean; error?: string }>`, `countProgramUses(id: string): Promise<number>`, and `searchExercises(query: string): Promise<ExercisePick[]>` (name `ilike` with `%`/`_` escaped, limit 20, ordered by name).
  - `<WorkoutBuilder initial: WorkoutDoc; units: Units; mode: 'library' | { clientName: string; date: IsoDate }; onSaved?: (id: string) => void>`: a client component. State is the doc, changed only through doc-ops (`makeId = crypto.randomUUID`). Weight inputs are in the coach's units and use `toKg` on change and `fromKg` on display. Reps inputs show a single value or a range ("8" or "8–10", two inputs). Each set row has a type select (Normal / Warm-up), drop rows are indented with `↳` on `--ct-drop` fill, rest is a seconds input shown as m:ss (hidden on drops), each set and each exercise has an optional note field, and buttons are `+ Set`, `+ Drop`, `+ Round` (superset) and `Swap exercise`. The block header reads "Superset / circuit · N rounds". Save is a primary `Button` with `pending`. Server `issues` map to inline errors by path. A `beforeunload` warning shows while there are unsaved changes.
  - Routes: `/workouts` (searchable list: name, exercise count, updated date; "New workout"), `/workouts/new` (empty builder, redirects to `/workouts/[id]` after the first save), `/workouts/[id]` (builder + Delete). Delete confirms with `countProgramUses`: "Used in N programs. Deleting removes it from them. Clients' calendars keep their copies." (Review Focus 5).

- [ ] **Step 1: Write failing tests.**
  - `tree.test.ts`: a fixture row with shuffled positions → `workoutRowToDoc` gives an ordered doc that passes `WorkoutDoc.parse`. `numeric` values that arrive as strings (`'61.235'`) become numbers.
  - `e2e/workouts.spec.ts` (demo coach, unique name per run): create "Upper A <ts>". Add a straight block of `Barbell Squat` with a warm-up + 3 sets of 8–10 @ 60 kg, and a drop after set 3 with "To failure". Add a superset of `Pushups` + `Pullups` with 3 rounds. Save, reload, and all values are present (`↳` row visible, "Superset / circuit · 3 rounds"). Saving with an empty name shows "Enter a name." inline. Delete the workout → gone from `/workouts`.
  - `e2e/workouts.spec.ts` "pounds round trip": set the demo coach's `profiles.units` to `lb` via the service role in `beforeAll` (restored in `afterAll`), enter 135, save and reload → the input shows `135` (Review Focus 2).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the shared tree mapping, the actions, the builder and the pages. Add `Workouts` to the sidebar (it already links there from Task 4).
- [ ] **Step 4: Run** `pnpm check && pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(web): add workout library and builder`

---

### Task 15: Web: program builder grid with drag-and-drop

**Files:**
- Create: `packages/shared/src/programs/schema.ts`, `packages/shared/test/programs/schema.test.ts`, `apps/web/src/app/(coach)/programs/{page.tsx,actions.ts,new/page.tsx,[id]/page.tsx,[id]/program-grid.tsx,[id]/workout-picker.tsx,programs.module.css}`, `apps/web/e2e/programs.spec.ts`
- Modify: `apps/web/package.json` (`@dnd-kit/core`), `apps/web/e2e/helpers.ts` (+ `createProgram(page, name: string, weeks: number, slots: { week: number; day: number; workoutName: string }[]): Promise<void>`)

**Interfaces:**
- Consumes: Task 12 tables and `set_program_weeks`; the library list from Task 14.
- Produces:
  - `programs/actions.ts`: `createProgram(input: ProgramInput): Promise<{ id: string }>`, `updateProgram(id, input: ProgramInput): Promise<{ ok: true; removedSlots: number } | { ok: false; error: string }>` (weeks change via `set_program_weeks`), `deleteProgram(id)`, `addProgramWorkout(input: { id: string; programId: string; week: number; day: number; workoutId: string }): Promise<void>` (client-generated `id`), `moveProgramWorkout(input: { id: string; week: number; day: number; position: number }): Promise<void>`, `removeProgramWorkout(id: string): Promise<void>`. `countSlotsBeyondWeek(programId, weeks): Promise<number>`.
  - shared `programs/schema.ts`: `ProgramInput = z.object({ name: trim 1..100 'Enter a name.', description: ≤2000 nullable, weeks: int 1..52 'Programs are 1 to 52 weeks.' })`, plus `AssignProgramInput` and `ScheduleWorkoutInput` (used in Task 16; uuids + `IsoDateSchema`).
  - `<ProgramGrid>` (client): rows = weeks, columns = "Day 1"…"Day 7". On the left is a scrollable, searchable library panel whose items are draggable. Each cell is a droppable target and lists its slots as chips. A chip is draggable to another cell and has a menu: **Move to…** (week/day selects), **Remove**. Each cell has a "+" button that opens `<WorkoutPicker>` (the keyboard and touch path). It uses `@dnd-kit/core` with `PointerSensor` (activation distance 4) and `KeyboardSensor`. Updates are optimistic with a rollback and a toast on error. "+ Add week" and the weeks field go through `updateProgram`. When shrinking would remove slots, a confirm says "Weeks 5–6 have 3 workouts. They'll be removed from this program." (Review Focus 5).
  - `/programs`: a list with name, weeks and slot count, plus "New program".

- [ ] **Step 1: Write failing tests.** `schema.test.ts`: weeks 0 and 53 rejected with 'Programs are 1 to 52 weeks.'; `AssignProgramInput` rejects `startDate: '2026-02-30'` and non-uuid ids. `e2e/programs.spec.ts`: first create a library workout with `createWorkout(page, name)` (Task 14). Create "Strength 2wk <ts>" with 2 weeks. Use "+" to add the workout to W1 Day 1 and W2 Day 3. Drag the W1 Day 1 chip to W1 Day 4 (`page.mouse` down/move in 10 steps/up). Reload → chips are at W1 Day 4 and W2 Day 3. Change weeks to 1 → the confirm mentions 1 workout → accept → only W1 Day 4 remains. A second test removes a chip via the menu.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check && pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(web): add program builder with drag-and-drop weekly grid`

---

### Task 16: Web: client calendar and assignment

**Files:**
- Create: `apps/web/src/app/(coach)/clients/[clientId]/{page.tsx,actions.ts,assign-dialog.tsx,client-calendar.tsx,workouts/[workoutId]/page.tsx}`, `apps/web/src/components/calendar/{month-calendar.tsx,calendar.module.css}`, `apps/web/e2e/calendar.spec.ts`
- Modify: `apps/web/src/app/(coach)/clients/page.tsx` (client names link to `/clients/[clientId]`)

**Interfaces:**
- Consumes: Task 13 functions; `WorkoutBuilder` (Task 14); `monthGrid`, `localToday`, `programDayToDate`, `programEndDate` (Task 7); `AssignProgramInput`, `ScheduleWorkoutInput` (Task 15).
- Produces:
  - `clients/[clientId]/actions.ts`: `assignProgram(input: AssignProgramInput): Promise<{ ok: true; count: number } | { ok: false; error: string }>`, `scheduleWorkout(input: ScheduleWorkoutInput)`, `moveClientWorkout(input: { workoutId: string; date: IsoDate })`, `deleteClientWorkout(workoutId: string)`, `unassignProgram(input: { assignmentId: string; fromDate: IsoDate }): Promise<{ removed: number }>`. Each starts with `requireCoach()` and lets RLS/definer checks do the real authorization. Ids for assign/schedule are generated **in the browser once per dialog open** (`crypto.randomUUID()`), so a double click or retry repeats the same id (Review Focus 4).
  - `<MonthCalendar month: 'YYYY-MM'; days: Record<IsoDate, CalendarItem[]>; today: IsoDate; renderItem; onDropItem?(itemId, date); onAddToDay?(date)>`. `CalendarItem = { id: string; name: string; programName: string | null }`. Monday-first, with prev/next month links (`?month=`). Each day cell carries `data-date={IsoDate}`. `today` gets an ink ring and `aria-current="date"`. Days are droppable and items draggable (`@dnd-kit/core`).
  - Client page `/clients/[clientId]?month=YYYY-MM`: the server loads the client name (404 if not a client of this workspace), workouts with `scheduled_on` in the grid range (id, name, assignment → program_name), active assignments (`cancelled_on is null`, `end_date >= start of grid`), and the library + programs for the pickers. **`today` is computed in the browser** (`localToday()` in a client component) so a UTC server never shifts it (Review Focus 3). Items have a menu: **Edit** → `/clients/[clientId]/workouts/[workoutId]` (builder in client mode, back link to the calendar), **Move to…** (date input), **Delete** (confirm). The day "+" adds from the library.
  - `<AssignDialog>`: a program select and a start date (default: the next Monday from `localToday()`; past dates allowed with the amber note "This start date is in the past. Workouts before today will show as missed later."). A live preview reads "8 workouts from Mon 9 Nov to Sun 6 Dec", computed from the program's slots with the shared date helpers. The Assign `Button` uses `pending`.
  - Assignments panel: "Strength 2wk · 9 Nov – 22 Nov" plus **Remove from calendar** → confirm "Removes N upcoming workouts from {today}. Past workouts stay." → `unassignProgram({ fromDate: localToday() })`.

- [ ] **Step 1: Write failing `e2e/calendar.spec.ts`:** each test builds its own workout and program via `e2e/helpers.ts`.
  - Assign "Strength 2wk <ts>" (W1D1, W2D3) to Demo Client starting next Monday. The preview text is right, and the calendar shows the workout on that Monday and on Monday+9. Double-click Assign → the item count for that program on the calendar is still 2 (Review Focus 4).
  - Edit the library workout's weight to 100 kg, then open the client's copy → it still shows 60 kg. Edit the client's copy to 70 kg → the library still shows 100 kg (Review Focus 1).
  - Move an item to another day via **Move to…**, and drag another item to a new day. Reload → both persist. Delete an item → gone.
  - "+" on a day adds a single library workout.
  - Remove from calendar → future items for that program disappear.
  - Time zone: in a context with `timezoneId: 'Pacific/Auckland'`, the cell with `aria-current="date"` has the `data-date` that `new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland'}).format(new Date())` gives (Review Focus 3).
  - A coach visiting `/clients/<uuid of a non-client>` gets a 404.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check && pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(web): add client calendar with program assignment and day editing`

---

### Task 17: Mobile: Today and Workouts tabs and workout detail (view-only)

**Files:**
- Create: `apps/mobile/src/app/(app)/(tabs)/{_layout.tsx,today.tsx,workouts.tsx}`, `apps/mobile/src/app/(app)/workout/[id].tsx`, `apps/mobile/src/lib/workouts.ts`, `apps/mobile/src/lib/workouts.test.ts`, `apps/mobile/.maestro/calendar.yaml`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx` (no workspace → the existing "Ask your coach" screen; otherwise tabs), `(app)/home.tsx` (now only the no-invite screen), `apps/mobile/scripts/e2e-helper.ts` (+ actions `assign`, `cleanup-workouts`), `apps/mobile/.maestro/helpers/call.js` (document the new actions), `apps/mobile/scripts/run-e2e.sh` (include the new flow)

**Interfaces:**
- Consumes: `WORKOUT_TREE_SELECT`, `workoutRowToDoc`, `groupDropSets`, `setLabels`, `formatSetTarget`, `formatRest`, `localToday`, `startOfWeek`, `addDays`, `youtubeFormSearchUrl` (shared); `useTheme` + UI kit (Task 6).
- Produces:
  - `lib/workouts.ts`: `type WorkoutSummary = { id: string; name: string; scheduledOn: IsoDate; exerciseCount: number; programName: string | null }`. `fetchWorkoutsBetween(from: IsoDate, to: IsoDate): Promise<WorkoutSummary[]>` (RLS limits rows to the signed-in client), `fetchNextWorkout(after: IsoDate): Promise<WorkoutSummary | null>`, `fetchWorkoutDetail(id: string): Promise<{ doc: WorkoutDoc; scheduledOn: IsoDate; videoUrls: Record<string, string> } | null>` (`videoUrls` per `exerciseId`: workspace override `youtube_url`, else the exercise's own `youtube_url`, else `youtubeFormSearchUrl(name)`). `fetchMyUnits(): Promise<Units>` (own `profiles.units`). `groupByDay(items: WorkoutSummary[], from: IsoDate): Array<{ date: IsoDate; items: WorkoutSummary[] }>` is pure: 7 entries, including empty days.
  - The tab bar has **Today** and **Workouts** (the other spec tabs arrive with their phases). The active tab is ink, inactive is ink-muted, and labels are always shown.
  - Today: caption `Welcome to {workspaceName}` (kept for the phase-1 Maestro flows), title "Today", then a `Card` per workout today (name, "N exercises", program chip, secondary Button "View workout"). **No Start button in phase 2.** Empty state: "Rest day — nothing scheduled today." plus "Next: {name} · {Thu 12 Nov}" when one exists. Refreshes on focus and on pull-to-refresh.
  - Workouts: a week view headed "Week of 9 Nov" with ‹ › buttons (`accessibilityLabel` "Previous week"/"Next week"). Seven day rows show the weekday + date, with workouts as tappable rows or "Rest". Today's row has a lime date chip plus the word "Today".
  - Detail `/workout/[id]`: the name, a formatted date, and per block a "Superset / circuit · N rounds" header (exercises labelled A1, A2…) or the exercise name. Set rows show `setLabels` + `formatSetTarget` (in the client's `profiles.units`) + `formatRest`, with drop rows indented on `drop` fill. Notes and a "Watch form on YouTube" secondary button open `videoUrls[exerciseId]` via `Linking.openURL`. Read-only throughout.

- [ ] **Step 1: Write failing tests.**
  - `workouts.test.ts`: `groupByDay` with items on Mon and Wed of `2026-11-09` returns 7 days, Tue empty, order kept.
  - `.maestro/calendar.yaml`: `runScript` with action `assign`. The helper signs in as `coach@demo.local` with the anon key (not the service role, because `assign_program` checks `auth.uid()`). It saves a library workout "E2E Upper" (Barbell Squat: 8 reps @ 60 kg + drop to failure) through `save_workout`, creates a 1-week program with that workout on Day 1, and assigns it to `client@demo.local` starting **today in the Mac's local time zone**. The flow then signs in as `client@demo.local` / `demo-password-123`, asserts `Welcome to Demo Coaching` and `E2E Upper`, taps "View workout", asserts `Barbell Squat`, `8 reps · 60 kg`, `↳` and `To failure`, goes back, taps the Workouts tab, asserts `Today` and `E2E Upper`, then runs action `cleanup-workouts` (service role deletes "E2E " workouts, programs and assignments).
- [ ] **Step 2: Run** `pnpm --filter mobile test` → FAIL. `pnpm --filter mobile e2e` → calendar flow FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter mobile test && pnpm check && pnpm --filter mobile e2e` → all five flows PASS.
- [ ] **Step 5: Manual check** on the simulator at the largest Dynamic Type: detail rows wrap without truncation. On an iPad simulator the layout uses the 52 px button height.
- [ ] **Step 6: Commit** `feat(mobile): show client calendar, today's workouts and workout detail`

---

### Task 18: Final verification and handoff

**Files:**
- Modify: `apps/web/e2e-staging/smoke.spec.ts` (add: signed-in coach opens `/workouts` and `/programs` → headings visible), `apps/web/README.md` and `apps/mobile/README.md` (new routes and Maestro flow, a few lines each)

- [ ] **Step 1: Full local run**, showing the output: `pnpm check && pnpm db:reset && pnpm db:test && pnpm db:types && git diff --exit-code packages/shared/src/database.types.ts && pnpm functions:test && pnpm test:integration && pnpm test:e2e && pnpm --filter mobile e2e` → all green.
- [ ] **Step 2: Scope check:** `grep -riE 'amrap|emom|rpe|1rm|percent' apps packages supabase/migrations` finds no new prescription features. No logging/Start UI exists on mobile.
- [ ] **Step 3: Checkpoint (product owner):** ask to push and open the PR. The PR description covers what changed, why and how it was tested, plus "try on your phone": sign in as your test client in Expo Go (staging) → Today shows the assigned workout → Workouts tab → tap a workout. On the dashboard: build a workout with a superset and a drop set, build a 4-week program, assign it, then move and delete a day.
- [ ] **Step 4: After merge** (CI pushes migrations to staging): run the staging smoke test (`pnpm --filter web test:e2e:staging`) and report the result.

---

## Done when

- `pnpm check`, `pnpm db:test`, Deno function tests, integration tests, Playwright and Maestro all pass locally and in CI (Maestro locally only).
- On staging, the product owner sees branded sign-in, auth, invite, clients and exercise pages, and branded mobile sign-in/sign-up.
- On staging, the coach can build library workouts (straight sets, supersets/circuits, warm-ups, drop sets, reps ranges, rest, notes, in kg or lb), build a multi-week program by drag-and-drop, assign it to a client from a chosen start date, add/move/edit/delete single calendar workouts, and remove a program from a calendar.
- The client sees today's workouts, a week calendar and read-only workout detail in the app.

## Rulings for the product owner (made in this plan; change any before execution)

1. Two PRs: the design refresh (Tasks 1–6) ships to staging first so the branded login is visible quickly; programs follow.
2. Sign-in has a lime brand panel with the tagline "Build programs. Log sessions. Celebrate every PR." Handwritten notes: "Welcome back, coach!" (web sign-in), "Let's get moving!" (invite page), "Let's train!" (app sign-in). Copy is easy to change.
3. Program days are "Day 1–7" counted from the start date (any weekday), not fixed Mon–Sun. **Approved by the product owner 2026-11-04.**
4. Distance follows the weight preference: km for kg users, miles for lb users.
5. "To failure" is offered only on drop sets (spec wording). Normal sets use rep targets.
6. In a superset, rest is set once per round (after the last exercise).
7. Deleting a library workout removes it from programs (with a warning showing the count). Clients' calendars keep their copies.
8. "Remove program from calendar" deletes that program's workouts from today onward. Past days stay.
9. Past start dates are allowed, with a warning.
10. Programs are 1–52 weeks.
11. Phone tabs in this phase are Today and Workouts only. No Start button until phase 3. ⌘K search and coach home tiles come later.
12. Muted grey text is never used on pastel tiles (it fails contrast on pink and blue). Tile captions are black.
13. Names are split into first name (required) and last name (optional) for clients and coaches (Task 6b, requested by the product owner). CSV accepts either separate first/last columns or one Name column.
14. The bulk-invite option must explain itself (product owner request). On the Clients page it is labelled "Invite many clients from a spreadsheet (CSV)". Next to it: a one-line explanation ("Bring your client list from Everfit or Excel: one row per client with name and email"), a "Download example CSV" link (a template with the accepted headers) and the accepted headers and 200-row limit shown before a file is picked. Belongs to Task 4 (Clients page restyle), with an e2e assertion for the label and the template download.
