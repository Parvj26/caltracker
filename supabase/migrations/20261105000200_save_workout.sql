-- save_workout: the coach's builder saves a whole workout document (WorkoutDoc, packages/shared) in one call.
-- Library workouts and client instances are both saved through it.
--
-- Security invoker: every write below goes through the RLS policies and column grants of the workout tables,
-- so the function can never do more than the caller could do row by row. Children are inserted without
-- owner columns (inherit_workout_owner fills them) and updates only touch columns authenticated may update.
--
-- Rows are matched by id. Each row's position is its 0-based index in the doc. Children of the workout whose
-- ids are not in the doc are deleted. A row is only rewritten when something in it changed, so unchanged rows
-- keep their updated_at (fewer changes to sync later). The workout row itself is always stamped.
-- On an existing workout only name and notes change: client_id and scheduled_on are never touched here.
--
-- The guard messages are the same as the WorkoutDoc schema in packages/shared/src/workouts/schema.ts.
create function public.save_workout(p_workspace_id uuid, p_doc jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_workout_id uuid := (p_doc ->> 'id')::uuid;
  v_blocks jsonb := coalesce(p_doc -> 'blocks', '[]'::jsonb);
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
  v_dup text;
  v_block_ids uuid[] := '{}';
  v_ex_ids uuid[] := '{}';
  v_set_ids uuid[] := '{}';
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
    for v_ex in select value from jsonb_array_elements(v_block -> 'exercises') loop
      if coalesce(jsonb_array_length(v_ex -> 'sets'), 0) = 0 then
        raise exception 'Every exercise needs at least one set.' using errcode = '23514';
      end if;
      if v_ex -> 'sets' -> 0 ->> 'setType' = 'drop' then
        raise exception 'A drop set must follow a normal or warm-up set.' using errcode = '23514';
      end if;
    end loop;
  end loop;

  select ids.id into v_dup
  from (
    select jsonb_path_query(p_doc, '$.blocks[*].id') #>> '{}' as id
    union all select jsonb_path_query(p_doc, '$.blocks[*].exercises[*].id') #>> '{}'
    union all select jsonb_path_query(p_doc, '$.blocks[*].exercises[*].sets[*].id') #>> '{}'
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

    insert into public.workout_blocks (id, workout_id, position, kind)
    values (v_block_id, v_workout_id, v_block_pos, (v_block ->> 'kind')::public.block_kind)
    on conflict (id) do update set position = excluded.position, kind = excluded.kind
      where public.workout_blocks.workout_id = excluded.workout_id
        and (public.workout_blocks.position, public.workout_blocks.kind)
          is distinct from (excluded.position, excluded.kind);
    -- Not inserted and not updated: either unchanged here, or the id is another parent's row.
    if not found and not exists (
      select 1 from public.workout_blocks b where b.id = v_block_id and b.workout_id = v_workout_id
    ) then
      raise exception 'Row % belongs to another workout.', v_block_id using errcode = '23514';
    end if;

    for v_ex, v_ex_pos in select value, ordinality - 1 from jsonb_array_elements(v_block -> 'exercises') with ordinality loop
      v_ex_id := (v_ex ->> 'id')::uuid;
      v_ex_ids := v_ex_ids || v_ex_id;

      insert into public.workout_exercises (id, block_id, position, exercise_id, note)
      values (v_ex_id, v_block_id, v_ex_pos, (v_ex ->> 'exerciseId')::uuid, v_ex ->> 'note')
      on conflict (id) do update set position = excluded.position, exercise_id = excluded.exercise_id,
          note = excluded.note
        where public.workout_exercises.block_id = excluded.block_id
          and (public.workout_exercises.position, public.workout_exercises.exercise_id, public.workout_exercises.note)
            is distinct from (excluded.position, excluded.exercise_id, excluded.note);
      if not found and not exists (
        select 1 from public.workout_exercises we where we.id = v_ex_id and we.block_id = v_block_id
      ) then
        raise exception 'Row % belongs to another workout.', v_ex_id using errcode = '23514';
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
    end loop;
  end loop;

  -- Rows of this workout that the doc no longer has.
  delete from public.workout_sets s where s.workout_id = v_workout_id and not (s.id = any (v_set_ids));
  delete from public.workout_exercises we where we.workout_id = v_workout_id and not (we.id = any (v_ex_ids));
  delete from public.workout_blocks b where b.workout_id = v_workout_id and not (b.id = any (v_block_ids));

  return v_workout_id;
end;
$$;

revoke execute on function public.save_workout(uuid, jsonb) from public, anon, service_role;
grant execute on function public.save_workout(uuid, jsonb) to authenticated;
