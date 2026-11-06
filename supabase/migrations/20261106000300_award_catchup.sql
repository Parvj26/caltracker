-- Awarding a finished workout (see docs/superpowers/specs/2026-11-05-stickers-prs-streaks-design.md).
-- The award-workout Edge Function is the only writer of the award tables. It reads a client's history with
-- award_inputs, works the award out with the shared rules (packages/shared), then writes everything in one
-- transaction with apply_award. Both are for the service role only.
-- A pg_cron job every 15 minutes calls the function for completed logs that have no award yet (a phone that never
-- called it, or the hourly auto-finish job), through pg_net, with a secret kept in Vault.

-- Everything the award needs about one log's client, as one JSON document (one round trip, no row limit):
-- the log's owner and status, the client's time zone, the award already granted (if any), the stickers owned,
-- and every completed log of the client in LogTreeRow shape (completed sets only: nothing else counts).
create function public.award_inputs(p_log_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'log', jsonb_build_object('id', t.id, 'client_id', t.client_id, 'workspace_id', t.workspace_id,
      'status', t.status),
    'time_zone', (select p.time_zone from public.profiles p where p.id = t.client_id),
    'award', (select a.result from public.awards a where a.log_id = t.id),
    'owned', coalesce((select jsonb_agg(jsonb_build_object('key', s.sticker_key, 'count', s.count, 'shiny', s.shiny))
      from public.sticker_awards s where s.client_id = t.client_id), '[]'::jsonb),
    'owned_total', (select coalesce(sum(s.count), 0) from public.sticker_awards s where s.client_id = t.client_id),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'workout_id', l.workout_id, 'name', l.name, 'status', l.status, 'started_at', l.started_at,
        'finished_at', l.finished_at, 'last_activity_at', l.last_activity_at, 'auto_finished', l.auto_finished,
        'revision', l.revision, 'notes', l.notes,
        'log_blocks', coalesce((
          select jsonb_agg(jsonb_build_object('id', b.id, 'position', b.position, 'kind', b.kind,
            'log_exercises', coalesce((
              select jsonb_agg(jsonb_build_object('id', e.id, 'position', e.position, 'exercise_id', e.exercise_id,
                'planned_workout_exercise_id', e.planned_workout_exercise_id,
                'swapped_from_exercise_id', e.swapped_from_exercise_id, 'note', e.note,
                'exercises', (select jsonb_build_object('name', x.name, 'tracking_type', x.tracking_type)
                  from public.exercises x where x.id = e.exercise_id),
                'log_sets', coalesce((
                  select jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'set_type', s.set_type,
                    'target_reps_min', s.target_reps_min, 'target_reps_max', s.target_reps_max,
                    'target_weight_kg', s.target_weight_kg, 'target_duration_s', s.target_duration_s,
                    'target_distance_m', s.target_distance_m, 'to_failure', s.to_failure,
                    'rest_seconds', s.rest_seconds, 'actual_reps', s.actual_reps,
                    'actual_weight_kg', s.actual_weight_kg, 'actual_duration_s', s.actual_duration_s,
                    'actual_distance_m', s.actual_distance_m, 'completed_at', s.completed_at) order by s.position)
                  from public.log_sets s where s.log_exercise_id = e.id and s.completed_at is not null
                ), '[]'::jsonb)) order by e.position)
              from public.log_exercises e where e.block_id = b.id
            ), '[]'::jsonb)) order by b.position)
          from public.log_blocks b where b.log_id = l.id
        ), '[]'::jsonb)) order by l.finished_at, l.id)
      from public.workout_logs l where l.client_id = t.client_id and l.status = 'completed'
    ), '[]'::jsonb))
  from public.workout_logs t where t.id = p_log_id;
$$;

revoke execute on function public.award_inputs(uuid) from public, anon, authenticated;
grant execute on function public.award_inputs(uuid) to service_role;

