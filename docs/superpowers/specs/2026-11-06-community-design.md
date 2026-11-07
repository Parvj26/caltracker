# Community (spec §7 "Community")

One private community per coach workspace: the coach and all their clients post text, up to 4 photos, links, and
sticker / workout / PR cards; react and comment; the coach pins, deletes and removes members; anyone can report or block.
Website: "Community" in the coach sidebar (feed, composer, members, Reports queue). Phone: a Community tab (feed,
composer with photos, reactions, comments, report/block, notifications) and "Share to community" from the zoo book sticker
sheet and the workout summary.

## Data (migration `20261106013000_community.sql`)

Every table has `workspace_id`, RLS on, nothing for `anon`.

| Table | What | Who writes |
|---|---|---|
| `communities` | One per workspace (`is_default`), created by a trigger on new workspaces and back-filled. More groups later need only more rows. | trigger |
| `community_members` | (community, user, role coach/client, `removed_at`). Added by a trigger whenever someone joins the workspace; deleted with the workspace membership (FK cascade), so removing a client from the business ends access at once. | trigger; coach via `remove_community_member` / `restore_community_member` |
| `community_posts` | body ≤ 2,000, optional `card` (jsonb), `pinned_at`. | `create_community_post` RPC (author = caller); coach pins via `set_community_post_pinned` |
| `community_post_images` | ≤ 4 per post: full path + thumbnail path, width, height. | the same RPC |
| `community_comments` | body ≤ 1,000. | insert (post_id, body); trigger fills author/community/workspace |
| `community_reactions` | ❤️ 💪 🔥 👏 😂 🎉 on a post or a comment, stored as keys (`heart`, `muscle`, `fire`, `clap`, `laugh`, `party`); one of each per (target, user), any number of the six; `post_id` is set for comment reactions too; uuid primary key (a Realtime DELETE only carries the key). Replaced `community_likes` in `20261107003000_community_reactions.sql` (every like became a heart). | insert (post_id or comment_id, reaction); trigger fills user/post/community/workspace; delete own |
| `community_reports` | reason (spam / harassment / inappropriate / other), note, a snapshot of the reported text and its author, open → resolved (`removed` / `kept`). | `report_community_content` RPC; coach `resolve_community_report` |
| `community_blocks` | (workspace, blocker, blocked). | the blocker (insert/delete own) |
| `community_notifications` | in-app list: `comment`, `reaction`, `coach_post`, `report`; `read_at`. | triggers only; recipient sets `read_at` |

**Access rules (RLS)**
- Read a community and its content: an *active* member (row without `removed_at`, and still in the workspace) or a coach
  of the workspace. Other workspaces see nothing; a removed client (from the community or from the business) sees nothing.
- Blocked content is hidden **in the database** for the blocker: posts, comments, reactions and notifications whose author
  is someone they blocked never come back (and so never arrive over Realtime either).
- Post, comment, react: active members and coaches only; nobody can react to (or comment on) content by someone they
  blocked, and a reaction is visible only while its post or comment is. Delete: your own posts/comments/reactions; the coach deletes any
  post or comment. Pinning, removing members and the Reports queue are coach-only. Nobody can edit (no edit in V1).
- Reports: a member can file one on anything they can see; only the coach can read them.
- Clients can block other clients (not the coach, who is the moderator). Coaches moderate by deleting and removing.
- Privacy: posts show the author's name and photo only (from `profiles`, which already limits reads to people in the
  same workspace; a removed member's name stops resolving and shows as "Former member"). Workout numbers appear only
  inside a card the client chose to share. Card checks: a sticker card needs the sticker in the author's zoo; workout
  and PR cards need a completed workout of the author's own.

**Photos.** Private bucket `community-images`, WebP/JPEG ≤ 3 MB, path `{workspace}/{author}/{post}/{photo}.webp` plus
`-thumb`. Upload: only into your own folder of a community you are active in. Read: your own uploads, or a photo of a
post you can see (the storage policy looks the photo up in `community_post_images` under your own RLS, so blocks and
removals apply to photos too). Delete: your own, or the coach for their workspace. Phones and the website shrink photos
before upload (max 1600 px long edge + 320 px thumbnail); feeds load thumbnails through short-lived signed links, the
full photo on tap.

**Realtime.** `community_posts`, `community_comments`, `community_reactions`, `community_notifications` and
`community_reports` are added to `supabase_realtime` (idempotent; a no-op without the publication). INSERT/UPDATE events
are filtered by RLS; the apps never listen to DELETE events: a removed reaction, comment or post bumps `communities.activity_at`, which arrives
as a filtered UPDATE, and the apps reload.

## Notifications (in-app now, push later)

Triggers write `community_notifications` rows: a comment on my post, a reaction to my post or my comment (one row per person per post or comment, however many of the six
they add; removed again when they take the last one back), a new
post by the coach (to every active member), a new report (to the coaches). The phone shows a bell with an unread badge
on the Community tab and a list; the website shows the open-report count in the sidebar. Grouping and wording are pure
functions in `packages/shared/src/community` ("Sam and 4 others reacted to your post"), so a push sender can reuse them.
**Push hook:** a later Edge Function subscribed to inserts on `community_notifications` (Database Webhook) sends Expo
pushes with the same text, honouring per-type toggles — no schema change needed.

## Shared logic (`packages/shared/src/community`, unit tested)

Zod input schemas and limits, card schema and card text, reaction counting and grouping ("you reacted", who reacted, screen-reader labels),
notification grouping and wording, feed ordering (pinned
first), client-side visibility (drops blocked authors at once, before the reload), permission helpers for the UI
(the database still decides), link finding for post text, photo paths and sizes, relative times.

## Not in this change

Push delivery, editing posts, multiple groups (schema ready), @mentions, polls, video (never), the phone's offline
queue for posts (a failed post shows an error with Retry, per spec §12).

## Tests

pgTAP `community.test.sql`: isolation between workspaces, removed client (community and business), client can't
delete others' content or pin, blocked content hidden, reports coach-only, notifications, card ownership, photo storage
policies, Realtime publication. Vitest for the shared logic; Playwright `community.spec.ts` for the website; Maestro
`community.yaml` for the phone (run later on the simulator).
