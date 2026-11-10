# CalTracker — Design System (Version 1)

**Date:** 2026-11-03
**Status:** Approved (2026-11-03)
**Applies to:** mobile app (phone + iPad), coach web dashboard
**Product spec:** `2026-11-03-coaching-app-design.md`
**Approved mockups:** `docs/design/mockups/` (phone, coach dashboard, iPad landscape, iPad portrait)

---

## 1. Direction

**"Candy Pop + Sticker Book":** a clean, friendly base with playful moments.

- **Candy Pop** supplies the base: a white canvas, bold pastel colour blocks, black buttons, and a confident grotesque typeface.
- **Sticker Book** supplies the play: the animal collection is a sticker book of die-cut stickers, and small handwritten notes add warmth.
- References the product owner liked: Apple Fitness (clear progress), Strava (calm, sporty), Duolingo (celebration, chunky shapes).

### Principles
1. **Calm during the workout, playful around it.** Logging screens are fast and uncluttered. Celebration happens before and after: the home screen, badge reveals and the sticker book. This lesson comes from Hevy/Strong vs. cluttered loggers.
2. **Colour is a reward, not wallpaper.** Pastel blocks highlight stats and wins. Everything else is white, light grey and black. On the coach dashboard colour is used even more sparingly, so long sessions stay easy on the eyes.
3. **Built for sweaty thumbs.** Big tap targets, steppers instead of typing, and numbers readable at arm's length.
4. **One handwritten note per screen, at most.** Handwriting is a garnish, not a font for content.
5. **Ours, not borrowed.** Our own animal illustrations and our own comparison list. No Everfit or Duolingo assets, colours or characters.

---

## 2. Colour tokens

### Light (default)
| Token | Value | Use |
|---|---|---|
| `bg` | `#FFFFFF` | App / page background |
| `surface` | `#F4F4F4` | Inputs, steppers, secondary tiles |
| `surface-sidebar` | `#F6F6F4` | Dashboard sidebar, iPad client list |
| `border` | `#EDEDED` | Card borders, dividers |
| `ink` | `#121212` | Text, primary buttons, icons |
| `ink-muted` | `#121212` @ 60% | Secondary text |
| `lime` | `#C8F169` | Completed sets, positive stats, primary-button base shadow |
| `pink` | `#B9E3FF` (light blue since 2026-11-09) | PRs, celebration, unread counts |
| `blue` | `#B9E3FF` | Last-workout / info tiles |
| `drop` | `#E3F3FF` (very light blue) | Drop-set rows |
| `magenta` | `#2F6FE0` (strong blue) | Handwritten notes, Finish button, urgent dots |
| `magenta-deep` | `#1F4FB0` (deep blue) | Finish button base shadow |
| `amber` | `#FFB020` | Warnings (e.g. "program ends Fri") |
| `celebrate-bg` | `#FFF8D9` | Badge reveal background |
| `tape` | `#FFE48A` | Sticker-book tape strip |
| `danger` | `#B3261E` | Destructive links and borders (Delete account) only |
| `danger-deep` | `#8C1D18` | Label on the destructive button |
| `danger-bg` | `#FBE9E7` | Destructive button fill |

### Dark mode
Not in Version 1. The app and dashboard are light-only (forced light, ignoring the system setting). Components must read colours only through tokens, never hard-coded values, so dark mode can be added later by supplying a second token set. Text on pastel tiles is always `#121212`.

### Contrast rules
- Body text is `ink` on `bg` or `surface` (≥ 15:1).
- Text on any pastel tile is `#121212` (≥ 12:1). Never put white text on a pastel.
- `magenta` (≈ 4:1 against white) is used only where WCAG's large-text 3:1 rule applies. That covers magenta handwritten notes (Caveat 700 at ≥ 19 px) and the white Finish label on a magenta fill, which must be ≥ 19 px bold. Magenta is never the only carrier of meaning.
- Every token pair is verified with a contrast checker when `packages/design-tokens` is built, in both themes. A pair that fails is adjusted before use.
- Colour is never the only signal: a PR shows 🎉 plus the words "New PR", and a done set shows a ✓ as well as lime.

