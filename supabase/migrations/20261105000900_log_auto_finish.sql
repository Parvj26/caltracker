-- Hourly job: finish workouts a client forgot to close.
-- A log with no activity for 3 hours is completed (if at least one set was done) or discarded.
-- Both are marked auto_finished, so the phone may still upload its data for 24 h (see save_workout_log).
-- `revision` is the phone's counter only, so this job never changes it, and last_activity_at stays as it was.

create function public.auto_finish_stale_logs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  with stale as (
    select l.id,
      (select max(s.completed_at) from public.log_sets s where s.log_id = l.id and s.completed_at is not null) as last_set_at
    from public.workout_logs l
    where l.status = 'in_progress' and l.last_activity_at < now() - interval '3 hours'
  ), changed as (
    update public.workout_logs l
    set status = case when stale.last_set_at is not null
          then 'completed'::public.log_status else 'discarded'::public.log_status end,
        auto_finished = true,
        finished_at = stale.last_set_at
    from stale
    where l.id = stale.id
    returning 1
  )
  select count(*) into v_count from changed;
  return v_count;
end;
$$;

revoke execute on function public.auto_finish_stale_logs() from public, anon, authenticated;
grant execute on function public.auto_finish_stale_logs() to service_role;

create extension if not exists pg_cron with schema pg_catalog;

-- Re-running this migration must not duplicate the job.
select cron.unschedule(jobid) from cron.job where jobname = 'auto-finish-stale-logs';
select cron.schedule('auto-finish-stale-logs', '7 * * * *', 'select public.auto_finish_stale_logs()');
