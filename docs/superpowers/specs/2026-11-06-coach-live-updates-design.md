# Live updates for the coach (batch 4)

While a client logs a workout on the phone, the coach's open page updates by itself: Home (Today's clients, the
weekly tiles, Needs attention), a client's log page, the client calendar and Activity.

## Approach chosen

- **Listen to one table, re-render the page.** The page subscribes with Supabase Realtime (`postgres_changes`) to
  `workout_logs`, filtered to what the page shows (`workspace_id` on Home and Activity, `client_id` on the client page,
  `id` on the log page). On a change it calls `router.refresh()`, so the server components load fresh data with the
  same queries as a normal visit. No page needs its own live data code, and nothing can drift from what a reload shows.
- **Why only `workout_logs`.** Sets live in `log_sets` (the tree `workout_logs -> log_blocks -> log_exercises ->
  log_sets`), but every applied `save_workout_log` from the phone also updates the `workout_logs` row (revision,
  last activity, status), as do auto-finish and coach corrections. One table is enough to know "something changed".
- **Awards too.** Stickers and PRs are worked out a moment after the finish (apply_award), so `awards` is published as
  well and Home, Activity and the log page listen to it with the same filters.
- **Debounce and visibility.** Refreshes are debounced (500 ms; under a steady stream at most every 2 s on the log and
  client pages, 8 s on Home and Activity, which see the whole workspace), skipped while the tab is hidden and done
  once when it becomes visible. After the channel drops and joins again the page refreshes once, since changes made
  while disconnected were never sent; a channel that closes for good is rebuilt with backoff (1 s doubling to 30 s).
  The first join refreshes only when the server render is more than 1 s old. The token is loaded into Realtime before
  joining (otherwise the join can go out as anon and RLS hides everything); without a session the page shows offline.
- **Corrections.** A coach correcting a log compares against the numbers shown when Correct was clicked, and if the
  phone syncs meanwhile (revision or last activity changes) saving waits until the coach takes the latest numbers.
- **Avatar.** The sidebar photo keeps its first signed link while only the token changes, so refreshes don't download
  it again. Logic: `apps/web/src/lib/live-refresh.ts` (unit tested);
  component: `apps/web/src/components/live-refresh.tsx`, one line per page.
- **Security.** Realtime checks each change against the subscriber's SELECT policies (RLS), so a coach only hears about
  their workspace and a client only about their own logs; the filter only narrows that. pgTAP:
  `supabase/tests/workout_logs_realtime.test.sql`.
- **Replica identity stays default.** Filters are matched on the new row of INSERT/UPDATE, which is always complete.
  `replica identity full` would only matter for old values or DELETE filters, and the web does not listen for deletes.
- **Portable.** Supabase Realtime over a browser WebSocket; nothing host-specific, nothing on the server.

## Not chosen

- Polling every few seconds: simpler, but loads the whole page constantly for every open tab, mostly for nothing.
- Patching client state from the Realtime payload: faster, but each page would need its own merge code for the log
  tree, and the payload only has the `workout_logs` row, not the sets.
