# Remove client and cancel invite: design (addendum to the coaching app spec)

**Status:** approved by the product owner on 2026-11-05, including the V1 choice below. Approved scope: soft remove that keeps history, built as its own small PR right after Phase 2 Part A merges and before the launch coach starts.

## Why
Coaches lose clients, and they send invites by mistake. Today the dashboard can only add people.

## What the coach sees (web dashboard, Clients page)
- **Each client row** gets a **Remove** button.
- **Confirm dialog:** "Remove Sam Lee? They'll lose access to your workouts, messages and community. Their history stays under Past clients, and re-inviting them brings everything back." Buttons: **Remove** (destructive) · **Cancel**.
- **Past clients:** a collapsed section under the client list, "Past clients (3)". Each row shows the name, email, "Removed 4 Nov 2026" and a **Re-invite** button. A past client's history (workouts, sessions, InBody) stays readable for the coach.
- **Each pending or expired invite** gets **Cancel invite** next to Resend, with a short confirm: "Cancel the invite to sam@example.com? The link in their email will stop working."
- The app re-checks the client's coach whenever it comes back to the foreground, so the removal shows without signing out.

## What the client sees (phone app)
- On next open (or next refresh), the app shows the existing "Ask your coach for an invite" screen, worded for this case: "You're no longer connected to {workspace}. If that's a mistake, ask your coach to invite you again."
- Their account still exists. They can sign out, delete their account, or accept an invite from any coach.
- **V1 choice:** a removed client cannot see their old workouts. (Possible later: a read-only "Past training" view.)

## Rules
- **Remove is soft.** The membership row is deleted, and a `past_clients` row keeps the name, email, join date and who removed them. History rows (which carry `workspace_id` and `client_id`, not a link to the membership) stay intact.
- **Access ends immediately.** With no membership, every existing check (`is_member_of`, `shares_workspace_with`, all RLS) already denies access. No helper had to change.
- **Re-invite restores.** Re-joining the same workspace (`claim_invites` or `accept_invite_for`) inserts the membership again, and a trigger clears the `past_clients` row. The client's history reappears for both sides because it was keyed on the workspace and client all along.
- **Joining another coach.** A removed client has no active membership, so they may accept an invite from a different coach (the existing one-workspace-per-client index is unchanged).
- **Cancel invite** deletes the pending invite row (the coach's existing RLS delete permission, limited to unaccepted invites). The email link then shows the existing "invite not valid" page. Accepted invites can't be cancelled (remove the client instead).
- **Only owners and staff** of the workspace can remove clients. Clients can't remove themselves this way (they can delete their account).
- **Not a delete.** Permanently erasing a client's data stays with the in-app account deletion (App Store requirement); deleting the account also erases the `past_clients` row.
- **Future history tables** (Phase 3 workouts, sessions, InBody) must let a coach read rows of their workspace's past clients: their policies check `is_coach_of(workspace_id)`, not the client's current membership.

## Data and security
- Migration `20261105000020_remove_client.sql`:
  - **`past_clients` table:** coaches can read their own workspace's rows (RLS), and only the function writes them.
  - **`remove_client(workspace_id, client_id)`:** `security definer` with `set search_path = ''`, not callable by anon. It checks `is_coach_of` first (42501 otherwise) and raises P0002 when the person isn't a client there.
  - **`my_removal()`:** lets the phone app word the "ask your coach" screen.
  - **Trigger:** clears `past_clients` when someone re-joins.
- **pgTAP (`remove_client.test.sql`)** covers:
  - privileges
  - another coach, a client and the client themselves can't remove
  - only clients can be removed
  - the removed client loses access to the workspace, the coach's profile and the list
  - other coaches can't see the list
  - re-invite restores the client and clears the record
  - a removed client can join a different coach

## Testing
- Playwright:
  - remove, then see the client under Past clients
  - re-invite, then see them back in the client list
  - cancel an invite, then confirm it's gone and the link shows not found
- Maestro: a signed-in client who is removed sees "You're no longer connected…" after leaving and reopening the app (`removed-client.yaml`).

## Out of scope
- Bulk remove.
- Removal reasons.
- Notifying the client by email.
- Read-only "Past training" for removed clients.
