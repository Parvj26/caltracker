# Coach Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give coaches a `/profile` page to set their photo, name, business name, bio, units and password. Clients see the coach's photo, name, business and bio in the app.

**Architecture:**
- **Data:** a bio column on `profiles`, plus a private `avatars` bucket served through signed URLs.
- **Business name:** an owner-only path for changing the workspace name.
- **Web:** one server-action form with browser-side square crop and compression.
- **Mobile:** reads the coach profile through RLS.

**Tech Stack:** Postgres/pgTAP, Supabase Storage policies, Next.js 16 server actions, Expo SDK 58, Vitest, Playwright, Maestro.

**Spec:** `docs/superpowers/specs/2026-11-05-coach-profile-design.md`

**Branch:** `feature/coach-profile` from `main`. Use the next free migration number at build time (check `supabase/migrations/` and other open branches).

## Global Constraints
- **Bio:** 0–300 characters, plain text with line breaks allowed. Show the counter as "212 / 300".
- **Business name:** 1–80 characters, trimmed.
- **Names:** use the existing `FirstName` and `LastName` from shared.
- **Photo:**
  - Accept JPEG, PNG, HEIC or WebP.
  - Crop to a square in the browser.
  - Output a 1600 px max WebP plus a 256 px thumbnail.
  - Paths: `avatars/{user_id}/avatar.webp` and `avatars/{user_id}/avatar-thumb.webp`.
  - Upload with `upsert`, and add a cache-busting `?v=` built from `profiles.updated_at` or the time of the upload.
- **Avatar access:**
  - A user may write only their own folder.
  - A user may read their own avatar and the avatars of people in the same workspace (their coach, or their coach's clients).
- **Password change:** re-authenticate with the current password first. A wrong current password shows "That's not your current password." The new password follows the existing password rules.
- **Save confirmation:** "✓ Saved" sits next to Save. Stale-deploy errors use `failureMessage` and the reload prompt.
- **Styling:** tokens only; there is no space-5.

## Review Focus
1. **A huge or odd image** (a 20 MB HEIC, a portrait panorama). The crop and compression must still produce a square of at most 1600 px, or show "That image couldn't be used. Try a JPEG or PNG." Test: Task 2.
2. **A client trying to read another workspace's coach avatar or bio.** It must be refused. Test: Task 1 (pgTAP and storage policies).
3. **A coach saving with no changes.** Show no error and no write, and briefly show "✓ Saved". Test: Task 2.
4. **The photo removed.** Initials come back on the web sidebar and in the app card. Test: Tasks 2 and 3.
5. **Two coaches?** A client can only see their own coach. Covered by Review Focus 2.

---

### Task 1: Data and policies
**Files:**
- Create: `supabase/migrations/<next>_coach_profile.sql`, `supabase/tests/coach_profile.test.sql`
- Modify: the generated types

**Interfaces (produces):**
- `profiles.bio text not null default '' check (char_length(bio) <= 300)`
- `profiles.updated_at timestamptz default now()`, with an update trigger
- `public.update_workspace_name(p_name text) returns void`. Definer function; the caller must be the coach of that workspace; the name is trimmed and must be 1–80 characters, otherwise it raises 23514.
- An `avatars` bucket (private), with storage policies for insert, update and delete on own folder, and select on own folder or same-workspace folders.
- A client can read their coach's `profiles` row (name, bio, avatar_path), and only theirs. Extend the policy if the current one doesn't allow this.

- [ ] **Step 1: Write failing pgTAP**
  - The bio limit: 300 characters OK, 301 rejected.
  - `update_workspace_name`:
    - the coach can rename;
    - another coach can't (42501);
    - a client can't (42501);
    - blank and 81-character names are rejected (23514).
  - A client reads their coach's bio, and not another coach's.
  - Storage:
    - an own-folder insert works;
    - an insert into another user's folder is denied;
    - a same-workspace read works;
    - a cross-workspace read is denied.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm db:reset` (and re-import), `pnpm db:test`, `pnpm db:types` and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): store a coach bio and photo, and let coaches rename their business`

### Task 2: Web profile page
**Files:**
- Create: `apps/web/src/app/(coach)/profile/{page.tsx,profile-form.tsx,password-form.tsx,avatar-picker.tsx,actions.ts,profile.module.css}`
- Create: `apps/web/src/lib/image-resize.ts`, a browser canvas resize with a pure helper `fitSquare(w, h, max)` covered by a unit test
- Create: `apps/web/e2e/profile.spec.ts`
- Modify: the sidebar, which gets a "Profile" item with the avatar or initials above Sign out. Modify `requireCoach()` if it needs `avatarPath` and `bio`.

**Interfaces:**
- Consumes Task 1.
- Produces:
  - `saveProfile({ firstName, lastName, businessName, bio, units })`
  - `uploadAvatar(formData)`, which takes the two WebP blobs
  - `removeAvatar()`
  - `changePassword({ current, next, confirm })`

  Each returns `{ ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Write failing tests**
  - Vitest, `fitSquare`:
    - `fitSquare(4000, 3000, 1600)` crops the centre to 3000 and scales to 1600;
    - `fitSquare(800, 800, 1600)` stays 800 (never upscales);
    - an extreme panorama still gives a square.
  - Playwright:
    - edit all fields and save, see "✓ Saved", reload, and the values persist;
    - upload the fixture JPEG, and the sidebar avatar is an `<img>`; remove it, and initials show;
    - a 301-character bio is blocked by the counter and the server;
    - a wrong current password shows the exact error; the correct one works, and signing in with the new password works (restore the old password after);
    - saving with no changes shows no error.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check && CI=1 pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): let coaches edit their profile, photo and password`

### Task 3: Client app shows the coach
**Files:**
- Modify: `apps/mobile/src/components/first-time-welcome.tsx`
- Modify: the coach chip on Today, if there is one
- Create: `apps/mobile/src/lib/coach-profile.ts` (fetch, cache in AsyncStorage, signed thumbnail URL)
- Create: `apps/mobile/src/components/coach-avatar.tsx`
- Create: `.maestro/coach-card.yaml`

**Interfaces:**
- Produces `useCoachProfile(): { name, businessName, bio, avatarUrl | null } | null`, cached so it works offline.

- [ ] **Step 1: Write failing tests**
  - Vitest: the cache returns stored data when fetch fails.
  - Maestro: the helper sets the demo coach's bio and business. Then, on first-time Today, assert the bio text and "Welcome to {business}".
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check`, rebuild the Release simulator app, then run all Maestro flows. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): show the coach's photo, business and bio`
