-- How a workout's ladder animal is chosen (docs/design/collection.md §1): new animals first, at random seeded by the
-- log id, then the one awarded longest ago. The rule lives in @caltracker/shared (pickLadderAnimal); award-workout
-- runs it. Two functions and the awards table change for it:
--
-- award_inputs (from 20261106001100) also hands over 'ladder_awards': the ladder animal of every award of the
-- client in that workspace, with its log's finish time, so the pick knows which animals came before this log.
-- Everything else is unchanged.
--
-- apply_award (from 20261106000300): a recompute (a coach correction, or a re-finished log) keeps the stored animal
-- forever (product owner, 2026-11-07) and only refreshes its multiple, which may fall under 1. A workout that had
-- no animal and now reaches one gets the one award-workout picked, added once, never shiny (a correction never
-- rolls). Everything else is unchanged.
--
-- One animal per workout, enforced: awards.ladder_sticker_key is the ladder animal granted for that log (one row per
-- log). A trigger fills it from result.ladder.key and refuses to change or clear it once set, so no path (a retry,
-- a re-finish, a correction) can grant a second ladder sticker for the same log.

create or replace function public.award_inputs(p_log_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'log', jsonb_build_object('id', t.id, 'client_id', t.client_id, 'workspace_id', t.workspace_id,
      'status', t.status, 'revision', t.revision,
      'is_client', exists (select 1 from public.workspace_members m
        where m.workspace_id = t.workspace_id and m.user_id = t.client_id and m.role = 'client')),
    'time_zone', (select p.time_zone from public.profiles p where p.id = t.client_id),
    'award', (select a.result from public.awards a where a.log_id = t.id),
    'award_revision', (select a.log_revision from public.awards a where a.log_id = t.id),
    'history_version', public.award_history_version(t.client_id, t.workspace_id),
    'owned', coalesce((select jsonb_agg(jsonb_build_object('key', s.sticker_key, 'count', s.count, 'shiny', s.shiny))
      from public.sticker_awards s where s.client_id = t.client_id and s.workspace_id = t.workspace_id), '[]'::jsonb),
    'owned_total', (select coalesce(sum(s.count), 0) from public.sticker_awards s
      where s.client_id = t.client_id and s.workspace_id = t.workspace_id),
    'ladder_awards', coalesce((select jsonb_agg(jsonb_build_object('log_id', l.id, 'finished_at', l.finished_at,
        'key', a.result #>> '{ladder,key}') order by l.finished_at, l.id)
      from public.awards a join public.workout_logs l on l.id = a.log_id
      where a.client_id = t.client_id and a.workspace_id = t.workspace_id
        and l.finished_at is not null and a.result #>> '{ladder,key}' is not null), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'workout_id', l.workout_id, 'name', l.name, 'status', l.status, 'started_at', l.started_at,
        'finished_at', l.finished_at, 'last_activity_at', l.last_activity_at, 'auto_finished', l.auto_finished,
        'revision', l.revision, 'notes', l.notes,
        'log_blocks', coalesce((
          select jsonb_agg(jsonb_build_object('id', b.id, 'position', b.position, 'kind', b.kind,
            'section_id', b.section_id, 'section_name', b.section_name, 'picked_exercise_id', b.picked_exercise_id,
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
      from public.workout_logs l
      where l.client_id = t.client_id and l.workspace_id = t.workspace_id and l.status = 'completed'
    ), '[]'::jsonb))
  from public.workout_logs t where t.id = p_log_id;
$$;

revoke execute on function public.award_inputs(uuid) from public, anon, authenticated;
grant execute on function public.award_inputs(uuid) to service_role;

create or replace function public.apply_award(p_log_id uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_log public.workout_logs%rowtype;
  v_mode text := p_result ->> 'mode';
  v_existing jsonb;
  v_existing_revision integer;
  v_result jsonb;
  v_status text;
  v_stats jsonb := p_result -> 'stats';
  v_old_key text;
  v_new_key text;
  v_multiple jsonb;
  v_row public.sticker_awards%rowtype;
  v_is_new boolean;
begin
  if v_mode is null or v_mode not in ('award', 'recompute')
    or p_result ->> 'history_version' is null
    or jsonb_typeof(p_result -> 'award') is distinct from 'object'
    or jsonb_typeof(p_result -> 'stickers') is distinct from 'array'
    or jsonb_typeof(p_result -> 'records') is distinct from 'array'
    or jsonb_typeof(v_stats) is distinct from 'object' then
    raise exception 'apply_award needs a mode, a history version, an award, stickers, records and stats.'
      using errcode = '22023';
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
  if not exists (select 1 from public.workspace_members m
      where m.workspace_id = v_log.workspace_id and m.user_id = v_log.client_id and m.role = 'client') then
    raise exception 'You are no longer a client of this coach.' using errcode = '42501', hint = 'not_a_client';
  end if;

  -- Awards for different logs of one client write the same sticker, best and stats rows: one at a time.
  perform pg_advisory_xact_lock(hashtextextended('award-client:' || v_log.client_id::text, 0));

  select a.result, a.log_revision into v_existing, v_existing_revision
  from public.awards a where a.log_id = p_log_id;

  if v_existing is not null and v_mode = 'award' and v_existing_revision = v_log.revision then
    return jsonb_build_object('status', 'existing', 'result', v_existing);
  end if;

  -- The bests and stats below are rebuilt from the logs: refuse if they changed since they were read.
  if public.award_history_version(v_log.client_id, v_log.workspace_id) is distinct from p_result ->> 'history_version' then
    return jsonb_build_object('status', 'conflict');
  end if;

  if v_existing is null then
    if (select coalesce(sum(s.count), 0) from public.sticker_awards s
        where s.client_id = v_log.client_id and s.workspace_id = v_log.workspace_id)
        is distinct from (p_result ->> 'owned_total')::bigint then
      return jsonb_build_object('status', 'conflict');
    end if;

    insert into public.sticker_awards as cur (client_id, workspace_id, sticker_key, shiny, first_log_id)
    select v_log.client_id, v_log.workspace_id, s.key, coalesce(s.shiny, false), v_log.id
    from jsonb_to_recordset(p_result -> 'stickers') as s(key text, shiny boolean)
    on conflict (client_id, workspace_id, sticker_key) do update
      set count = cur.count + 1,
          shiny = cur.shiny or excluded.shiny,
          last_earned_at = now();

    v_result := p_result -> 'award';
    insert into public.awards (log_id, client_id, workspace_id, result, log_revision)
    values (v_log.id, v_log.client_id, v_log.workspace_id, v_result, v_log.revision);
    v_status := 'awarded';
  else
    -- A correction or a re-finish never rolls again and never adds a second animal: a workout keeps its animal
    -- forever (only its multiple follows the corrected volume, and may fall under 1). The PRs this log set are
    -- replaced. Only a workout that had no animal and now reaches one gets one, once.
    v_result := jsonb_set(v_existing, '{prs}', coalesce(p_result -> 'award' -> 'prs', '[]'::jsonb));
    v_old_key := v_existing #>> '{ladder,key}';
    v_new_key := p_result #>> '{award,ladder,key}';
    v_multiple := p_result #> '{award,ladder,multiple}';

    if v_old_key is not null then
      -- award-workout always sends the stored animal back; anything else is ignored.
      if v_new_key = v_old_key and jsonb_typeof(v_multiple) = 'number' then
        v_result := jsonb_set(v_result, '{ladder,multiple}', v_multiple);
      end if;
    elsif v_new_key is not null then
      -- Counts and shiny come from the rows, read under the client lock above, so no stale count can be written.
      select * into v_row from public.sticker_awards s
      where s.client_id = v_log.client_id and s.workspace_id = v_log.workspace_id and s.sticker_key = v_new_key
      for update;
      v_is_new := not found;
      if v_is_new then
        -- No roll on a correction, so a new animal is never shiny.
        insert into public.sticker_awards (client_id, workspace_id, sticker_key, shiny, first_log_id)
        values (v_log.client_id, v_log.workspace_id, v_new_key, false, v_log.id)
        returning * into v_row;
      else
        update public.sticker_awards s set count = s.count + 1, last_earned_at = now()
        where s.client_id = v_log.client_id and s.workspace_id = v_log.workspace_id and s.sticker_key = v_new_key
        returning * into v_row;
      end if;
      v_result := jsonb_set(v_result, '{ladder}', jsonb_build_object('key', v_new_key,
        'multiple', coalesce(v_multiple, 'null'::jsonb), 'isNew', v_is_new, 'count', v_row.count,
        'shiny', v_row.shiny));
    end if;

    update public.awards a set result = v_result, log_revision = v_log.revision where a.log_id = p_log_id;
    v_status := 'recomputed';
  end if;

  -- The bests: drop the ones no longer held, then upsert the rest through the two partial unique indexes.
  delete from public.personal_records p
  where p.client_id = v_log.client_id and p.workspace_id = v_log.workspace_id
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
  on conflict (client_id, workspace_id, exercise_id, kind) where kind <> 'reps_at_weight' do update
    set value_kg = excluded.value_kg, reps = excluded.reps, log_id = excluded.log_id,
        achieved_at = excluded.achieved_at
    where (cur.value_kg, cur.reps, cur.log_id, cur.achieved_at)
      is distinct from (excluded.value_kg, excluded.reps, excluded.log_id, excluded.achieved_at);

  insert into public.personal_records as cur
    (client_id, workspace_id, exercise_id, kind, value_kg, reps, log_id, achieved_at)
  select v_log.client_id, v_log.workspace_id, r.exercise_id, r.kind, r.value_kg, r.reps, r.log_id, r.achieved_at
  from jsonb_to_recordset(p_result -> 'records')
    as r(exercise_id uuid, kind text, value_kg numeric, reps integer, log_id uuid, achieved_at timestamptz)
  where r.kind = 'reps_at_weight'
  on conflict (client_id, workspace_id, exercise_id, value_kg) where kind = 'reps_at_weight' do update
    set reps = excluded.reps, log_id = excluded.log_id, achieved_at = excluded.achieved_at
    where (cur.reps, cur.log_id, cur.achieved_at)
      is distinct from (excluded.reps, excluded.log_id, excluded.achieved_at);

  insert into public.client_stats as cur (client_id, workspace_id, workouts, streak, streak_week, best_streak,
    journey_week, pr_count, lifetime_volume_kg, updated_at)
  values (v_log.client_id, v_log.workspace_id, (v_stats ->> 'workouts')::integer, (v_stats ->> 'streak')::integer,
    (v_stats ->> 'streak_week')::date, (v_stats ->> 'best_streak')::integer, (v_stats ->> 'journey_week')::integer,
    (v_stats ->> 'pr_count')::integer, (v_stats ->> 'lifetime_volume_kg')::numeric, now())
  on conflict (client_id, workspace_id) do update
    set workouts = excluded.workouts, streak = excluded.streak, streak_week = excluded.streak_week,
        best_streak = excluded.best_streak, journey_week = excluded.journey_week, pr_count = excluded.pr_count,
        lifetime_volume_kg = excluded.lifetime_volume_kg, updated_at = now();

  return jsonb_build_object('status', v_status, 'result', v_result);
end;
$$;

revoke execute on function public.apply_award(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_award(uuid, jsonb) to service_role;

-- One ladder animal per workout.
alter table public.awards add column ladder_sticker_key text;
update public.awards set ladder_sticker_key = result #>> '{ladder,key}';

create function public.awards_one_animal() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.ladder_sticker_key := new.result #>> '{ladder,key}';
  if tg_op = 'UPDATE' and old.ladder_sticker_key is not null
    and new.ladder_sticker_key is distinct from old.ladder_sticker_key then
    raise exception 'A workout keeps its animal: % stays on log %.', old.ladder_sticker_key, old.log_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.awards_one_animal() from public, anon, authenticated;

create trigger awards_one_animal before insert or update on public.awards
  for each row execute function public.awards_one_animal();
