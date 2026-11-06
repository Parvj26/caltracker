-- Live updates for the coach (batch 4): the coach's website listens for changes to workout_logs and awards through
-- Supabase Realtime and re-renders the page when one changes.
--
-- workout_logs: the sets themselves live in log_sets, which is not published. The log row is enough to know that
-- something changed, because every applied save_workout_log updates it (revision, status, and the phone's
-- last_activity_at), and so do the auto-finish job (status, finished_at, auto_finished) and a coach correction
-- (corrected_at). The page then reloads its own data.
-- awards: stickers and PRs are worked out after the log is finished (apply_award, run with the service role), so
-- they arrive a moment after the log's last change; publishing awards lets them appear without a refresh.
--
-- Realtime checks each change against the subscriber's SELECT policies (workout_logs_select, awards_select), so a
-- coach only hears about their own workspace and a client only about their own rows.
--
-- Replica identity stays the default (primary key). The web filters (workspace_id, client_id, id, log_id) are
-- matched against the new row of an INSERT or UPDATE, which is always sent in full; only old values and DELETE
-- filters would need `replica identity full`, and the web does not listen for deletes.
--
-- Idempotent, and a no-op where the publication does not exist (a plain Postgres without Realtime).
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['workout_logs', 'awards'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
