# CalTracker coach website: UI rules

Version 1.0, 2026-11-17, approved by the product owner. Drawn from three UX reviews of the coach website (findings are cited as A#n / B#n / C#n), `packages/design-tokens` and `apps/web/src/components/ui`.
Every screen change follows these rules. If a rule does not fit, raise it with the PO; no one-off exceptions. Light mode only: **dark mode is not supported** (don't add `prefers-color-scheme` styles).

---

## 1. Sizes, layout, spacing

| Size | Width | Shell | Gutter |
|---|---|---|---|
| Phone | < 600 | bottom tab bar + More sheet | 16 (`--ct-space-4`) |
| Tablet | 600–1199 | 56px icon rail | 24 (`--ct-space-6`) |
| Desktop | ≥ 1200 | sidebar with labels | 48 (**new** `--ct-space-12`) |

1. Page media queries use only `max-width: 599.98px` / `1199.98px` (+ matching `min-width`). Add token `breakpoints.desktop = 1200`; `split: 1000` and `webSidebarCollapse: 900` are legacy, delete when unused.
2. Components (rows, cards, toolbars, set tables) adapt with **container queries**, not page media queries.
3. Touch vs mouse = `(hover: none) and (pointer: coarse)`, never width.
4. No sideways page scroll at any size. Wide content scrolls in its own box or becomes a list.
5. Desktop page content max width ~1100px, centred. Long text ≤ 70ch; feeds/chat/forms ≤ 640–760px.
6. Tablet portrait (820) is its own layout: decide per screen "list → full-screen detail" or two panes.
7. Spacing only from `--ct-space-N` (4pt grid): 1=4, 2=8, 2.5=10, 3=12, 3.5=14, 4=16, 4.5=18, 6=24. **Add** 8=32, 10=40, 12=48. No raw px.
8. Rhythm: 12 between rows/fields, 24 between sections, pop-up padding 16 (phone) / 24 (larger).
9. Radius from tokens only: `--ct-radius-button` 16, `--ct-radius-input` 12, card 20, pill 999.
10. Type: screen title 24, section 16/700, body 15/500, caption 12 (13 on phone), button 16/800. Nothing under 12px; input text 16px on phone (no iOS zoom).

## 2. Colour roles

1. **Lime = create/add only** ("+ New workout", "+ Exercise", "+ Add scan"). Never selected, done, active, focus or highlight.
2. Ink = main action, text, selection, focus.
3. **Selected segmented tab** = white pill (`--ct-bg`) + 1.5px ink border (`--ct-border-width-secondary-button`), ink text 800. Unselected = text on `--ct-surface`.
4. Selected toggle/filter chip = ink fill, white text (the existing Clients/Home/Messages pattern). Switch "on" = ink track.
5. **Done/complete** = ink ✓ icon + text label ("Done", "Logged"); optional `--ct-drop` (light blue) background. Not lime.
6. Blue (`--ct-magenta` strong blue) = info and Finish. Amber = warning. `--ct-danger*` = destructive and errors only.
7. Never colour alone: every status has a text label.
8. Non-text contrast ≥ 3:1 for input borders, chip outlines, focus rings. **Add** `--ct-border-strong: #8A8A8A` (3.4:1 on white, 3.1:1 on surface). `--ct-border` (#EDEDED) is for dividers/cards only.

## 3. Focus

1. Visible focus ring on every interactive element via `:focus-visible`: **2px ink outline, 2px offset** (already in `globals.css`; don't override it with `outline: none`).
2. On ink-filled and red buttons: white 2px inner ring + ink outer ring (`box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--ct-ink)`).
3. Never lime. Inputs: ink border on focus *plus* the ring (fix `.input:focus-visible { outline: none }`).

## 4. Buttons

Always kit `Button` / `ButtonLink`; no page-level button CSS.

| Variant | Look | Use |
|---|---|---|
| `primary` (Main) | ink fill, white text, decorative lime under-shadow | the one main action (Assign, Send, Post, Sign in). **Max one per view.** Hierarchy must read without the shadow. |
| `create` (Add/New) | lime fill, 1.5px ink border, ink text, "+" prefix | making a new thing. Only lime button. |
| `secondary` | 1.5px ink outline, transparent | Cancel, alternatives |
| `quiet` (tonal) | `--ct-surface` fill, ink text, no border | repeated inline row actions (Assign, Resend, Show all) so long lists stay calm |
| `danger` | `--ct-danger` fill, white text | **only** the confirm button of a destructive confirm |
| danger menu item | red text, no fill | "Delete…", "Remove…" in ⋯ (`MoreMenuItem.danger`) |
| `finish` | blue fill | Finish in live sessions only (exists today) |

1. Min height 48 (`--ct-button-min-height`); compact 44 (dense toolbars, rows). Icon-only = 44×44 + `aria-label`.
2. **Disabled = same button at 50% opacity**, no under-shadow, `cursor: not-allowed`, set with `aria-disabled="true"` (not `disabled`) so it stays focusable; activating it does nothing but shows/announces why, e.g. helper text "Pick at least 1 client" linked by `aria-describedby`.
3. `pending` = `aria-busy` + spinner/label ("Saving…"), not a different colour.
4. A button that can't do anything in the current state is disabled-with-reason or validates inline (C Post, C#3 Send).

## 5. Pop-ups: one `AdaptiveDialog`

| Condition | Form |
|---|---|
| viewport width < 600 **or** height < 500 (phone, phone landscape, iPad Split View / Slide Over) | bottom **sheet**: grows to content up to ~90% height; long forms (Assign, exercise picker, scan entry) may go full-screen |
| otherwise | **centred dialog** relative to the viewport, `size="medium"` 560 or `"wide"` 800 |

1. Never a fixed height: `max-height: min(90dvh, visualViewport.height − margins)`.
2. **Header pinned** (title left, one close style right: 44px grey circle ×). **Footer pinned** (actions). Only the body scrolls; one scroll area, no nested scrolling lists. No extra "Close" footer button.
3. Footer padding includes `env(safe-area-inset-bottom)`. With the keyboard open, the footer stays above it (`visualViewport`) and the focused field scrolls into view (`scroll-margin`).
4. **No dialog opens another dialog.** Sub-choices (dates, times) are native inputs or an inline step in the same dialog (‹ Back).
5. ⋯ is a **menu**, not a dialog: popover on tablet/desktop, action sheet on phone. It closes before any dialog it triggers opens.
6. Close by ×, Esc, backdrop tap, swipe down. With **unsaved changes** any of these asks "Discard changes?" (Keep editing / Discard); with no changes it closes at once.
7. Focus moves into the dialog on open (`showDialog`; pickers on touch don't pop the keyboard), is trapped while open, and returns to the trigger on close.
8. Footer buttons: phone = full width, main on the right (or top when stacked); larger = right-aligned, main last.

## 6. Search: one `SearchBox`

1. Height 48, magnifier icon left, clear × (44px target) whenever there's text, border `--ct-border-strong` (or ink), no card or Search button around it.
2. Search-as-you-type through the shared `smartFilter` / `searchClients` / `searchExercises` (`packages/shared/src/search`). Never `.includes()`.
3. `type="search"`, `enterkeyhint="search"`, autocorrect/autocapitalize/spellcheck off, `aria-label` required. Enter only closes the keyboard (may trigger a server fallback past the list cap).
4. Placeholder "Search <things>". Query kept in `?q=` on list pages so Back restores results.
5. No results: one line `No workouts match “x”` + a Clear search action.
6. On phone list pages search is sticky under the collapsing large title.

## 7. Lists and rows: `ListRow`

1. Plain rows with dividers on **all sizes**: no outer box, no card-in-card (C#4, B Programs, A Documents).
2. The **whole row opens the item** (min 56px on phone), with hover and focus states. No 20–24px name links (B).
3. Layout: leading avatar/thumb · title (≤ 2 lines, then ellipsis) · one meta line · trailing: **at most one visible action (`quiet`) + ⋯**. Same trailing pattern on every row of a list (A#10, B#7).
4. Status = text chip, same position in the meta line. Leave out empty fields ("—", "Not logged yet").
5. Desktop (and tablet landscape where needed) may use a table **with column headers**; below that `ListRow`. Switch at the shared breakpoint.
6. Right-click on a row may open the same menu as ⋯ (optional, never the only path).
7. > ~50 items: "Show more" or paginate (A Clients Invited).

## 8. Navigation, headers, phone actions

**Canonical nav order (from `layout.tsx` / `phone-tab-bar.tsx`):** Home · Clients · Library (Workouts, Exercise library, Programs) · Messages · Meals · Activity · Community; bottom: Help · Profile.
- iPhone tab bar: Home, Clients, Library, Messages, More (Meals, Activity, Community, Help, Profile).
- Rail and sidebar show the same items in the same order. **Fix:** the sidebar renders Messages last; move it to straight after Library.

**`PageHeader`**
1. Optional back link "‹ Parent" (one style everywhere), h1 title, optional count/subtitle, actions on the title row: max one main/create button + ⋯.
2. Title appears once (B#3). In an editor the title is the editable name.
3. Counts count what the coach means (clients, not clients + invites).

**iPhone**
1. **List pages** keep the tab bar; "+ New <thing>" sits top-right (label may shorten to "+ New" with full `aria-label="New workout"`). Large title collapses on scroll; search stays sticky. **No FAB.**
2. **Editing screens** (builder, forms, live log) hide the tab bar and use a bottom **`PhoneActionBar`**: main action(s) in thumb reach, above `env(safe-area-inset-bottom)`; page gets bottom padding equal to the bar; fields use `scroll-margin-bottom`; with the keyboard open the bar rides above it or hides, never covering the focused field.
3. Tablet/desktop: the same actions sit in `PageHeader` (or a sticky footer for long editors).

**Workout builder**
1. **No autosave** (Live Sync would push half-finished edits to clients' calendars). Saving is always explicit.
2. **Save appears only when dirty.** No unsaved changes → no Save button, just a quiet "All changes saved" status. The moment something changes → Save (`primary`) appears with an "Unsaved changes" status. While saving: "Saving…" (`pending`); on failure an inline "Couldn't save — Retry". Status text is `aria-live="polite"`.
3. The existing leave-page warning (unsaved changes) stays.
4. "+ Exercise" (`create`) is otherwise the only loud button. Phone bottom bar: "+ Exercise" + ⋯, plus Save when dirty.
5. **Exception to the header rule (PO/coach request, Luis):** on tablet/desktop the builder header keeps Reorder, "+ Pick one" and "+ Section" visible as `secondary` (outline) buttons beside "+ Exercise". "+" marks any add action; only the main add ("+ Exercise") is lime. On phone they live in the More sheet.

**Library menu**
1. Desktop (labelled sidebar ≥ 1200): Library expands **in the sidebar** (Workouts, Exercise library, Programs as indented items); expanded while on any Library page. The page's segmented tabs stay (they're the in-page switch); the sidebar shows where you are.
2. Tablet (icon rail): a small **menu** beside the Library icon, aligned to it, **no dimming**; closes on outside tap/Esc; focus moves into it and returns to the icon.
3. Phone: the Library sheet (tab bar).
4. Labels: "Workouts", "Exercise library", "Programs" everywhere.

**Back and swipe-back go exactly one step**
1. Every full-screen editor, sheet or pop-up that covers the page **pushes a history entry** (e.g. `?exercise=<id>`, `?sheet=assign`), so Back / iOS swipe-back closes that layer and returns to the page under it — never jumps to the previous page.
2. Back from a layer with unsaved changes shows the "Discard changes?" prompt (same as ×/Esc).
3. Opened layers are restorable from the URL (refresh/deep link reopens them); closing replaces history state so Forward doesn't reopen stale layers.
   - **For now:** only `AdaptiveDialog` pop-ups put themselves in the address (`?sheet=<id>`). Other pop-ups, sheets, menus and full-screen editors are opened with `openLayer` / `useBackLayer`. They get a history step but no address, so a refresh or a shared link does not reopen them. After a reload, their old steps are left in the tab's history. Back over one shows the same page (it doesn't reopen anything, and it never leaves the app early). That is accepted until a layer is made restorable on purpose (e.g. `?exercise=` for the builder).
   - How: `lib/history-layers.ts` keeps the one stack. `openLayer(dialog)` replaces `showModal()`. `useBackLayer(open, close)` is for React-state menus and panels. `useHistoryLayer` is what AdaptiveDialog uses. `useUnsavedGuard(dirty)` is for pages with unsaved changes (Back, links and closing the tab ask "Discard changes?"). Links and Back are guarded automatically. Code that navigates from a guarded page must ask too: on a button that calls `router.push`, `if (!(await guard.confirm())) return;` first. After a save (nothing left to lose), call `await guard.release()` before `router.push`/`replace`.
4. Client-page tabs and calendar views are kept in the URL (`?tab=`, `?view=`) with **replace** (no history step): one Back leaves the client page, and refresh/deep link still restores the selected tab/view.

**Other long edit screens** (Profile, program details, meal editor) use the same "Save appears only when dirty" pattern, with the "All changes saved" / "Unsaved changes" status and the leave-page warning. Short forms inside dialogs keep a normal footer Save, disabled-with-reason until valid.

## 9. Forms and validation

1. Labels above fields; "(optional)" in the label; units as suffix ("kg", "kcal").
2. Correct `type`, `inputmode`, `autocomplete`, `enterkeyhint`; name fields use `notAContact`. Password show/hide toggle.
3. Tap targets ≥ 44px incl. checkboxes/radios (whole label row is the hit area); logging controls 54 (`--ct-tap-logging`).
4. Read-only values are text, not fields (C Profile email). New and Edit share field order (C Meals).
5. Fixed choices (muscles, equipment, measurements) = the same chip control on every size; no free text, no dropdown-vs-chips split.
6. **Errors:** `--ct-danger` border + ⚠ icon + message **under the field** in `--ct-danger-deep`, linked with `aria-describedby`, `aria-invalid="true"`. Validate on blur and on submit. On submit with errors: a summary at the top ("2 fields need attention", links to each) and focus moves to it.
7. Save placement: header (larger sizes) or `PhoneActionBar` (phone). Long edit screens show Save only when dirty (§8 Workout builder).

## 10. Destructive actions

1. Never inline on every row: in ⋯ as red text "Delete…" / "Remove…" (C#1, A Invited Cancel).
2. Confirm in `AdaptiveDialog`: title names the thing ("Delete “Full Body A”?"), body says what happens and if it can be undone; buttons Secondary "Cancel" + `danger` named after the action ("Delete workout"). Phone: full width, stacked, Danger on top.
3. A blocked delete says why and links the blocker ("Used in 12-Week Hypertrophy — open it").
4. Easily undone actions (move, apply to all, archive) skip the confirm and use a toast with Undo.
5. Delete/Remove never sits in the Save/Cancel group.

## 11. States, toasts, motion

**States**
1. Loading lists: skeleton rows in the real row shape (no full-page spinner).
2. Empty: one line of text + the `create` button ("No workouts yet" · "+ New workout"). Empty search uses §6.5.
3. Error: inline message where the content would be + "Retry" button. Never a blank page.
4. Offline: a slim note at the top ("You're offline — changes will save when you're back"); disable actions that need the network with a reason.

**Toasts**
1. One at a time, bottom-centred, **above** the tab bar / action bar / safe area (top-right is not used).
2. Short text + optional single action (Undo); stays ~5s (longer if it has Undo and focus/hover is inside it); `aria-live="polite"` (`role="status"`).
3. Never for errors that need action; those are inline.

**Motion**
1. Sheets slide up/down (~200–250ms ease-out); dialogs fade/scale lightly; drag-to-reorder animates neighbours moving.
2. `prefers-reduced-motion: reduce` → no slides/scale/parallax; use instant or opacity-only transitions.

## 12. Definition of done (any UI PR)

1. Mockup approved by the PO showing phone, tablet and desktop.
2. Screenshots in the PR at **390×844 (and 375×667 for forms/pop-ups), 820×1180, 1280×800**; pop-ups shown open; plus phone landscape (844×390) for pop-ups.
3. Checked yourself in Xcode simulators + Maestro for phone/iPad (keyboard, safe area, Split View).
4. Automated 3-size Playwright check: no horizontal scroll · no target < 44px · no text < 12px · main action visible on first screen (or in a pinned bar/footer) · no title ellipsis at 375 for seed names.
5. By eye: ≤ 1 main button; lime only on create; no lime selected/done; focus ring visible on every control (Tab through); disabled buttons focusable with a reason; long editors show Save only when dirty; title once; "‹ Parent"; plain `ListRow`s, whole row opens; `SearchBox` + smart search; `AdaptiveDialog` (pinned header/footer, no nested dialogs, Discard prompt, focus returns); states (loading/empty/error) present; only `var(--ct-*)` tokens and shared breakpoints; Back/swipe-back closes exactly one layer (test `page.goBack()` after opening every sheet/editor/dialog); Library menu per §8.
6. `pnpm check` (typecheck, lint, tests) passes on hosted CI.

---

## 13. Inventory: what breaks the rules today

| Rule | Already follows | Breaks today |
|---|---|---|
| Breakpoints/gutters | `coach.module.css` 600/1200, `WEB_PHONE_MEDIA`, container queries in clients/ui/calendar | off-scale widths in ~15 files (480, 520, 560, 640, 700, 760, 767.98, 900, 1000, 1024, 1365.98); no `desktop` token; no 32/40/48 space tokens; desktop gutter not 48; chips stack at 820 (A#2), Meals editor below list (C#2), Messages single column at 820 (C) |
| Lime = create only | `.newButton` (Meals/Programs/Exercises) | lime as selected: progress `.range`, builder `.measureChip`, assign `.dayChip`, calendar `.result`/`.programChoice`, exercise-search `.rowWrap[data-active]`, programs `.switch` on; lime-on-ink pills in exercises `.pill` and exercise-search `.filter`; lime Assign on every row (B#7) |
| Segmented tabs | — | clients `.segment[aria-selected]` is ink fill → change to white pill + ink border |
| Focus | global `:focus-visible` ring | `.input:focus-visible { outline: none }`; no inner white ring on ink/finish buttons |
| Buttons | kit `primary`/`secondary`/`finish` | no `create`/`quiet`/`danger` variants; per-page `.newButton`/`.miniButton`/`.smallButton`/`.addButton`; disabled at 0.7 via `disabled` attr (unfocusable, no reason); two primaries in builder (B#4); disabled Send looks broken (C#3); Remove client neutral outline (A) |
| Builder Save-when-dirty | leave-page warning | builder Save always shown top-right (B); no saved/unsaved status; Profile, program details, meal editor show Save always |
| Pop-ups | `sheet.module.css`, `set-sheet` (keyboard-aware), `showDialog`, `focus-trap.ts`, `MoreMenu` | ~28 `<dialog>`s with own CSS (invite, confirm-button, row-actions, measures, copy-week, move-slot, workout-picker, workout-sheet, slot-summary, program-details, delete-program/-workout, meal-form, sign-out, exercise-picker, block-menu, finish-sheets, exercise filters…); Assign footer scrolls off on iPad (A#1); Invite actions below fold on SE (A#7); nested scroll in Assign (A); centred modals on phone (B#6); full-screen Rename (B); three close styles + duplicate "Close" (B); no phone-landscape/Split View rule; no Discard prompt |
| Search | Clients, Meals, Programs, Library panel, `ClientCombobox`, Exercises (reference look) | Workouts card + black Search button (B#5, `workouts/workout-list.tsx`); Messages `filterInbox` uses `.includes()`; `assign-targets.ts filterClients` plain substring; Day sheet / Library panel no icon/placeholder (B); `--ct-border` input borders fail 3:1 |
| Lists | Exercises, Meals phone rows, clients phone rows (#144) | card-in-card Messages/Activity/Community (C#4), Programs (B); bordered lists on desktop; 24px name links (B); stacked Edit/Delete per row (A Body); empty invite fields (A); tables without headers |
| Nav / phone actions | Exercises/Programs "+ New" on title row; builder "+ Exercise" bar; set-sheet bar | sidebar Messages order ≠ tab bar; live log Finish 1,200px down (A#9); Profile Save at end of form (C); tab bar shown on editors; Training tab actions push calendar down (A#4); mixed back links "← Back"/"← Parent"/"‹ Parent"; workout name 3× (B#3) |
| Forms | `TextField`, `notAContact` | errors use `--ct-magenta` (now strong blue) → switch to `--ct-danger`; no error summary; 20–24px checkboxes (A Documents, B "Each side"); free-text muscles/equipment; chips vs dropdown (B Measurements); field order New ≠ Edit (C Meals); read-only email looks editable (C); sign-in under keyboard on SE (C) |
| Destructive | `MoreMenu.danger`, Finish "Discard this session?", Sign out confirm | inline Remove ×9 (C#1); Cancel invite beside Resend (A); pink-filled Delete in phone menu (B); Delete in Save cluster on iPad Meals (C); blocked delete doesn't name program (B) |
| States/toasts/motion | some reduced-motion handling (11 files) | no shared skeleton/empty/error/offline components; no shared toast with Undo |

## 14. Build order

1. **Button set + focus ring**: add `create`, `quiet`, `danger`; `aria-disabled` 50% rule with reason; inner/outer ring; `--ct-border-strong`, space 8/10/12, `breakpoints.desktop` tokens. Replace page `.newButton` etc.; remove lime-as-selected as screens are touched.
2. **`AdaptiveDialog`** (+ thin `ConfirmDialog`, `Menu` for ⋯) from `sheet.module.css` + `showDialog` + `focus-trap.ts`. First: Assign (A#1), Invite (A#7), Reorder/Summary/Day sheet/Rename/Delete (B#6).
3. **`SearchBox`** + smart-search hook. First: Workouts (B#5), Messages `filterInbox`, Assign `filterClients`.
4. **`ListRow` + `PageHeader`** (incl. sidebar order fix). First: Workouts/Programs (B#7), Messages/Activity/Community (C#4), Clients (A#10), builder title (B#3).
5. **`PhoneActionBar`** + Save-when-dirty with saved/unsaved status (builder, Profile, program details, meal editor). First: live log Finish (A#9), builder, Profile.
6. **States + toasts** (skeleton, empty, inline error, offline note, toast with Undo).
Then the breakpoint clean-up file by file as each screen is touched, and the 3-size Playwright spec.
