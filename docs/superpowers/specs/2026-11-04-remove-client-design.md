# Remove client and cancel invite: design (addendum to the coaching app spec)

**Status:** draft for product owner review, 2026-11-04. Approved scope: soft remove that keeps history, built as its own small PR right after Phase 2 Part A merges and before the launch coach starts.

## Why
Coaches lose clients, and they send invites by mistake. Today the dashboard can only add people.

## What the coach sees (web dashboard, Clients page)
- **Each client row** gets a "⋯" menu with **Remove client**.
- **Confirm dialog:** "Remove Sam Lee? They'll lose access to your workouts, messages and community. Their history stays under Past clients, and re-inviting them brings everything back." Buttons: **Remove** (destructive) · **Cancel**.
- **Past clients:** a collapsed section under the client list, "Past clients (3)". Each row shows the name, email, "Removed 4 Nov 2026" and a **Re-invite** button. A past client's history (workouts, sessions, InBody) stays readable for the coach.
- **Each pending or expired invite** gets **Cancel invite** next to Resend, with a short confirm: "Cancel the invite to sam@example.com? The link in their email will stop working."

## What the client sees (phone app)
- On next open (or next refresh), the app shows the existing "Ask your coach for an invite" screen, worded for this case: "You're no longer connected to {workspace}. If that's a mistake, ask your coach to invite you again."
- Their account still exists. They can sign out, delete their account, or accept an invite from any coach.
- **V1 choice:** a removed client cannot see their old workouts. (Possible later: a read-only "Past training" view.)

## Rules
- **Remove is soft.** The membership gets `removed_at` and is kept, so all history rows (which carry `workspace_id` and `client_id`) stay intact.
- **Access ends immediately.** Every membership check (`is_member`, `is_coach_of` paths that read client membership, RLS helpers) ignores memberships with `removed_at` set. The client can no longer read or write anything in that workspace.
- **Re-invite restores.** When a removed client accepts a new invite from the same workspace, the claim clears `removed_at` on the existing membership instead of creating a new one, so their history reappears for both sides.
- **Joining another coach.** "A client belongs to exactly one workspace" applies to *active* memberships. A removed client may accept an invite from a different coach. The unique index becomes `where role = 'client' and removed_at is null`.
- **Cancel invite** deletes the pending invite row. The email link then shows the existing "invite not found" page. Accepted invites can't be cancelled (remove the client instead).
- **Only owners and staff** of the workspace can remove clients or cancel invites. Clients can't remove themselves this way (they can delete their account).
- **Not a delete.** Permanently erasing a client's data stays with the existing in-app account deletion (App Store requirement).

## Data and security
- Migration: `workspace_members.removed_at timestamptz null`; partial unique index updated; membership helper functions filter `removed_at is null`; claim function restores.
- `remove_client(workspace_id, client_id)` and `cancel_invite(invite_id)`: `security definer`, `set search_path = ''`, revoke execute from public/anon, check `is_coach_of(workspace_id)` at the top.
- pgTAP:
  - a removed client gets no rows from any workspace table
  - a coach of another workspace can't remove or cancel
  - a client can't call either function
  - re-invite restores the same membership
  - a removed client can join a different workspace
  - cancelled invite links return "not found"

## Testing
- Playwright:
  - remove, then see the client under Past clients
  - re-invite, then see them back in the client list
  - cancel an invite, then confirm it's gone and the link shows not found
- Maestro: a signed-in client who is removed sees "You're no longer connected…" after a pull-to-refresh.

## Out of scope
- Bulk remove.
- Removal reasons.
- Notifying the client by email.
- Read-only "Past training" for removed clients.