---

## 3. Typography

| Role | Font | Weight | Size (phone / iPad / web) |
|---|---|---|---|
| Screen title | Bricolage Grotesque | 800, −2% tracking | 22 / 24 / 24 |
| Big numbers (tiles, steppers) | Bricolage Grotesque, tabular numerals | 800 | 26 / 26 / 26 |
| Section heading | Bricolage Grotesque | 700 | 15–17 |
| Body | Bricolage Grotesque | 500 | 15 |
| Caption / label | Bricolage Grotesque | 500 @ 60% | 12 |
| Button | Bricolage Grotesque | 800, +3% tracking | 15–16 |
| Handwritten note | Caveat | 700, rotated −3° | 19–21 |

- Both fonts are Google Fonts (OFL licence). They are bundled with the app (`expo-font`) and served via `next/font` on the web.
- Support iOS Dynamic Type and Android font scaling up to 200%. Layouts must reflow, not truncate.
- Handwritten notes need an accessible label with the same text.

---

## 4. Shape, spacing, elevation

- **Spacing:** 4-pt grid. Common values are 4, 8, 10, 12, 14, 16, 18, 24.
- **Radius:** 12 (inputs, small buttons), 16 (buttons, steppers), 20 (cards, tiles), 999 (pills, chips, avatars), full circle (stickers).
- **Chunky buttons:** primary buttons have a solid 4 px bottom "base" in a contrasting colour, a nod to Duolingo:
  - lime under black buttons
  - magenta-deep under the Finish button
  - pink under Share
  - On press, the button moves down 2 px and the base shrinks.
- **Cards:** a 2 px `border` outline, no drop shadow.
- **Stickers:** a white 3 px ring, a soft shadow (`0 2px 6px rgba(0,0,0,.2)`), and a rotation between −8° and +6°.

---

## 5. Components

| Component | Notes |
|---|---|
| **Button — primary** | Black fill, white label, lime base. Min height 48 on phone and 52 on iPad. |
| **Button — secondary** | 1.5 px ink outline, transparent fill. |
| **Button — finish / destructive-ish** | Magenta fill, white label, magenta-deep base. |
| **Tile** | Pastel fill, radius 20, label caption plus big number. |
| **Card** | White, 2 px border, radius 20. |
| **Chip / tag** | Pill, 11–13 px bold, pastel or grey fill. |
| **Stepper** | `surface` fill with −/+ buttons at least 38 px (phone) or 40 px (iPad). Steps: **2.5 kg / 5 lb** and **1 rep**. Tap the number to type it instead. Lime when the set is done. |
| **Set row** | Set number · weight stepper · reps stepper · check button (54–58 px). Drop rows are indented with ↳ and use the `drop` fill. |
| **Check button** | Black with a lime ✓ when done; `#EDEDED` with a grey ✓ when not. |
| **Rest timer** | Black pill with a white countdown. Haptic and sound at zero. |
| **Exercise chips** | Progress through the workout: done = lime, current = black, upcoming = grey. |
| **Sticker** | Die-cut circle (ring, shadow, rotation). Sizes 44 (book), 120 (reveal). |
| **Sticker book** | Grid of stickers. Locked items have a dashed outline, are greyscale at 45% opacity, and carry the "next up" hint. A tape strip sits on the card top. |
| **Handwritten note** | Caveat in magenta, −3°. Used for the streak ("6 weeks strong! 🔥") and short coach-ish asides. |
| **Avatar** | Circle with initials on a pastel, or a photo. The selected state has an ink ring. |
| **Tab bar** (phone / iPad) | Today · Clients/Workouts · Messages · Community · More. Unread counts as pink pills. |
| **Sidebar** (web) | Logo, ⌘K search, nav with an active item in black. |
| **Command search (⌘K)** | Web dashboard: jump to any client. |

