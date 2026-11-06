# Coach profile: design

**Status:** approved in conversation on 2026-11-05. This is an addendum to the main spec
(`docs/superpowers/specs/2026-11-03-coaching-app-design.md`).

## Purpose

Clients should see who their coach is: a face, a name, the business and a short bio. The coach needs one place to
keep these up to date and to set their own units and password. Success means:
- a client opening the app sees the coach's photo and bio on "Meet your coach";
- the coach can change any of these details in under a minute.

## Coach dashboard: `/profile`

- **Placement:** a "Profile" item at the bottom of the sidebar, above Sign out. It shows the coach's photo or
  initials.
- **Fields** (one form, one **Save** button, with the "✓ Saved" status next to it):
  - **Photo:**
    - **Upload:** the coach picks an image file (JPEG, PNG, HEIC or WebP).
    - **Crop:** a square crop happens in the browser before upload.
    - **Compress:** the image is reduced to at most 1600 px on the long edge, plus a 256 px thumbnail, both WebP,
      following the project's media rule.
    - **Remove photo** goes back to initials.
    - The circle shows the photo, or initials when there isn't one.
  - **First name**, **Last name:** the existing name rules (`FirstName`/`LastName` in shared).
  - **Business name:** 1–80 characters. It is stored as the workspace name, so clients see "Welcome to {business}".
  - **Bio:** 0–300 characters, with a live counter ("212 / 300"). Plain text with line breaks; no links or
    formatting.
  - **Units:** lb or kg. This is the existing `profiles.units`.
  - **Email:** shown read-only. Changing it is out of scope for this version.
- **Change password:** a separate small form with current password, new password and confirm new password.
  - The new password follows the existing password rules: at least 8 characters, byte limit.
  - The current password is checked by re-authenticating before the update.
  - A wrong current password shows "That's not your current password."
- **Errors:** stale-deploy handling (`failureMessage` plus the reload prompt) as on the other forms.

## Data

- **Profile columns.** A migration adds `bio text not null default ''` with a check of `char_length(bio) <= 300` to
  `profiles`. `avatar_path` already exists.
- **Business name.** `workspaces.name` is updated by the owning coach only, through a definer function
  `update_workspace_name(p_name)` or an owner-only RLS update policy. Either way, there is a pgTAP test showing that
  another coach and a client can't change it.
- **Avatar storage:**
  - A new private Storage bucket `avatars`, with paths `{user_id}/avatar.webp` and `{user_id}/avatar-thumb.webp`.
  - A user can only write their own folder.
  - A user can read their own avatar and the avatars of people in their workspace: the coach and that coach's
    clients.
  - The web and the app render avatars from short-lived signed URLs.
  - pgTAP or storage policy tests prove cross-workspace reads fail.
- **What clients may read.** The client already has a workspace membership, so they get read access to their coach's
  profile name, bio and avatar path through the existing profile RLS. Extend it if needed, and test it: a client can
  read their own coach's bio, and not another coach's.

## Client app

- **"Meet your coach" card** (`first-time-welcome.tsx`, and wherever the coach is shown):
  - the coach's photo, or initials;
  - "{First} {Last}" and the business name;
  - the bio.
  - An empty bio hides the bio line.
- **Today header:** the small coach chip, if present, uses the thumbnail.
- **Messages (later):** the same thumbnail.

## Testing

- **Vitest:**
  - the shared bio and business-name validators: limits and trimming;
  - the image resize helper's dimensions, where it's a pure function.
- **pgTAP:**
  - the bio column check;
  - who can update the workspace name;
  - a client reading their coach's profile versus another coach's.
- **Storage policy tests:**
  - a user can only write their own folder;
  - cross-workspace reads are denied.
- **Playwright:**
  - edit names, business, bio and units, then save, and see "✓ Saved";
  - reload and the values persist;
  - upload a photo and the avatar appears in the sidebar;
  - remove it and the initials return;
  - a wrong current password shows the error, and a correct one changes the password, after which signing in with
    the new password works.
- **Maestro:** the client's Meet your coach card shows the coach's bio and business name.

## Out of scope

- Changing the email address.
- Profile photos for clients.
- Public coach pages or links.
