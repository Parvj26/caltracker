# Messages: design

**Status:** approved in conversation on 2026-11-05.
**Main spec:** `docs/superpowers/specs/2026-11-03-coaching-app-design.md` §7 "Messaging". This document is the build-level
version of that section.

## Purpose

Clients moving over from Everfit chat with their coach. CalTracker has to do the same, or the coach ends up
juggling two apps. Success means:
- the coach and a client can send each other text and photos;
- each side sees the other's messages straight away while the app is open;
- each side can tell what is unread and what has been seen.

## Decisions (product owner)

- One private conversation per coach–client pair. There are no group chats, broadcasts or voice notes; those are
  not in Version 1.
- Messages can carry text and **up to 4 photos**. A YouTube link shows a preview card and opens on YouTube.
- Unread counts and a "Seen" marker on the sender's latest message.
- **Lock-screen push notifications come later.** They need the paid Apple Developer account. Push is added as a
  separate small change once that account exists, and nothing here may block it.
- Workout comments stay on the workout, not in the chat.

## Coach dashboard: `/messages`

- A **Messages** sidebar item, with an unread total badge.
- **Two panes:**
  - **Inbox (left):** every current client, most recent message first. Clients with no messages are listed after
    them, sorted by name. Each row shows the avatar, the name, a one-line preview ("📷 Photo" for an image-only
    message), the time, and an unread count.
  - An "Unread" filter and a name search sit above the inbox.
  - **Conversation (right):** bubbles grouped by day ("Today", "Yesterday", "Mon 2 Nov"), each with a time.
  - "Seen" appears under the coach's latest message once the client has read it.
  - The **reply box** grows to 6 lines. Enter sends and Shift+Enter starts a new line. A 📎 button adds up to 4
    photos, shown as removable thumbnails before sending.
- Deep link: `/messages/[clientId]`. The coach home's "Message" buttons and a "Message" button on each client's page
  go live and open it.
- Past (removed) clients don't appear in the inbox. Their history stays readable from the past client's page as a
  read-only conversation.
- At widths under about 900 px, the inbox and the conversation become two screens with a Back button.

## Client app: "Coach" tab

- A new tab with the unread count on its icon.
- The header shows the coach's photo, name and business name, taken from the coach profile.
- Bubbles, day groups, "Seen", and the reply box with 📷, matching the web.
- Photos are compressed on the device (at most 1600 px on the long edge, plus a thumbnail) before upload.
- **Bad signal:**
  - A message written offline goes into an on-device outbox and shows "Sending…".
  - It sends automatically when the phone reconnects.
  - A failed photo upload shows "Didn't send · Retry".
  - Message order is the server time of each message's arrival.

## Data

- **`conversations`:** `id`, `workspace_id`, `client_id`, `created_at`, plus `last_message_at` for sorting.
  - There is one conversation per client: `unique (workspace_id, client_id)`.
  - It is created on first use through a definer function `get_or_create_conversation(p_client_id)`.
- **`messages`:**
  - Columns: `id`, `conversation_id`, `workspace_id`, `sender_id` (always `auth.uid()`), `body` (0–4000 characters),
    `image_paths text[]` (at most 4), `client_msg_id uuid`, `created_at`.
  - A check requires that `body` is non-empty or there is at least one image.
  - `unique (sender_id, client_msg_id)` makes outbox retries idempotent: a retry with the same `client_msg_id` changes
    nothing.
  - Messages can't be edited or deleted in this version.
- **`conversation_reads`:** `(conversation_id, user_id) → last_read_at`. Unread means messages from the other person
  that are newer than `last_read_at`. "Seen" means the other person's `last_read_at` is at or after the message.
- **RLS:**
  - The coach of the workspace and that conversation's client can read the conversation, its messages and its
    reads.
  - Each of them can insert only as themselves.
  - Other clients, other coaches and anonymous users get nothing.
  - pgTAP proves the cross-client, cross-workspace and anonymous cases fail.
- **Storage:**
  - A private bucket `message-images` with paths `{workspace_id}/{conversation_id}/{uuid}.webp` and
    `…-thumb.webp`.
  - Read and write are allowed to the two participants only, as policies tested the same way.
  - Images are rendered from short-lived signed URLs.
- **Realtime:**
  - Both apps subscribe to Supabase Realtime `postgres_changes` on `messages` and `conversation_reads`, filtered to
    the open conversation, and for the inbox to the workspace. RLS applies.
  - The web inbox also refreshes on focus as a fallback.
- **YouTube links:**
  - Detected in the body with the shared `parseYoutubeUrl`.
  - The card shows the video thumbnail (`img.youtube.com/vi/{id}/hqdefault.jpg`) and "Watch on YouTube".
  - No server-side fetching.
- **Push, later:** a `push_tokens` table and an Edge Function on new messages will be added with the Apple account.
  Nothing in this version depends on them.

## Testing

- **Vitest (shared):** unread count and "Seen" calculation from messages plus reads, day grouping labels, YouTube
  detection in message text, and the outbox merge and order helper.
- **pgTAP:** conversations, messages and reads RLS; the `client_msg_id` idempotency; the body/images check; at most 4
  images; `get_or_create_conversation` returns the same row twice and refuses another coach's client.
- **Storage policy tests:** a participant can read and write, and a non-participant is denied.
- **Playwright:**
  - The coach sends a text and a photo, and they appear.
  - A message inserted as the client through the service role shows up live without a reload, and the unread badge
    increments.
  - Opening the conversation clears the unread count.
  - "Seen" appears after the client's read is recorded.
  - The "Message" button on the coach home opens the right conversation.
- **Maestro:** the client opens the Coach tab, sees the coach's message, replies, and the reply appears. A send in
  airplane mode shows "Sending…" and then goes out after reconnecting, if the simulator allows toggling the network;
  otherwise this is covered by unit tests of the outbox.

## Out of scope

- Push notifications (added later with the Apple account).
- Editing, deleting or reacting to messages.
- Voice notes, files other than photos, group chats and broadcasts.
- Typing indicators.