---

## 6. Key screens (validated in mockups)

### Phone (client) — portrait only
- **Today:** greeting plus a handwritten streak note; Today card (workout name, exercise count, START); "Last workout" blue tile with the animal plus "next up"; sticker-book card with tape.
- **Logging:** exercise title, "Last time" line, set rows with steppers, + Set / + Drop / Swap, rest timer, a small PR toast. No decoration.
- **Badge reveal:** `celebrate-bg`, "You lifted a rhino!", a big tilted sticker, total kg, sticker-book count, PR tile, **Share to community**, **Save image**.

### Coach web dashboard
- Sidebar with ⌘K search and nav.
- Header with a handwritten aside ("14 clients training today").
- Tiles: **Done this week** (adherence, with progress bar), **New PRs this week**, **Workouts today**, **Missed 2+ workouts**.
- **Today's clients:** clients with a workout assigned today, each with **Log session** or **View**.
- **Needs attention:** inactive clients (Message), programs ending (Assign), InBody due (Add scan).

### iPad (coach) — portrait and landscape
- **Home:** client cards (3 columns in landscape, 2 in portrait) with a hint chip and **Log session**. Shows "Client is logging" when the client has the workout open.
- **Session mode:**
  - Landscape: today's client list on the left, logging on the right.
  - Portrait: a row of client avatars across the top (tap to switch), logging at full width, rest timer and Finish side by side at the bottom.
  - Each client's session keeps its place when switching. Rotating the iPad never loses state.

### Breakpoints
- Phone: < 600 pt width, portrait locked.
- Tablet: ≥ 600 pt. Split session view at ≥ 1000 pt width (landscape); stacked below that.
- Web: sidebar collapses to icons below 900 px.

---

## 7. Illustration

- One style for all animals and landmarks: flat, rounded, chunky shapes, few colours drawn from the palette, a thick ink outline, slight exaggeration for humour. Each one is delivered as a sticker (white die-cut ring).
- About 30 animals/objects plus about 10 landmarks for distance badges (spec Section 6).
- Emoji are **placeholders during development only**. Sourcing the final art (commissioning an illustrator vs. a licensed set) is an open question in the product spec.

---

## 8. Motion

- **Badge reveal:** the sticker "slaps" on (scale 1.3→1, rotate −20°→−6°, 350 ms spring) with a haptic. Light confetti in the palette colours.
- **Set completion:** the check fills with a short haptic.
- **Button press:** a 2 px press-down.
- Honour "Reduce Motion": replace these with fades.

---

## 9. Accessibility

- Tap targets ≥ 44 pt everywhere, and ≥ 54 pt for logging checks and steppers.
- Contrast rules in Section 2.
- Dynamic Type and font scaling up to 200%.
- VoiceOver/TalkBack labels on steppers ("Weight 70 kilograms, adjustable"), stickers ("Rhino sticker, collected") and handwritten notes.
- Reduce Motion is supported (Section 8).

---

## 10. Implementation

- **Tokens live in one place:** new package `packages/design-tokens` (TypeScript), exporting colours (light only in V1; structured so a dark set can be added), type scale, radii, spacing and shadows.
  - **Web:** generates CSS custom properties (`--ct-lime`, …) consumed by CSS Modules. No CSS framework.
  - **Mobile:** a `useTheme()` hook returns the tokens for the current colour scheme, used with React Native `StyleSheet`.
- Components are built once per platform: React Native for mobile, React for web. They share token names and props where practical.
- Fonts: Bricolage Grotesque and Caveat, bundled (OFL).
- Phase 1's plain screens (sign-in, clients, invite page, exercise library, mobile sign-up) are restyled with the tokens at the start of phase 2.

---

## 11. Out of scope for this design system version
- Dark mode (token structure allows adding it later).
- Custom illustration production (style defined; art sourcing open).
- Coach-branded themes (later: coach packs / white-labelling).
- Apple Watch UI.
