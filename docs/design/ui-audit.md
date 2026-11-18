# UI audit (automatic 3-size check)

`apps/web/e2e/ui-audit.spec.ts` is the automatic part of the UI rulebook's "Definition of done" (§12 of
`docs/design/ui-rules.md` once it lands). It runs in the normal e2e job on every PR, spread over the 4 shards.

## What it checks

Every main coach page (Home, Clients, each client tab, Workouts, a workout builder, Exercises, an exercise, Programs, a
program, Meals, Messages, Activity, Community, Profile, Help) and the sign-in page, at three sizes:

| Size | Viewport | Touch | Smallest control |
|---|---|---|---|
| phone | 390 x 844 (mobile) | yes | 44 x 44 |
| tablet | 820 x 1180 | yes | 44 x 44 |
| desktop | 1440 x 900 | no | 24 x 24 (WCAG 2.5.8) |

| Rule | Fails when |
|---|---|
| `hscroll` | the page scrolls sideways (`scrollWidth` > screen width + 1) |
| `target` | a visible button, link, field, `[role=button]` or `summary` is smaller than the size above. A field inside a `<label>` is measured by its label. Inline links inside a paragraph are exempt. |
| `text` | any visible text is under 12 px |
| `overlap` | two visible controls cover each other (content scrolling under a pinned bar does not count) |
| `logo` | there is not exactly one visible CalTracker logo |
| `heading` | the page's `h1` is missing or not on the first screen |
| axe | axe-core finds a serious or critical WCAG 2.2 AA problem (phone and desktop only) |

A failing test lists every problem on every page of its group in one message, e.g.

```
## Clients (/clients) at phone
  - target: <button _iconButton> "More" is 32x32 (min 44)
  - axe color-contrast (serious): Elements must meet minimum color contrast ratio thresholds. Element: <span ...>
```

`_iconButton` is the element's CSS module class without its build hash, so you can find it in the code and point an
allow-list entry at it with `[class*="_iconButton"]`.

## Run it

Needs local Supabase running (`pnpm db:start`) and the web env (`pnpm --filter web env:local`).

```sh
cd apps/web
pnpm build                                       # a production build; dev mode is slower and less exact
E2E_WEB_PORT=3461 pnpm exec next start -p 3461 & # any free port
E2E_WEB_PORT=3461 pnpm exec playwright test e2e/ui-audit.spec.ts
```

Add `--grep "at phone"` (or `tablet`, `desktop`) for one size, or `--grep "library"` for one group of pages.

## The allow-list (known issues)

Screens built before the rulebook still break some rules. Those problems are listed in
`apps/web/e2e/ui-audit-allowlist.ts` (`UI_ALLOW` for our rules, `AXE_ALLOW` for axe) so the check passes today and
catches anything new. Each entry names the rule, the page(s), optionally the size(s), a selector for the offending
element and the reason, ending in "TODO standards migration".

Rules for the list:

- **It only shrinks.** A new screen, or a change to a migrated screen, must pass without new entries. Fix the screen.
- **When you migrate a screen, delete its entries** and run the spec at all three sizes. If it passes, you're done; if
  not, finish the fix rather than putting the entry back.
- Entries that excused nothing in a run show as "allow-list entry not needed here" annotations in the Playwright
  report (CI's `playwright-report` artifact). Those are candidates to delete; check them with a local run first,
  since the shared demo data varies between runs.
- Keep selectors narrow (a class, an `aria-label`), so the entry can't hide a new problem elsewhere on the page.
