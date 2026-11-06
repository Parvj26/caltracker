-- Live updates for the coach (batch 4): the coach's website listens for changes to workout_logs through Supabase
-- Realtime and re-renders the page when a client's log changes.
--
-- Only the log row is published, not log_blocks/log_exercises/log_sets: every applied save_workout_log updates the
-- row (revision, last_activity_at, status), and so do auto-finish and coach corrections, so one table is enough to
-- know "something changed" and the page reloads its own data. Realtime checks each change against the subscriber's
-- SELECT policies, so a coach only hears about their own workspace's logs and a client only about their own.
--
-- Replica identity stays the default (primary key). The web filters (workspace_id, client_id, id) are matched
-- against the new row of an INSERT or UPDATE, which is always sent in full; only old values and DELETE filters
-- would need `replica identity full`, and the web does not listen for deletes.
--
-- Same pattern as the messages migration: idempotent, and a no-op where the publication does not exist.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workout_logs'
     ) then
    alter publication supabase_realtime add table public.workout_logs;
  end if;
end;
$$;
