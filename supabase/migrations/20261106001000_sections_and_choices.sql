-- Workout sections and pick-one groups (spec: docs/superpowers/specs/2026-11-06-sections-and-choices-design.md).
--
-- A section ("Upper", "Core") is a named group of consecutive blocks. There is no sections table: each block
-- carries its section's id and name, and the apps rebuild the doc's sections list from the blocks in order of
-- first appearance. A 'choice' block (added to block_kind in 20261106000900) holds 2 to 5 exercises of which
-- the client does one; the log records the pick on the log block.
--
-- No new tables, so no new RLS policies: the new columns are covered by the existing row policies.

-- Plans. Both section columns are set or both are null.
alter table public.workout_blocks
  add column section_id uuid,
  add column section_name text,
  add constraint workout_blocks_section_name_length check (char_length(btrim(section_name)) between 1 and 40),
  add constraint workout_blocks_section_pair check ((section_id is null) = (section_name is null));

-- save_workout is security invoker, so the coach writes these columns with their own privileges.
grant insert (section_id, section_name) on public.workout_blocks to authenticated;
grant update (section_id, section_name) on public.workout_blocks to authenticated;

-- Logs. picked_exercise_id is the picked option's log exercise. Like planned_workout_exercise_id it has no
-- foreign key, so an offline save never fails on it; save_workout_log checks it is one of the block's exercises.
-- Clients still write logs only through save_workout_log (security definer), so there are no new grants.
alter table public.log_blocks
  add column section_id uuid,
  add column section_name text,
  add column picked_exercise_id uuid,
  add constraint log_blocks_section_name_length check (char_length(btrim(section_name)) between 1 and 40),
  add constraint log_blocks_section_pair check ((section_id is null) = (section_name is null)),
  add constraint log_blocks_pick_only_choice check (picked_exercise_id is null or kind = 'choice');

-- save_workout (from 20261105000200), changed only to check pick-one groups and sections and to write the
-- section columns. A doc without a "sections" key (saved before this change) still saves: its blocks have no
-- section. sectionId must be one of the doc's sections; section_name is that section's trimmed name.
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

-- copy_workout (from 20261105000400), changed only to copy the section columns with the kind.
create or replace function public.copy_workout(p_source uuid, p_client uuid, p_date date, p_assignment uuid, p_new_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_new_id, gen_random_uuid());
  v_old_blocks uuid[];
  v_new_blocks uuid[];
  v_old_exercises uuid[];
  v_new_exercises uuid[];
begin
  if p_client is null or p_date is null then
    raise exception 'A client and a date are required' using errcode = '22004';
  end if;

  insert into public.workouts (id, workspace_id, client_id, scheduled_on, assignment_id, source_workout_id, name, notes)
  select v_id, w.workspace_id, p_client, p_date, p_assignment, w.id, w.name, w.notes
  from public.workouts w
  where w.id = p_source and w.client_id is null
  on conflict (id) do nothing;
  if not found then
    if not exists (select 1 from public.workouts w where w.id = p_source and w.client_id is null) then
      raise exception 'Library workout not found' using errcode = 'P0002';
    end if;
    return null; -- p_new_id is already taken
  end if;

  with m as materialized (
    select b.id as old_id, gen_random_uuid() as new_id from public.workout_blocks b where b.workout_id = p_source
  ), ins as (
    insert into public.workout_blocks (id, workout_id, position, kind, section_id, section_name)
    select m.new_id, v_id, b.position, b.kind, b.section_id, b.section_name
    from m join public.workout_blocks b on b.id = m.old_id
  )
  select coalesce(array_agg(m.old_id), '{}'), coalesce(array_agg(m.new_id), '{}')
  into v_old_blocks, v_new_blocks from m;

  with bm as (
    select * from unnest(v_old_blocks, v_new_blocks) as t(old_id, new_id)
  ), m as materialized (
    select e.id as old_id, gen_random_uuid() as new_id, bm.new_id as new_block_id
    from public.workout_exercises e join bm on bm.old_id = e.block_id
  ), ins as (
    insert into public.workout_exercises (id, block_id, position, exercise_id, note)
    select m.new_id, m.new_block_id, e.position, e.exercise_id, e.note
    from m join public.workout_exercises e on e.id = m.old_id
  )
  select coalesce(array_agg(m.old_id), '{}'), coalesce(array_agg(m.new_id), '{}')
  into v_old_exercises, v_new_exercises from m;

  insert into public.workout_sets (id, workout_exercise_id, position, set_type, target_reps_min, target_reps_max,
    target_weight_kg, target_duration_s, target_distance_m, to_failure, rest_seconds, note)
  select gen_random_uuid(), em.new_id, s.position, s.set_type, s.target_reps_min, s.target_reps_max,
    s.target_weight_kg, s.target_duration_s, s.target_distance_m, s.to_failure, s.rest_seconds, s.note
  from unnest(v_old_exercises, v_new_exercises) as em(old_id, new_id)
  join public.workout_sets s on s.workout_exercise_id = em.old_id;

  return v_id;
