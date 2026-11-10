-- Fixes to 20261110004100 (per-exercise measurements), from review:
-- 1. award_inputs (from 20261107002000) also sends each log exercise's tracking_type, each_side and tempo, so the
--    award function reads what the log measured (logRowToDoc prefers it over the library kind): a reps-only
--    exercise the coach set to weight and reps counts its volume and PRs, and the reverse counts none.
-- 2. save_workout (from 20261110004100): a doc from before measurements (an old open tab) that swaps the exercise
--    no longer keeps the old exercise's measurements; and a doc with "rememberChoices": false (Duplicate) saves
--    without touching exercise_prefs. Otherwise unchanged.

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

create or replace function public.save_workout(p_workspace_id uuid, p_doc jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_workout_id uuid := (p_doc ->> 'id')::uuid;
  v_blocks jsonb := coalesce(p_doc -> 'blocks', '[]'::jsonb);
  v_sections jsonb := case when jsonb_typeof(p_doc -> 'sections') = 'array' then p_doc -> 'sections' else '[]'::jsonb end;
  v_section_id uuid;
  v_block jsonb;
  v_block_pos bigint;
  v_block_id uuid;
  v_ex jsonb;
  v_ex_pos bigint;
  v_ex_id uuid;
  v_set jsonb;
  v_set_pos bigint;
  v_set_id uuid;
  v_set_type public.set_type;
  v_sub jsonb;
  v_sub_pos bigint;
  v_sub_id uuid;
  v_sub_ids uuid[] := '{}';
  v_dup text;
  v_block_ids uuid[] := '{}';
  v_ex_ids uuid[] := '{}';
  v_set_ids uuid[] := '{}';
  -- A doc from before measurements (an old open tab) has no "eachSide": its exercises keep what they had.
  v_has_opts boolean;
  v_lib public.tracking_type;
  v_override public.tracking_type;
  v_old record;
  -- Duplicate saves a copy with "rememberChoices": false, so copying a workout doesn't overwrite exercise_prefs.
  v_remember boolean := coalesce((p_doc ->> 'rememberChoices')::boolean, true);
begin
  if not public.is_coach_of(p_workspace_id) then
    raise exception 'Only a coach of this workspace can save workouts.' using errcode = '42501';
  end if;

  -- Document guards, before any write.
  if jsonb_typeof(v_blocks) <> 'array' or jsonb_array_length(v_blocks) = 0 then
    raise exception 'Add at least one exercise.' using errcode = '23514';
  end if;
  for v_block in select value from jsonb_array_elements(v_blocks) loop
    if v_block ->> 'kind' = 'straight' and coalesce(jsonb_array_length(v_block -> 'exercises'), 0) <> 1 then
      raise exception 'A straight-sets block has exactly one exercise.' using errcode = '23514';
    end if;
    if v_block ->> 'kind' = 'superset' and coalesce(jsonb_array_length(v_block -> 'exercises'), 0) < 2 then
      raise exception 'A superset needs at least two exercises.' using errcode = '23514';
    end if;
    if v_block ->> 'kind' = 'choice'
       and coalesce(jsonb_array_length(v_block -> 'exercises'), 0) not between 2 and 5 then
      raise exception 'A pick-one group needs 2 to 5 exercises.' using errcode = '23514';
    end if;
    if v_block ->> 'sectionId' is not null and not exists (
      select 1 from jsonb_array_elements(v_sections) s where s.value ->> 'id' = v_block ->> 'sectionId'
    ) then
      raise exception 'Unknown section.' using errcode = '23514';
    end if;
    for v_ex in select value from jsonb_array_elements(v_block -> 'exercises') loop
      if coalesce(jsonb_array_length(v_ex -> 'sets'), 0) = 0 then
        raise exception 'Every exercise needs at least one set.' using errcode = '23514';
      end if;
      if v_ex -> 'sets' -> 0 ->> 'setType' = 'drop' then
        raise exception 'A drop set must follow a normal or warm-up set.' using errcode = '23514';
      end if;
      -- Substitutes (a doc saved before them has no "substitutes" key: none).
      if jsonb_typeof(v_ex -> 'substitutes') = 'array' and jsonb_array_length(v_ex -> 'substitutes') > 0 then
        if v_block ->> 'kind' = 'choice' then
          raise exception 'A pick-one group''s exercises can''t have substitutes.' using errcode = '23514';
        end if;
        if jsonb_array_length(v_ex -> 'substitutes') > 3 then
          raise exception 'Use at most 3 substitutes.' using errcode = '23514';
        end if;
        for v_sub in select value from jsonb_array_elements(v_ex -> 'substitutes') loop
          if jsonb_typeof(v_sub -> 'sets') is distinct from 'array'
             or jsonb_array_length(v_sub -> 'sets') not between 1 and 20 then
            raise exception 'Every substitute needs 1 to 20 sets.' using errcode = '23514';
          end if;
          if v_sub -> 'sets' -> 0 ->> 'setType' = 'drop' then
            raise exception 'A drop set must follow a normal or warm-up set.' using errcode = '23514';
          end if;
          if v_sub ->> 'exerciseId' = v_ex ->> 'exerciseId' or (
            select count(*) from jsonb_array_elements(v_ex -> 'substitutes') o
            where o.value ->> 'exerciseId' = v_sub ->> 'exerciseId') > 1 then
            raise exception 'A substitute must be a different exercise.' using errcode = '23514';
          end if;
        end loop;
      end if;
    end loop;
  end loop;

  select ids.id into v_dup
  from (
    select jsonb_path_query(p_doc, '$.blocks[*].id') #>> '{}' as id
    union all select jsonb_path_query(p_doc, '$.blocks[*].exercises[*].id') #>> '{}'
    union all select jsonb_path_query(p_doc, '$.blocks[*].exercises[*].sets[*].id') #>> '{}'
    union all select jsonb_path_query(p_doc, '$.blocks[*].exercises[*].substitutes[*].id') #>> '{}'
    union all select jsonb_path_query(p_doc, '$.blocks[*].exercises[*].substitutes[*].sets[*].id') #>> '{}'
  ) ids
  group by ids.id having count(*) > 1
  limit 1;
  if v_dup is not null then
    raise exception 'Row % appears twice in the workout.', v_dup using errcode = '23514';
  end if;

  -- The workout: a new id becomes a library workout; an existing one keeps its client and date.
  insert into public.workouts (id, workspace_id, name, notes)
  values (v_workout_id, p_workspace_id, btrim(p_doc ->> 'name'), p_doc ->> 'notes')
  on conflict (id) do update set name = excluded.name, notes = excluded.notes
    where public.workouts.workspace_id = excluded.workspace_id;
  if not found then
    raise exception 'Workout % belongs to another workspace.', v_workout_id using errcode = '42501';
  end if;

  for v_block, v_block_pos in select value, ordinality - 1 from jsonb_array_elements(v_blocks) with ordinality loop
    v_block_id := (v_block ->> 'id')::uuid;
    v_block_ids := v_block_ids || v_block_id;
    v_section_id := (v_block ->> 'sectionId')::uuid;

    insert into public.workout_blocks (id, workout_id, position, kind, section_id, section_name)
    values (v_block_id, v_workout_id, v_block_pos, (v_block ->> 'kind')::public.block_kind, v_section_id,
      (select btrim(s.value ->> 'name') from jsonb_array_elements(v_sections) s
        where s.value ->> 'id' = v_block ->> 'sectionId' limit 1))
    on conflict (id) do update set position = excluded.position, kind = excluded.kind,
        section_id = excluded.section_id, section_name = excluded.section_name
      where public.workout_blocks.workout_id = excluded.workout_id
        and (public.workout_blocks.position, public.workout_blocks.kind, public.workout_blocks.section_id,
             public.workout_blocks.section_name)
          is distinct from (excluded.position, excluded.kind, excluded.section_id, excluded.section_name);
    -- Not inserted and not updated: either unchanged here, or the id is another parent's row.
    if not found and not exists (
      select 1 from public.workout_blocks b where b.id = v_block_id and b.workout_id = v_workout_id
    ) then
      raise exception 'Row % belongs to another workout.', v_block_id using errcode = '23514';
    end if;

    for v_ex, v_ex_pos in select value, ordinality - 1 from jsonb_array_elements(v_block -> 'exercises') with ordinality loop
      v_ex_id := (v_ex ->> 'id')::uuid;
      v_ex_ids := v_ex_ids || v_ex_id;
      v_has_opts := v_ex ? 'eachSide';
      -- The doc's trackingType is what this exercise measures here; only a pick that differs from the library
      -- kind is stored (null follows the library). Distance exercises keep their kind, and distance is never a pick.
      select e.tracking_type into v_lib from public.exercises e where e.id = (v_ex ->> 'exerciseId')::uuid;
      v_override := case
        when v_lib is null or v_lib = 'distance' or v_ex ->> 'trackingType' is null
          or v_ex ->> 'trackingType' not in ('weight_reps', 'reps', 'time', 'weight_time', 'weight', 'reps_time',
            'weight_reps_time')
          or v_ex ->> 'trackingType' = v_lib::text then null
        else (v_ex ->> 'trackingType')::public.tracking_type end;
      select we.exercise_id, we.tracking_type, we.each_side into v_old
      from public.workout_exercises we where we.id = v_ex_id and we.block_id = v_block_id;

      insert into public.workout_exercises (id, block_id, position, exercise_id, note, tracking_type, each_side, tempo)
      values (v_ex_id, v_block_id, v_ex_pos, (v_ex ->> 'exerciseId')::uuid, v_ex ->> 'note', v_override,
        coalesce((v_ex ->> 'eachSide')::boolean, false), nullif(btrim(v_ex ->> 'tempo'), ''))
      on conflict (id) do update set position = excluded.position, exercise_id = excluded.exercise_id,
          note = excluded.note,
          -- A doc from before measurements keeps the row's, unless it swapped the exercise: the old one's pick
          -- doesn't apply to the new one.
          tracking_type = case when v_has_opts then excluded.tracking_type
            when excluded.exercise_id <> public.workout_exercises.exercise_id then null
            else public.workout_exercises.tracking_type end,
          each_side = case when v_has_opts then excluded.each_side else public.workout_exercises.each_side end,
          tempo = case when v_has_opts then excluded.tempo else public.workout_exercises.tempo end
        where public.workout_exercises.block_id = excluded.block_id
          and (public.workout_exercises.position, public.workout_exercises.exercise_id, public.workout_exercises.note)
            is distinct from (excluded.position, excluded.exercise_id, excluded.note)
          or public.workout_exercises.block_id = excluded.block_id and v_has_opts
          and (public.workout_exercises.tracking_type, public.workout_exercises.each_side, public.workout_exercises.tempo)
            is distinct from (excluded.tracking_type, excluded.each_side, excluded.tempo);
      if not found and not exists (
        select 1 from public.workout_exercises we where we.id = v_ex_id and we.block_id = v_block_id
      ) then
        raise exception 'Row % belongs to another workout.', v_ex_id using errcode = '23514';
      end if;

      -- Remember the coach's choice for this exercise (measurements and Each side, not tempo) when it is new here
      -- or was just changed, so the next time it is added it starts the same way.
      if v_remember and v_has_opts and (v_old.exercise_id is null or v_old.exercise_id <> (v_ex ->> 'exerciseId')::uuid
          or (v_old.tracking_type, v_old.each_side) is distinct from
             (v_override, coalesce((v_ex ->> 'eachSide')::boolean, false))) then
        insert into public.exercise_prefs (workspace_id, exercise_id, tracking_type, each_side)
        values (p_workspace_id, (v_ex ->> 'exerciseId')::uuid, v_override, coalesce((v_ex ->> 'eachSide')::boolean, false))
        on conflict (workspace_id, exercise_id) do update
          set tracking_type = excluded.tracking_type, each_side = excluded.each_side;
      end if;

      for v_set, v_set_pos in select value, ordinality - 1 from jsonb_array_elements(v_ex -> 'sets') with ordinality loop
        v_set_id := (v_set ->> 'id')::uuid;
        v_set_ids := v_set_ids || v_set_id;
        v_set_type := (v_set ->> 'setType')::public.set_type;

        insert into public.workout_sets (id, workout_exercise_id, position, set_type, target_reps_min, target_reps_max,
          target_weight_kg, target_duration_s, target_distance_m, to_failure, rest_seconds, note)
        values (v_set_id, v_ex_id, v_set_pos, v_set_type,
          (v_set ->> 'targetRepsMin')::smallint, (v_set ->> 'targetRepsMax')::smallint,
          (v_set ->> 'targetWeightKg')::numeric, (v_set ->> 'targetDurationS')::integer,
          (v_set ->> 'targetDistanceM')::numeric, coalesce((v_set ->> 'toFailure')::boolean, false),
          -- Drops have no rest timer (the shared schema applies the same rule).
          case when v_set_type = 'drop' then 0 else coalesce((v_set ->> 'restSeconds')::smallint, 0) end,
          v_set ->> 'note')
        on conflict (id) do update set position = excluded.position, set_type = excluded.set_type,
            target_reps_min = excluded.target_reps_min, target_reps_max = excluded.target_reps_max,
            target_weight_kg = excluded.target_weight_kg, target_duration_s = excluded.target_duration_s,
            target_distance_m = excluded.target_distance_m, to_failure = excluded.to_failure,
            rest_seconds = excluded.rest_seconds, note = excluded.note
          where public.workout_sets.workout_exercise_id = excluded.workout_exercise_id
            and (public.workout_sets.position, public.workout_sets.set_type, public.workout_sets.target_reps_min,
                 public.workout_sets.target_reps_max, public.workout_sets.target_weight_kg,
                 public.workout_sets.target_duration_s, public.workout_sets.target_distance_m,
                 public.workout_sets.to_failure, public.workout_sets.rest_seconds, public.workout_sets.note)
              is distinct from (excluded.position, excluded.set_type, excluded.target_reps_min,
                 excluded.target_reps_max, excluded.target_weight_kg, excluded.target_duration_s,
                 excluded.target_distance_m, excluded.to_failure, excluded.rest_seconds, excluded.note);
        if not found and not exists (
          select 1 from public.workout_sets s where s.id = v_set_id and s.workout_exercise_id = v_ex_id
        ) then
          raise exception 'Row % belongs to another workout.', v_set_id using errcode = '23514';
        end if;
      end loop;

      for v_sub, v_sub_pos in select value, ordinality - 1
          from jsonb_array_elements(coalesce(v_ex -> 'substitutes', '[]'::jsonb)) with ordinality loop
        v_sub_id := (v_sub ->> 'id')::uuid;
        v_sub_ids := v_sub_ids || v_sub_id;

        -- The sets are stored as the doc's WorkoutSetDoc array; a drop never has rest (as for workout_sets).
        insert into public.workout_substitutes (id, workout_exercise_id, position, exercise_id, note, sets)
        values (v_sub_id, v_ex_id, v_sub_pos, (v_sub ->> 'exerciseId')::uuid, v_sub ->> 'note',
          (select jsonb_agg(case when s.value ->> 'setType' = 'drop'
                  then jsonb_set(s.value, '{restSeconds}', '0'::jsonb) else s.value end order by s.ordinality)
             from jsonb_array_elements(v_sub -> 'sets') with ordinality s))
        on conflict (id) do update set position = excluded.position, exercise_id = excluded.exercise_id,
            note = excluded.note, sets = excluded.sets
          where public.workout_substitutes.workout_exercise_id = excluded.workout_exercise_id
            and (public.workout_substitutes.position, public.workout_substitutes.exercise_id,
                 public.workout_substitutes.note, public.workout_substitutes.sets)
              is distinct from (excluded.position, excluded.exercise_id, excluded.note, excluded.sets);
        if not found and not exists (
          select 1 from public.workout_substitutes ws where ws.id = v_sub_id and ws.workout_exercise_id = v_ex_id
        ) then
          raise exception 'Row % belongs to another workout.', v_sub_id using errcode = '23514';
        end if;
      end loop;
    end loop;
  end loop;

  -- Rows of this workout that the doc no longer has.
  delete from public.workout_substitutes ws where ws.workout_id = v_workout_id and not (ws.id = any (v_sub_ids));
  delete from public.workout_sets s where s.workout_id = v_workout_id and not (s.id = any (v_set_ids));
  delete from public.workout_exercises we where we.workout_id = v_workout_id and not (we.id = any (v_ex_ids));
  delete from public.workout_blocks b where b.workout_id = v_workout_id and not (b.id = any (v_block_ids));

  return v_workout_id;
end;
$$;
