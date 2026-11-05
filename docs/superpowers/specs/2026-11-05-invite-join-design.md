# Join from the invite link: design (addendum to the coaching app spec)

**Status:** draft for product owner review, 2026-11-05. Ships as its own small PR next to "Remove client", before the launch coach invites their clients.

## Why
Today an invited client gets two emails (the invite, then "confirm your email"), lands on a web page that says "Coming soon", and has to retype the name and email the coach already entered. The invite email is the first thing all ~50 of the launch coach's clients will see, so it should take under a minute and feel like one step.

## What the client sees
1. **Invite email:** unchanged, except the button says **"Join {coach's business}"**.
2. **Tapping the link:**
   - **App installed:** the app opens on a **"Join {coach's business}"** screen. (Until the paid Apple account exists, there is one extra tap: the link opens the web page and the client taps **Open in CalTracker**. See "Apple" below.)
   - **App not installed:** the web invite page shows the App Store button and says: "Already installed? Tap **Open in CalTracker**." After installing, the client taps the link in the email again.
3. **Join screen:**
   - Title: "Join {coach's business}"
   - The coach's first and last name for the client, pre-filled and editable (in case of a typo).
   - Email shown, not editable: "You'll sign in with sam@example.com".
   - One field: **Create a password** (at least 8 characters, show/hide toggle, iOS strong-password suggestion allowed).
   - Button: **Join**.
4. **After Join:** the client is signed in and lands on the Today screen, already connected to their coach. **There is no "confirm your email" email**: tapping the link in the invite already proves they own that inbox.
5. **Problem cases on the Join screen:**
   - **Already has a CalTracker account with that email:** "You already have an account. Sign in to join {coach's business}." The button goes to Sign in with the email filled in, and signing in connects them (this already works today).
   - **Invite expired:** "This invite has expired. Ask your coach to send a new one."
   - **Invite already used:** "This invite has already been used. Sign in instead." The button goes to Sign in.
   - **Invite cancelled or link broken:** "This invite link isn't valid. Ask your coach to send a new one."
   - **Email belongs to a coach account:** "This email is a coach account. Ask your coach to invite a different email."
   - **No connection:** "No connection. Check your internet and try again." The form keeps what they typed.

## What stays the same
- **Coaches** still invite from the dashboard exactly as today.
- **Regular sign-up in the app** (without an invite link) still sends a confirmation email. A client who signs up that way with the invited email is still connected automatically after confirming.
- **Invites still expire after 14 days**, and resending makes a new link.

## Small extra in this PR
**Check-email screen** (after a regular sign-up): add "Already have an account? **Sign in**". Signing up again with an existing email shows "check your email" but sends nothing, because Supabase deliberately doesn't reveal which emails have accounts. This line gives those people a way out.

## Apple
- **Now (free Apple account):** the web page's **Open in CalTracker** button uses the app's own link (`caltracker://invite/{token}`). This works on the PO's phone today.
- **Later (paid Apple Developer account, $99/yr, also needed for TestFlight):** add "universal links", so the `https://caltracker.app/invite/...` link in the email opens the app directly with no extra tap. The app gets the Associated Domains setting, and the website serves Apple's `apple-app-site-association` file for `/invite/*`. This is a follow-up and needs no other change to the Join flow.

## How it works (technical)
- **New Edge Function `accept-invite`** (public; the invite token is the proof).
  - Input: `{ token, password, firstName, lastName }`.
  - Steps:
    1. Hash the token, then lock the invite row (`for update`).
    2. Require `accepted_at is null` and `expires_at > now()`.
    3. Look up the email: if it belongs to a confirmed user, return `account_exists`; if it belongs to a coach, return `coach_account`.
    4. **New email:** create the user server-side with `email_confirm: true` and the first/last name metadata.
    5. **Existing but never-confirmed account** (someone signed up and never tapped the confirm email): set the new password and mark it confirmed. The token proves inbox ownership, and replacing the password stops anyone who pre-registered that email from keeping access.
    6. Add the client membership and mark the invite accepted, in one transaction through a new `security definer` SQL function `accept_invite_for(user_id, invite_id)` (executable by `service_role` only).
  - Output: `{ ok: true, email }` or `{ ok: false, reason: 'expired' | 'used' | 'not_found' | 'account_exists' | 'coach_account' | 'weak_password' }`.
  - The app then signs in with `signInWithPassword(email, password)`, so tokens are never passed around.
  - Uses the service-role key **inside the Edge Function only** (never in app code), like `send-invite`.
  - Validation: the password follows the project's auth rules (minimum 8); names are trimmed, 1 to 100 characters, and the coach's names are used when blank.
- **Name rule:** the client's edited name wins, and the invite row keeps the coach's original.
- **Mobile:** new route `src/app/invite/[token].tsx` (outside the auth group, reachable signed out). On open it calls `get_invite_preview(token)` (already public and returns first/last name). If someone is already signed in on the phone, it asks "Sign out of {current email} to join?"
- **Web invite page:** add **Open in CalTracker** (`caltracker://invite/{token}`) above the store buttons, and change the copy to "Already have the app? Open it and join."
- **Email:** button label "Join {business}". The link format is unchanged.
- **Security:**
  - The token is single-use (the locked row plus `accepted_at`) and expires after 14 days.
  - Only the hash is stored, as today.
  - Tokens are base64url, so guessing one is impractical. The function also rejects malformed tokens before touching the database.
  - Known limit of `caltracker://` links: another app could register the same scheme. The token only works once and only for the invited email, and universal links remove this later.

## Testing
- **Deno unit tests** for `accept-invite`:
  - new user
  - existing confirmed user → `account_exists`
  - unconfirmed user → password replaced and confirmed
  - coach email → refused
  - expired, used and unknown tokens
  - two concurrent calls → only one succeeds
  - weak password
  - blank and over-long names
- **pgTAP** for `accept_invite_for`:
  - not callable by `anon` or `authenticated`
  - creates exactly one membership
  - marks the invite accepted
- **Maestro:** open `caltracker://invite/{token}` → names pre-filled → set password → Join → Today screen shows the coach.
- **Playwright:** the web invite page shows **Open in CalTracker** with the right link.
- **Phone check for the PO:**
  1. Invite a new +email.
  2. Tap the email link, then **Open in CalTracker**.
  3. Set a password.
  4. Check that you land signed in with your coach shown and that no second email arrives.

## Out of scope
- Universal links (waits for the paid Apple account; see above).
- "Deferred" deep links that survive installing the app from the store (the client taps the email link again instead).
- Magic-link or passwordless sign-in.
- Android (the app is iOS-first for launch; the same route works on Android when we ship it).
