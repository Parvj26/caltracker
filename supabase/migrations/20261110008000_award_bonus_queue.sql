-- At most one bonus sticker per finished workout (product owner, 2026-11-10). Every workout still gets its ladder
-- animal; of the bonuses (milestone, streak landmark, rare find, random drop) only one is given, by that priority.
-- The rest wait here, per client and workspace, and award-workout hands out one per later finished workout (the
-- rule is the shared pickBonus). A random drop is only rolled when there is nothing else to give, so drops never
-- wait here. Awards stored before this change and the stickers already owned are untouched.
--
-- 1. award_bonus_queue (new): the waiting bonuses. Clients and coaches only read it (same rule as awards); only
--    apply_award writes it, under the client lock. A row goes with its client, its workspace, or the workout that
--    earned it.
-- 2. award_bonus_queue_version (new): a fingerprint of a client's queue, so apply_award can refuse a write worked
--    out from a queue that changed meanwhile (the same retry as for a changed history or sticker count).
-- 3. award_inputs (from 20261110007200) also sends the queue and its fingerprint. Otherwise unchanged.
-- 4. apply_award (from 20261107006000): a first award also applies the queue changes award-workout sends in
--    p_result.bonus ({ queue_version, from_queue, discard, enqueue }): remove the row it handed out and rows no
--    longer due, add what this workout earned but does not give. A retry, a recompute or a re-finish never touches
--    the queue, so the same workout can't hand out or queue anything twice. A call without p_result.bonus (an
--    award-workout deployed before this change) works as before. Everything else is unchanged.

create table public.award_bonus_queue (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  earned_log_id uuid not null references public.workout_logs on delete cascade,
  kind text not null check (kind in ('milestone', 'landmark', 'rare', 'drop')),
  sticker_key text check (char_length(sticker_key) between 1 and 100),
  value integer check (value > 0),
  -- When the workout that earned it finished: the queue hands out the oldest first (after priority).
  earned_at timestamptz not null,
  seq bigint generated always as identity,
  created_at timestamptz not null default now(),
  check ((kind = 'milestone') = (value is not null and sticker_key is null)),
  check (kind = 'milestone' or sticker_key is not null)
);
create index award_bonus_queue_client_idx on public.award_bonus_queue (client_id, workspace_id);
create index award_bonus_queue_workspace_idx on public.award_bonus_queue (workspace_id);
create index award_bonus_queue_log_idx on public.award_bonus_queue (earned_log_id);

revoke all on table public.award_bonus_queue from anon, authenticated, service_role;
grant select on public.award_bonus_queue to authenticated;
grant select, insert, update, delete on public.award_bonus_queue to service_role;

alter table public.award_bonus_queue enable row level security;
create policy award_bonus_queue_select on public.award_bonus_queue for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));

create function public.award_bonus_queue_version(p_client_id uuid, p_workspace_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(coalesce(string_agg(q.id::text, ',' order by q.id), ''))
  from public.award_bonus_queue q
  where q.client_id = p_client_id and q.workspace_id = p_workspace_id;
$$;

revoke execute on function public.award_bonus_queue_version(uuid, uuid) from public, anon, authenticated, service_role;

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
    -- The bonuses waiting to be given, and their fingerprint (apply_award checks it before changing the queue).
    'bonus_queue', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'earned_log_id', q.earned_log_id,
        'kind', q.kind, 'key', q.sticker_key, 'value', q.value, 'earned_at', q.earned_at, 'seq', q.seq)
        order by q.seq)
      from public.award_bonus_queue q where q.client_id = t.client_id and q.workspace_id = t.workspace_id), '[]'::jsonb),
    'bonus_queue_version', public.award_bonus_queue_version(t.client_id, t.workspace_id),
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
                -- What this log measured when it differs from the library kind (null: the library kind).
                'tracking_type', e.tracking_type, 'each_side', e.each_side, 'tempo', e.tempo,
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
  v_bonus jsonb := p_result -> 'bonus';
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
  if v_bonus is not null and (jsonb_typeof(v_bonus) is distinct from 'object'
    or v_bonus ->> 'queue_version' is null
    or jsonb_typeof(coalesce(v_bonus -> 'discard', '[]')) is distinct from 'array'
    or jsonb_typeof(coalesce(v_bonus -> 'enqueue', '[]')) is distinct from 'array'
    or (v_bonus -> 'from_queue' is not null and jsonb_typeof(v_bonus -> 'from_queue') not in ('string', 'null'))) then
    raise exception 'apply_award''s bonus needs a queue version, and lists of rows to discard and bonuses to queue.'
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

    if v_bonus is not null then
      -- The queue changes were worked out from the queue as read: refuse if it changed since.
      if public.award_bonus_queue_version(v_log.client_id, v_log.workspace_id)
          is distinct from v_bonus ->> 'queue_version' then
        return jsonb_build_object('status', 'conflict');
      end if;
      -- The bonus this workout hands out from the queue, and rows no longer due.
      delete from public.award_bonus_queue q
      where q.client_id = v_log.client_id and q.workspace_id = v_log.workspace_id
        and (q.id::text = v_bonus ->> 'from_queue'
          or q.id::text in (select jsonb_array_elements_text(coalesce(v_bonus -> 'discard', '[]'))));
      -- What this workout earned but does not give waits, in the order sent (highest priority first).
      insert into public.award_bonus_queue (client_id, workspace_id, earned_log_id, kind, sticker_key, value, earned_at)
      select v_log.client_id, v_log.workspace_id, v_log.id, e.kind, e.key, e.value, v_log.finished_at
      from rows from (jsonb_to_recordset(coalesce(v_bonus -> 'enqueue', '[]'))
        as (kind text, key text, value integer)) with ordinality as e(kind, key, value, ord)
      order by e.ord;
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

    -- The stored volume follows the correction too (award-workout works it out with the shared logVolumeKg).
    if jsonb_typeof(p_result #> '{award,volumeKg}') = 'number' then
      v_result := jsonb_set(v_result, '{volumeKg}', p_result #> '{award,volumeKg}');
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
