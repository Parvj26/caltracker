-- The true number of finished workouts awaiting the coach's review, for the Activity heading ("N to review").
-- The page only loads one page of 25 logs, so counting there under-reported anything older.
--
-- Same rule as logReviewByLog in packages/shared/src/logs/review.ts: a completed log is reviewed once someone other
-- than the client has commented on it (a comment whose author's account is gone does not count), or when someone
-- other than the client logged it (the coach, in person). Everything else is waiting.
--
-- Security invoker, so RLS applies; it also returns 0 unless the caller coaches p_workspace (a client calling it for
-- their own workspace would otherwise count their own logs).
create function public.activity_to_review_count(p_workspace uuid, p_client uuid default null) returns integer
language sql stable security invoker set search_path = '' as $$
  select case when not public.is_coach_of(p_workspace) then 0 else (
    select count(*)::int
    from public.workout_logs l
    where l.workspace_id = p_workspace
      and l.status = 'completed'
      and (p_client is null or l.client_id = p_client)
      and (l.logged_by is null or l.logged_by = l.client_id)
      and not exists (
        select 1 from public.workout_log_comments c
        where c.log_id = l.id and c.author_id is not null and c.author_id <> l.client_id
      )
  ) end;
$$;
revoke execute on function public.activity_to_review_count(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activity_to_review_count(uuid, uuid) to authenticated;
