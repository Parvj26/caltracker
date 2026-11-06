-- Hourly job: finish workouts a client forgot to close.
-- A log with no activity for 3 hours is completed (if at least one set was done) or discarded.
-- Both are marked auto_finished, so the phone's own copy, whenever it arrives, still wins (see save_workout_log).
-- `revision` is the phone's counter only, so this job never changes it, and last_activity_at stays as it was.

create function public.auto_finish_stale_logs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_log public.workout_logs%rowtype;
  v_last_set_at timestamptz;
  v_count integer := 0;
begin
  for v_id in
    select l.id from public.workout_logs l
    where l.status = 'in_progress' and l.last_activity_at < now() - interval '3 hours'
    order by l.last_activity_at
  loop
    -- Same lock as save_workout_log, so a phone save and this job never touch one log at once.
    perform pg_advisory_xact_lock(hashtextextended('save_workout_log:' || v_id::text, 0));

    -- Look again under the lock: a save may have landed since the list was read.
    select * into v_log from public.workout_logs l
    where l.id = v_id and l.status = 'in_progress' and l.last_activity_at < now() - interval '3 hours'
    for update;
    if not found then
      continue;
    end if;

    select max(s.completed_at) into v_last_set_at from public.log_sets s where s.log_id = v_id;

    update public.workout_logs
    set status = case when v_last_set_at is not null
          then 'completed'::public.log_status else 'discarded'::public.log_status end,
        auto_finished = true,
        finished_at = v_last_set_at
    where id = v_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.auto_finish_stale_logs() from public, anon, authenticated;
grant execute on function public.auto_finish_stale_logs() to service_role;

create extension if not exists pg_cron with schema pg_catalog;

-- Re-running this migration must not duplicate the job.
select cron.unschedule(jobid) from cron.job where jobname = 'auto-finish-stale-logs';
select cron.schedule('auto-finish-stale-logs', '7 * * * *', 'select public.auto_finish_stale_logs()');