end;
$$;

-- save_workout_log (from 20261105000800), changed only to check sections and pick-one groups and to write the
-- three new columns. A log saved by an older app (no sections, sectionId or pickedExerciseId) stores nulls.
-- The pick rules match WorkoutLogDoc in packages/shared/src/logs/schema.ts: only a 'choice' block may have a
-- pick, the pick is one of that block's exercises, and only the picked option may have done sets.
create or replace function public.save_workout_log(p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_log_id uuid := (p_doc ->> 'id')::uuid;
  v_revision integer := (p_doc ->> 'revision')::integer;
  v_status public.log_status := (p_doc ->> 'status')::public.log_status;
  v_doc_workout_id uuid := (p_doc ->> 'workoutId')::uuid;
  v_blocks jsonb := coalesce(p_doc -> 'blocks', '[]'::jsonb);
  v_sections jsonb := case when jsonb_typeof(p_doc -> 'sections') = 'array' then p_doc -> 'sections' else '[]'::jsonb end;
  v_section_id uuid;
  v_log public.workout_logs%rowtype;
  v_exists boolean;
  v_plan public.workouts%rowtype;
  v_workout_id uuid;
  v_workspace_id uuid;
  v_workspaces uuid[];
  v_finished_at timestamptz;
  v_auto_finished boolean;
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
  v_rest smallint;
  v_to_failure boolean;
  v_bad text;
  v_block_ids uuid[];
  v_ex_ids uuid[];
  v_set_ids uuid[];
begin
  if v_uid is null then
    raise exception 'Sign in to save a workout.' using errcode = '42501';
  end if;
  if v_log_id is null or v_revision is null or v_status is null or jsonb_typeof(v_blocks) <> 'array' then
    raise exception 'A workout log needs an id, a status, a revision and blocks.' using errcode = '22023';
  end if;

  -- One save per log id at a time (two quick saves of a brand-new log would otherwise both insert).
  perform pg_advisory_xact_lock(hashtextextended('save_workout_log:' || v_log_id::text, 0));

  select * into v_log from public.workout_logs l where l.id = v_log_id for update;
  v_exists := found;
  if v_exists and v_log.client_id <> v_uid then
    raise exception 'This workout belongs to someone else.' using errcode = '42501';
  end if;

  if v_doc_workout_id is not null then
    select * into v_plan from public.workouts w where w.id = v_doc_workout_id;
    if found then
      if v_plan.client_id is distinct from v_uid then
        raise exception 'This workout is not planned for you.' using errcode = '42501';
      end if;
      v_workout_id := v_plan.id;
    end if;
  end if;

  if v_exists then
    v_workspace_id := v_log.workspace_id;
    if v_workout_id is not null and v_plan.workspace_id <> v_workspace_id then
      raise exception 'This workout is not planned for you.' using errcode = '42501';
    end if;
  elsif v_workout_id is not null then
    v_workspace_id := v_plan.workspace_id;
  else
    select array_agg(m.workspace_id) into v_workspaces
    from public.workspace_members m where m.user_id = v_uid and m.role = 'client';
    if coalesce(cardinality(v_workspaces), 0) = 0 then
      raise exception 'Only a current client of this coach can save workouts.'
        using errcode = '42501', hint = 'not_a_client';
    end if;
    if cardinality(v_workspaces) <> 1 then
      raise exception 'You need exactly one coach to log a workout without a plan.' using errcode = '42501';
    end if;
    v_workspace_id := v_workspaces[1];
  end if;

  if not public.is_client_in(v_workspace_id, v_uid) then
    raise exception 'Only a current client of this coach can save workouts.'
      using errcode = '42501', hint = 'not_a_client';
  end if;

  if v_revision < 1 then
    raise exception 'Revision must be at least 1.' using errcode = '23514';
  end if;

  -- Stale, repeated or locked: keep the server copy and tell the phone to adopt it.
  if v_exists and (
    v_revision <= v_log.revision
    or not (
      v_log.status = 'in_progress'
      or (v_log.auto_finished and v_log.corrected_at is null)
    )
  ) then
    return jsonb_build_object('applied', false, 'revision', v_log.revision, 'status', v_log.status);
  end if;

  -- Document guards, before any write. Messages match WorkoutLogDoc / WorkoutDoc in packages/shared.
  if v_status = 'completed'
     and not jsonb_path_exists(v_blocks, '$[*].exercises[*].sets[*] ? (@.completedAt != null)') then
    raise exception 'Complete at least one set to finish.' using errcode = '23514';
  end if;
  for v_block in select value from jsonb_array_elements(v_blocks) loop
    if v_block ->> 'kind' = 'superset' and coalesce(jsonb_array_length(v_block -> 'exercises'), 0) < 2 then
      raise exception 'A superset needs at least two exercises.' using errcode = '23514';
    end if;
    if v_block ->> 'sectionId' is not null and not exists (
      select 1 from jsonb_array_elements(v_sections) s where s.value ->> 'id' = v_block ->> 'sectionId'
    ) then
      raise exception 'Unknown section.' using errcode = '23514';
    end if;
    if v_block ->> 'kind' = 'choice'
       and coalesce(jsonb_array_length(v_block -> 'exercises'), 0) not between 2 and 5 then
      raise exception 'A pick-one group needs 2 to 5 exercises.' using errcode = '23514';
    end if;
    if v_block ->> 'pickedExerciseId' is not null then
      if v_block ->> 'kind' is distinct from 'choice' then
        raise exception 'Only a pick-one group can have a pick.' using errcode = '23514';
      end if;
      if not jsonb_path_exists(v_block, '$.exercises[*] ? (@.id == $p)',
          jsonb_build_object('p', v_block ->> 'pickedExerciseId')) then
        raise exception 'The pick must be one of the group''s exercises.' using errcode = '23514';
      end if;
    end if;
    -- Only the picked option may have done sets, so everything that counts done sets ignores the others.
    if v_block ->> 'kind' = 'choice' and jsonb_path_exists(v_block,
        '$.exercises[*] ? (@.id != $p || $p == null).sets[*] ? (@.completedAt != null)',
        jsonb_build_object('p', v_block -> 'pickedExerciseId')) then
      raise exception 'Only the picked option can have done sets.' using errcode = '23514';
    end if;
    for v_ex in select value from jsonb_array_elements(coalesce(v_block -> 'exercises', '[]'::jsonb)) loop
      if coalesce(jsonb_array_length(v_ex -> 'sets'), 0) = 0 then
        raise exception 'Every exercise needs at least one set.' using errcode = '23514';
      end if;
      if v_ex -> 'sets' -> 0 ->> 'setType' = 'drop' then
        raise exception 'A drop set must follow a normal or warm-up set.' using errcode = '23514';
      end if;
      for v_set in select value from jsonb_array_elements(v_ex -> 'sets') loop
        if v_set ->> 'setType' = 'drop' and coalesce((v_set -> 'target' ->> 'restSeconds')::integer, 0) <> 0 then
          raise exception 'A drop set has no rest.' using errcode = '23514';
        end if;
        if coalesce((v_set -> 'target' ->> 'toFailure')::boolean, false) and v_set ->> 'setType' <> 'drop' then
          raise exception 'Only drop sets can be "to failure".' using errcode = '23514';
        end if;
      end loop;
    end loop;
  end loop;

  select coalesce(array_agg(x #>> '{}'), '{}')::uuid[] into v_block_ids from jsonb_path_query(v_blocks, '$[*].id') x;
  select coalesce(array_agg(x #>> '{}'), '{}')::uuid[] into v_ex_ids from jsonb_path_query(v_blocks, '$[*].exercises[*].id') x;
  select coalesce(array_agg(x #>> '{}'), '{}')::uuid[] into v_set_ids
  from jsonb_path_query(v_blocks, '$[*].exercises[*].sets[*].id') x;

  select ids.id::text into v_bad
  from (select unnest(v_block_ids) as id union all select unnest(v_ex_ids) union all select unnest(v_set_ids)) ids
  group by ids.id having count(*) > 1 limit 1;
  if v_bad is not null then
    raise exception 'Row % appears twice in the log.', v_bad using errcode = '23514';
  end if;

  -- No id may name another log's row.
  select x.id::text into v_bad from (
    select b.id from public.log_blocks b where b.id = any (v_block_ids) and b.log_id <> v_log_id
    union all select e.id from public.log_exercises e where e.id = any (v_ex_ids) and e.log_id <> v_log_id
    union all select s.id from public.log_sets s where s.id = any (v_set_ids) and s.log_id <> v_log_id
  ) x limit 1;
  if v_bad is not null then
    raise exception 'Row % belongs to another log.', v_bad using errcode = '23514';
  end if;

  select x.ex into v_bad from (
    select jsonb_path_query(v_blocks, '$[*].exercises[*].exerciseId') #>> '{}' as ex
    union select jsonb_path_query(v_blocks, '$[*].exercises[*].swappedFromExerciseId ? (@ != null)') #>> '{}'
  ) x where not public.exercise_usable_in(x.ex::uuid, v_workspace_id) limit 1;
  if v_bad is not null then
    raise exception 'Exercise % is not available in this workspace.', v_bad using errcode = '42501';
  end if;

  -- The log row. Completed always has finished_at (a table check), even when the doc left it out.
  v_finished_at := (p_doc ->> 'finishedAt')::timestamptz;
  if v_status = 'completed' then
    v_finished_at := coalesce(v_finished_at, now());
  end if;
  if v_status <> 'in_progress' and (not v_exists or v_log.status = 'in_progress' or v_log.auto_finished) then
    v_auto_finished := coalesce((p_doc ->> 'autoFinished')::boolean, false);
  elsif v_exists then
    v_auto_finished := v_log.auto_finished;
  else
    v_auto_finished := false;
  end if;

  if v_exists then
    -- workout_id, started_at and the owner columns stay as first saved.
    update public.workout_logs l set
      name = btrim(p_doc ->> 'name'),
      status = v_status,
      finished_at = v_finished_at,
      last_activity_at = least(coalesce((p_doc ->> 'lastActivityAt')::timestamptz, now()), now()),
      auto_finished = v_auto_finished,
      revision = v_revision,
      notes = p_doc ->> 'notes'
    where l.id = v_log_id;
  else
    insert into public.workout_logs (id, workspace_id, client_id, workout_id, name, status, started_at, finished_at,
      last_activity_at, auto_finished, logged_by, revision, notes)
    values (v_log_id, v_workspace_id, v_uid, v_workout_id, btrim(p_doc ->> 'name'), v_status,
      coalesce((p_doc ->> 'startedAt')::timestamptz, now()), v_finished_at,
      least(coalesce((p_doc ->> 'lastActivityAt')::timestamptz, now()), now()),
      v_auto_finished, v_uid, v_revision, p_doc ->> 'notes');
  end if;

  -- The tree. Owner columns come from inherit_log_owner; each update is guarded to rows of this log.
  for v_block, v_block_pos in select value, ordinality - 1 from jsonb_array_elements(v_blocks) with ordinality loop
    v_block_id := (v_block ->> 'id')::uuid;
    v_section_id := (v_block ->> 'sectionId')::uuid;

    insert into public.log_blocks (id, log_id, position, kind, section_id, section_name, picked_exercise_id)
    values (v_block_id, v_log_id, v_block_pos, (v_block ->> 'kind')::public.block_kind, v_section_id,
      (select btrim(s.value ->> 'name') from jsonb_array_elements(v_sections) s
        where s.value ->> 'id' = v_block ->> 'sectionId' limit 1),
      (v_block ->> 'pickedExerciseId')::uuid)
    on conflict (id) do update set position = excluded.position, kind = excluded.kind,
        section_id = excluded.section_id, section_name = excluded.section_name,
        picked_exercise_id = excluded.picked_exercise_id
      where public.log_blocks.log_id = excluded.log_id
        and (public.log_blocks.position, public.log_blocks.kind, public.log_blocks.section_id,
             public.log_blocks.section_name, public.log_blocks.picked_exercise_id)
          is distinct from (excluded.position, excluded.kind, excluded.section_id, excluded.section_name,
             excluded.picked_exercise_id);
    if not found and not exists (select 1 from public.log_blocks b where b.id = v_block_id and b.log_id = v_log_id) then
      raise exception 'Row % belongs to another log.', v_block_id using errcode = '23514';
    end if;

    for v_ex, v_ex_pos in select value, ordinality - 1 from jsonb_array_elements(v_block -> 'exercises') with ordinality loop
      v_ex_id := (v_ex ->> 'id')::uuid;

      -- Moved to another block of this log: re-insert it there (its sets follow below).
      delete from public.log_exercises e where e.id = v_ex_id and e.log_id = v_log_id and e.block_id <> v_block_id;

      insert into public.log_exercises (id, block_id, position, exercise_id, planned_workout_exercise_id,
        swapped_from_exercise_id, note)
      values (v_ex_id, v_block_id, v_ex_pos, (v_ex ->> 'exerciseId')::uuid,
        (v_ex ->> 'plannedWorkoutExerciseId')::uuid, (v_ex ->> 'swappedFromExerciseId')::uuid, v_ex ->> 'note')
      on conflict (id) do update set position = excluded.position, exercise_id = excluded.exercise_id,
          planned_workout_exercise_id = excluded.planned_workout_exercise_id,
          swapped_from_exercise_id = excluded.swapped_from_exercise_id, note = excluded.note
        where public.log_exercises.log_id = excluded.log_id
          and (public.log_exercises.position, public.log_exercises.exercise_id,
               public.log_exercises.planned_workout_exercise_id, public.log_exercises.swapped_from_exercise_id,
               public.log_exercises.note)
            is distinct from (excluded.position, excluded.exercise_id, excluded.planned_workout_exercise_id,
               excluded.swapped_from_exercise_id, excluded.note);
      if not found and not exists (
        select 1 from public.log_exercises e where e.id = v_ex_id and e.log_id = v_log_id and e.block_id = v_block_id
      ) then
        raise exception 'Row % belongs to another log.', v_ex_id using errcode = '23514';
      end if;

      for v_set, v_set_pos in select value, ordinality - 1 from jsonb_array_elements(v_ex -> 'sets') with ordinality loop
        v_set_id := (v_set ->> 'id')::uuid;
        v_set_type := (v_set ->> 'setType')::public.set_type;
        v_rest := (v_set -> 'target' ->> 'restSeconds')::smallint;
        v_to_failure := coalesce((v_set -> 'target' ->> 'toFailure')::boolean, false);

        delete from public.log_sets s where s.id = v_set_id and s.log_id = v_log_id and s.log_exercise_id <> v_ex_id;

        insert into public.log_sets (id, log_exercise_id, position, set_type, target_reps_min, target_reps_max,
          target_weight_kg, target_duration_s, target_distance_m, to_failure, rest_seconds,
          actual_reps, actual_weight_kg, actual_duration_s, actual_distance_m, completed_at)
        values (v_set_id, v_ex_id, v_set_pos, v_set_type,
          (v_set -> 'target' ->> 'repsMin')::smallint, (v_set -> 'target' ->> 'repsMax')::smallint,
          (v_set -> 'target' ->> 'weightKg')::numeric, (v_set -> 'target' ->> 'durationS')::integer,
          (v_set -> 'target' ->> 'distanceM')::numeric, v_to_failure, v_rest,
          (v_set ->> 'actualReps')::smallint, (v_set ->> 'actualWeightKg')::numeric,
          (v_set ->> 'actualDurationS')::integer, (v_set ->> 'actualDistanceM')::numeric,
          (v_set ->> 'completedAt')::timestamptz)
        on conflict (id) do update set position = excluded.position, set_type = excluded.set_type,
            target_reps_min = excluded.target_reps_min, target_reps_max = excluded.target_reps_max,
            target_weight_kg = excluded.target_weight_kg, target_duration_s = excluded.target_duration_s,
            target_distance_m = excluded.target_distance_m, to_failure = excluded.to_failure,
            rest_seconds = excluded.rest_seconds, actual_reps = excluded.actual_reps,
            actual_weight_kg = excluded.actual_weight_kg, actual_duration_s = excluded.actual_duration_s,
            actual_distance_m = excluded.actual_distance_m, completed_at = excluded.completed_at
          where public.log_sets.log_id = excluded.log_id
            and (public.log_sets.position, public.log_sets.set_type, public.log_sets.target_reps_min,
                 public.log_sets.target_reps_max, public.log_sets.target_weight_kg, public.log_sets.target_duration_s,
                 public.log_sets.target_distance_m, public.log_sets.to_failure, public.log_sets.rest_seconds,
                 public.log_sets.actual_reps, public.log_sets.actual_weight_kg, public.log_sets.actual_duration_s,
                 public.log_sets.actual_distance_m, public.log_sets.completed_at)
              is distinct from (excluded.position, excluded.set_type, excluded.target_reps_min,
                 excluded.target_reps_max, excluded.target_weight_kg, excluded.target_duration_s,
                 excluded.target_distance_m, excluded.to_failure, excluded.rest_seconds, excluded.actual_reps,
                 excluded.actual_weight_kg, excluded.actual_duration_s, excluded.actual_distance_m,
                 excluded.completed_at);
        if not found and not exists (
          select 1 from public.log_sets s where s.id = v_set_id and s.log_id = v_log_id and s.log_exercise_id = v_ex_id
        ) then
          raise exception 'Row % belongs to another log.', v_set_id using errcode = '23514';
        end if;
      end loop;
    end loop;
  end loop;

  -- Rows of this log that the doc no longer has.
  delete from public.log_sets s where s.log_id = v_log_id and not (s.id = any (v_set_ids));
  delete from public.log_exercises e where e.log_id = v_log_id and not (e.id = any (v_ex_ids));
  delete from public.log_blocks b where b.log_id = v_log_id and not (b.id = any (v_block_ids));

  return jsonb_build_object('applied', true, 'revision', v_revision, 'status', v_status);
end;
$$;