-- apply_award: write one log's award in one transaction. p_result is built by award-workout:
--   mode         'award' (the phone or the catch-up job) or 'recompute' (a coach correction or a re-finish)
--   owned_total  the sum of sticker counts the award was worked out from
--   award        the AwardResult returned to the phone
--   stickers     [{ key, shiny }] to add one of each
--   records      every personal best of the client: [{ exercise_id, kind, value_kg, reps, log_id, achieved_at }]
--   stats        { workouts, streak, best_streak, journey_week, pr_count, lifetime_volume_kg }
-- It returns { status, result }:
--   'existing'   the log already had an award: nothing written, the first result returned (a retry or a race)
--   'awarded'    the award is written
--   'recomputed' an existing award kept its stickers and rolls; its PRs, the bests and the stats were rewritten
--   'conflict'   the client's stickers changed since owned_total was read (another log's award): nothing
--                written; the caller works the award out again
-- The award row, the bests and the stats always take the client and workspace from the log row.
create function public.apply_award(p_log_id uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_log public.workout_logs%rowtype;
  v_mode text := p_result ->> 'mode';
  v_existing jsonb;
  v_result jsonb;
  v_status text;
  v_stats jsonb := p_result -> 'stats';
begin
  if v_mode is null or v_mode not in ('award', 'recompute')
    or jsonb_typeof(p_result -> 'award') is distinct from 'object'
    or jsonb_typeof(p_result -> 'stickers') is distinct from 'array'
    or jsonb_typeof(p_result -> 'records') is distinct from 'array'
    or jsonb_typeof(v_stats) is distinct from 'object' then
    raise exception 'apply_award needs a mode, an award, stickers, records and stats.' using errcode = '22023';
  end if;

  -- One award per log, even when the phone and the catch-up job call at the same moment: the second waits here,
  -- then finds the first one's row.
  perform pg_advisory_xact_lock(hashtextextended('award:' || p_log_id::text, 0));

  select * into v_log from public.workout_logs l where l.id = p_log_id;
  if not found then
    raise exception 'Workout log % not found.', p_log_id using errcode = 'P0002';
  end if;
  if v_log.status <> 'completed' then
    raise exception 'Only finished workouts earn awards.' using errcode = '23514';
  end if;

  -- Awards for different logs of one client write the same sticker, best and stats rows: one at a time.
  perform pg_advisory_xact_lock(hashtextextended('award-client:' || v_log.client_id::text, 0));

  select a.result into v_existing from public.awards a where a.log_id = p_log_id;

  if v_existing is not null and v_mode = 'award' then
    return jsonb_build_object('status', 'existing', 'result', v_existing);
  end if;

  if v_existing is null then
    if (select coalesce(sum(s.count), 0) from public.sticker_awards s where s.client_id = v_log.client_id)
        is distinct from (p_result ->> 'owned_total')::bigint then
      return jsonb_build_object('status', 'conflict');
    end if;

    insert into public.sticker_awards as cur (client_id, workspace_id, sticker_key, shiny, first_log_id)
    select v_log.client_id, v_log.workspace_id, s.key, coalesce(s.shiny, false), v_log.id
    from jsonb_to_recordset(p_result -> 'stickers') as s(key text, shiny boolean)
    on conflict (client_id, sticker_key) do update
      set count = cur.count + 1,
          shiny = cur.shiny or excluded.shiny,
          last_earned_at = now(),
          workspace_id = excluded.workspace_id;

    v_result := p_result -> 'award';
    insert into public.awards (log_id, client_id, workspace_id, result)
    values (v_log.id, v_log.client_id, v_log.workspace_id, v_result);
    v_status := 'awarded';
  else
    -- A correction never takes a sticker away or rolls again: only the PRs this log set can change.
    v_result := jsonb_set(v_existing, '{prs}', coalesce(p_result -> 'award' -> 'prs', '[]'::jsonb));
    update public.awards a set result = v_result where a.log_id = p_log_id;
    v_status := 'recomputed';
  end if;

  -- The bests: drop the ones no longer held, then upsert the rest through the two partial unique indexes.
  delete from public.personal_records p
  where p.client_id = v_log.client_id
    and not exists (
      select 1 from jsonb_to_recordset(p_result -> 'records') as r(exercise_id uuid, kind text, value_kg numeric)
      where r.exercise_id = p.exercise_id and r.kind = p.kind
        and (p.kind <> 'reps_at_weight' or r.value_kg::numeric(8,3) = p.value_kg));

  insert into public.personal_records as cur
    (client_id, workspace_id, exercise_id, kind, value_kg, reps, log_id, achieved_at)
  select v_log.client_id, v_log.workspace_id, r.exercise_id, r.kind, r.value_kg, r.reps, r.log_id, r.achieved_at
  from jsonb_to_recordset(p_result -> 'records')
    as r(exercise_id uuid, kind text, value_kg numeric, reps integer, log_id uuid, achieved_at timestamptz)
  where r.kind <> 'reps_at_weight'
  on conflict (client_id, exercise_id, kind) where kind <> 'reps_at_weight' do update
    set value_kg = excluded.value_kg, reps = excluded.reps, log_id = excluded.log_id,
        achieved_at = excluded.achieved_at, workspace_id = excluded.workspace_id
    where (cur.value_kg, cur.reps, cur.log_id, cur.achieved_at, cur.workspace_id)
      is distinct from (excluded.value_kg, excluded.reps, excluded.log_id, excluded.achieved_at, excluded.workspace_id);

  insert into public.personal_records as cur
    (client_id, workspace_id, exercise_id, kind, value_kg, reps, log_id, achieved_at)
  select v_log.client_id, v_log.workspace_id, r.exercise_id, r.kind, r.value_kg, r.reps, r.log_id, r.achieved_at
  from jsonb_to_recordset(p_result -> 'records')
    as r(exercise_id uuid, kind text, value_kg numeric, reps integer, log_id uuid, achieved_at timestamptz)
  where r.kind = 'reps_at_weight'
  on conflict (client_id, exercise_id, value_kg) where kind = 'reps_at_weight' do update
    set reps = excluded.reps, log_id = excluded.log_id, achieved_at = excluded.achieved_at,
        workspace_id = excluded.workspace_id
    where (cur.reps, cur.log_id, cur.achieved_at, cur.workspace_id)
      is distinct from (excluded.reps, excluded.log_id, excluded.achieved_at, excluded.workspace_id);

  insert into public.client_stats as cur (client_id, workspace_id, workouts, streak, best_streak, journey_week,
    pr_count, lifetime_volume_kg, updated_at)
  values (v_log.client_id, v_log.workspace_id, (v_stats ->> 'workouts')::integer, (v_stats ->> 'streak')::integer,
    (v_stats ->> 'best_streak')::integer, (v_stats ->> 'journey_week')::integer, (v_stats ->> 'pr_count')::integer,
    (v_stats ->> 'lifetime_volume_kg')::numeric, now())
  on conflict (client_id) do update
    set workspace_id = excluded.workspace_id, workouts = excluded.workouts, streak = excluded.streak,
        best_streak = excluded.best_streak, journey_week = excluded.journey_week, pr_count = excluded.pr_count,
        lifetime_volume_kg = excluded.lifetime_volume_kg, updated_at = now();

  return jsonb_build_object('status', v_status, 'result', v_result);
end;
$$;

revoke execute on function public.apply_award(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_award(uuid, jsonb) to service_role;

-- Catch-up: ask award-workout to award completed logs that have none yet, oldest first, 100 per run.
-- It waits 2 minutes after the finish so the phone's own call normally wins; a race is still safe (apply_award).
-- The function URL and its secret live in Vault ('award_workout_url', 'award_workout_secret'): see
-- docs/runbooks/staging.md. Without them the job does nothing and says so in the database log.
create extension if not exists pg_net with schema extensions;

create function public.award_catchup() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_id uuid;
  v_count integer := 0;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'award_workout_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'award_workout_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise warning 'award_catchup: the Vault secrets award_workout_url and award_workout_secret are not set';
    return 0;
  end if;

  for v_id in
    select l.id from public.workout_logs l
    where l.status = 'completed' and l.finished_at < now() - interval '2 minutes'
      and not exists (select 1 from public.awards a where a.log_id = l.id)
    order by l.finished_at, l.id
    limit 100
  loop
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('logId', v_id),
      headers := jsonb_build_object('content-type', 'application/json', 'x-award-secret', v_secret),
      timeout_milliseconds := 30000
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.award_catchup() from public, anon, authenticated, service_role;

-- Re-running this migration must not duplicate the job.
select cron.unschedule(jobid) from cron.job where jobname = 'award-catchup';
select cron.schedule('award-catchup', '*/15 * * * *', 'select public.award_catchup()');
