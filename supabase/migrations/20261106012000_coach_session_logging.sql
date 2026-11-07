-- Coach session logging (spec: docs/superpowers/specs/2026-11-06-coach-session-logging-design.md).
--
-- The coach logs a client's workout from the website during an in-person session. The log is the client's
-- (client_id), exactly like one from the phone, so history, PRs, streaks and stickers count it the same way;
-- logged_by is whoever logs it now. One person logs a workout at a time ("single active logger"):
--   * save_workout_log (the phone) and coach_save_workout_log (the website) share one body,
--     private.save_workout_log_as, which refuses (applied=false, loggedByOther) a change from anyone but the
--     log's logged_by;
--   * take_over_workout_log hands an in-progress log to a coach, hand_back_workout_log gives it back to the
--     client, and reclaim_workout_log lets the client take it back once the coach has stopped (20 minutes with
--     no activity) or is no longer a coach of the workspace;
--   * workout_log_logger lets the client's phone ask who holds its log.
-- No new tables, so no new RLS policies: coaches already read every log of their workspace, and all writes go
-- through these security definer functions, which check the workspace themselves.

-- The shared body lives outside the API schema, so it can never be called directly over PostgREST.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- logged_by may now change while the log is in progress, to a coach of the log's workspace or back to its client;
-- or to null (the account was deleted). workspace_id and client_id still never change.
drop trigger workout_logs_refuse_owner_change on public.workout_logs;
create trigger workout_logs_refuse_owner_change before update on public.workout_logs
  for each row execute function public.refuse_owner_change('workspace_id', 'client_id');

create function public.check_logged_by_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.logged_by is distinct from old.logged_by and new.logged_by is not null
     and not (old.status = 'in_progress' and new.status = 'in_progress' and (
       new.logged_by = new.client_id
       or exists (select 1 from public.workspace_members m
         where m.workspace_id = new.workspace_id and m.user_id = new.logged_by and m.role in ('owner', 'staff')))) then
    raise exception 'Column logged_by of workout_logs cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_logged_by_change() from public, anon, authenticated;

create trigger workout_logs_check_logged_by before update on public.workout_logs
  for each row execute function public.check_logged_by_change();

-- private.save_workout_log_as: save_workout_log's body (from 20261106002100_substitutes, substitute checks
-- included) for a log of p_client written by p_logger. Changed only to:
--   * take the client and the logger as arguments instead of auth.uid();
--   * when the logger is not the client, require them to coach the log's workspace (an unplanned log goes in the
--     workspace they coach the client in);
--   * refuse a change from anyone but the stored logged_by (single active logger);
--   * store logged_by = p_logger on insert.
-- Every other rule (plan ownership, current client, revisions, document guards, row ids, substitutes) is
-- unchanged, so a coach's save is held to exactly what the phone's is.
create function private.save_workout_log_as(p_doc jsonb, p_client uuid, p_logger uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := p_client; -- the log's client (the caller for a client save)
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
  if v_uid is null or p_logger is null then
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
    from public.workspace_members m where m.user_id = v_uid and m.role = 'client'
      -- A coach's unplanned log goes in the workspace they coach the client in.
      and (p_logger = v_uid or exists (select 1 from public.workspace_members c
        where c.workspace_id = m.workspace_id and c.user_id = p_logger and c.role in ('owner', 'staff')));
    if coalesce(cardinality(v_workspaces), 0) = 0 and p_logger <> v_uid then
      raise exception 'Only a coach of this client can log their workout.' using errcode = '42501';
    end if;
    if coalesce(cardinality(v_workspaces), 0) = 0 then
      raise exception 'Only a current client of this coach can save workouts.'
        using errcode = '42501', hint = 'not_a_client';
    end if;
    if cardinality(v_workspaces) <> 1 then
      raise exception 'You need exactly one coach to log a workout without a plan.' using errcode = '42501';
    end if;
    v_workspace_id := v_workspaces[1];
  end if;

  -- A coach logs only for a client of a workspace they coach. Checked before the client check, so another
  -- workspace's coach (or another client) gets the plain refusal, never the removed-client hint.
  if p_logger <> v_uid and not exists (select 1 from public.workspace_members c
      where c.workspace_id = v_workspace_id and c.user_id = p_logger and c.role in ('owner', 'staff')) then
    raise exception 'Only a coach of this client can log their workout.' using errcode = '42501';
  end if;

  if not public.is_client_in(v_workspace_id, v_uid) then
    raise exception 'Only a current client of this coach can save workouts.'
      using errcode = '42501', hint = 'not_a_client';
  end if;

  if v_revision < 1 then
    raise exception 'Revision must be at least 1.' using errcode = '23514';
  end if;

  -- Single active logger: only the person logging a workout changes it (take_over_workout_log,
  -- hand_back_workout_log and reclaim_workout_log move it). Not an error, like a stale save: the other side
  -- adopts the server copy and never pushes its own (loggedByOther). A log whose logger's account was deleted
  -- (logged_by null) stays the client's.
  if v_exists and coalesce(v_log.logged_by, v_log.client_id) <> p_logger then
    return jsonb_build_object('applied', false, 'revision', v_log.revision, 'status', v_log.status,
      'loggedByOther', true);
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
      -- Substitutes: the exercise's own fields and sets are the option being done; the options are a planned
      -- snapshot. A log saved before substitutes has neither key.
      if v_ex ? 'substituteOptions' and jsonb_typeof(v_ex -> 'substituteOptions') is distinct from 'array'
         or coalesce(jsonb_array_length(case when jsonb_typeof(v_ex -> 'substituteOptions') = 'array'
              then v_ex -> 'substituteOptions' end), 0) > 4 then
        raise exception 'An exercise has at most 4 substitute options.' using errcode = '23514';
      end if;
      if v_ex ->> 'substituteId' is not null and not jsonb_path_exists(v_ex,
          '$.substituteOptions[*] ? (@.substituteId == $p)', jsonb_build_object('p', v_ex ->> 'substituteId')) then
        raise exception 'The substitute must be one of the options.' using errcode = '23514';
      end if;
      if jsonb_path_exists(v_ex, '$.substituteOptions[*].sets[*] ? (@.completedAt != null)') then
        raise exception 'Only the exercise being done can have done sets.' using errcode = '23514';
      end if;
      -- The shape of LogSubstituteOption, so the coach's page and the phone can always read the options back.
      if jsonb_typeof(v_ex -> 'substituteOptions') = 'array' and exists (
        select 1 from jsonb_array_elements(v_ex -> 'substituteOptions') o(v)
        where not (
          jsonb_typeof(o.v) = 'object'
          and (o.v -> 'substituteId' = 'null'::jsonb or (jsonb_typeof(o.v -> 'substituteId') = 'string'
            and public.uuid_text_ok(o.v ->> 'substituteId')))
          and jsonb_typeof(o.v -> 'exerciseId') = 'string'
          and public.uuid_text_ok(o.v ->> 'exerciseId')
          and jsonb_typeof(o.v -> 'exerciseName') = 'string'
          and o.v ->> 'trackingType' in (select t::text from unnest(enum_range(null::public.tracking_type)) t)
          and (o.v -> 'note' is null or o.v -> 'note' = 'null'::jsonb
            or (jsonb_typeof(o.v -> 'note') = 'string' and char_length(o.v ->> 'note') <= 500))
          and jsonb_typeof(o.v -> 'sets') = 'array' and jsonb_array_length(o.v -> 'sets') between 1 and 30
          and not exists (select 1 from jsonb_array_elements(o.v -> 'sets') s(v)
            where jsonb_typeof(s.v) <> 'object' or coalesce(s.v ->> 'setType', '') not in ('normal', 'warmup', 'drop')
              or jsonb_typeof(s.v -> 'target') <> 'object')
        )
      ) then
        raise exception 'A substitute option is not valid.' using errcode = '23514';
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
      last_activity_at = case when p_logger <> v_uid then now()
        else least(coalesce((p_doc ->> 'lastActivityAt')::timestamptz, now()), now()) end,
      auto_finished = v_auto_finished,
      revision = v_revision,
      notes = p_doc ->> 'notes'
    where l.id = v_log_id;
  else
    insert into public.workout_logs (id, workspace_id, client_id, workout_id, name, status, started_at, finished_at,
      last_activity_at, auto_finished, logged_by, revision, notes)
    values (v_log_id, v_workspace_id, v_uid, v_workout_id, btrim(p_doc ->> 'name'), v_status,
      coalesce((p_doc ->> 'startedAt')::timestamptz, now()), v_finished_at,
      case when p_logger <> v_uid then now()
        else least(coalesce((p_doc ->> 'lastActivityAt')::timestamptz, now()), now()) end,
      v_auto_finished, p_logger, v_revision, p_doc ->> 'notes');
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
        swapped_from_exercise_id, note, substitute_id, substitute_options)
      values (v_ex_id, v_block_id, v_ex_pos, (v_ex ->> 'exerciseId')::uuid,
        (v_ex ->> 'plannedWorkoutExerciseId')::uuid, (v_ex ->> 'swappedFromExerciseId')::uuid, v_ex ->> 'note',
        (v_ex ->> 'substituteId')::uuid,
        -- Only the exercise actually done must be usable. An option whose exercise is not (say the coach deleted
        -- that custom exercise mid-workout) is left out rather than refusing the save, which the phone would treat
        -- as final and drop the workout.
        (select coalesce(jsonb_agg(o.value order by o.ordinality), '[]'::jsonb)
           from jsonb_array_elements(coalesce(v_ex -> 'substituteOptions', '[]'::jsonb)) with ordinality o
           where public.exercise_usable_in((o.value ->> 'exerciseId')::uuid, v_workspace_id)))
      on conflict (id) do update set position = excluded.position, exercise_id = excluded.exercise_id,
          planned_workout_exercise_id = excluded.planned_workout_exercise_id,
          swapped_from_exercise_id = excluded.swapped_from_exercise_id, note = excluded.note,
          substitute_id = excluded.substitute_id, substitute_options = excluded.substitute_options
        where public.log_exercises.log_id = excluded.log_id
          and (public.log_exercises.position, public.log_exercises.exercise_id,
               public.log_exercises.planned_workout_exercise_id, public.log_exercises.swapped_from_exercise_id,
               public.log_exercises.note, public.log_exercises.substitute_id, public.log_exercises.substitute_options)
            is distinct from (excluded.position, excluded.exercise_id, excluded.planned_workout_exercise_id,
               excluded.swapped_from_exercise_id, excluded.note, excluded.substitute_id, excluded.substitute_options);
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

revoke execute on function private.save_workout_log_as(jsonb, uuid, uuid) from public, anon, authenticated, service_role;

-- The phone: the caller is the client and the logger.
create or replace function public.save_workout_log(p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in to save a workout.' using errcode = '42501';
  end if;
  return private.save_workout_log_as(p_doc, v_uid, v_uid);
end;
$$;

revoke execute on function public.save_workout_log(jsonb) from public, anon, service_role;
grant execute on function public.save_workout_log(jsonb) to authenticated;

-- The website: the caller is a coach logging for p_client_id. The same answers as save_workout_log.
create function public.coach_save_workout_log(p_client_id uuid, p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in to save a workout.' using errcode = '42501';
  end if;
  if p_client_id is null or p_client_id = v_uid then
    raise exception 'Only a coach of this client can log their workout.' using errcode = '42501';
  end if;
  return private.save_workout_log_as(p_doc, p_client_id, v_uid);
end;
$$;

revoke execute on function public.coach_save_workout_log(uuid, jsonb) from public, anon, service_role;
grant execute on function public.coach_save_workout_log(uuid, jsonb) to authenticated;

-- How long a coach-held log must go without activity before the client may take it back on the phone.
create function private.reclaim_after() returns interval language sql immutable set search_path = '' as $$ select interval '20 minutes' $$;

-- take_over_workout_log: a coach takes an in-progress log over (the client, or another coach, was logging it).
-- From now on only this coach's saves apply; the phone's are refused with loggedByOther and it shows the coach's
-- copy. Taking over a log the caller already logs changes nothing. It returns { revision, status }.
create function public.take_over_workout_log(p_log_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_log public.workout_logs%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to log a workout.' using errcode = '42501';
  end if;
  -- The same lock as a save of this log, so a save never interleaves with the hand-over.
  perform pg_advisory_xact_lock(hashtextextended('save_workout_log:' || p_log_id::text, 0));
  select * into v_log from public.workout_logs l where l.id = p_log_id for update;
  if not found or not public.is_coach_of(v_log.workspace_id) then
    raise exception 'Only a coach of this client can take over their workout.' using errcode = '42501';
  end if;
  if not public.is_client_in(v_log.workspace_id, v_log.client_id) then
    raise exception 'Only a current client of this coach can save workouts.'
      using errcode = '42501', hint = 'not_a_client';
  end if;
  if v_log.status <> 'in_progress' then
    raise exception 'This workout is not in progress any more.' using errcode = '23514';
  end if;
  if v_log.logged_by is distinct from v_uid then
    update public.workout_logs l set logged_by = v_uid, last_activity_at = now() where l.id = p_log_id;
  end if;
  return jsonb_build_object('revision', v_log.revision, 'status', v_log.status);
end;
$$;

revoke execute on function public.take_over_workout_log(uuid) from public, anon, service_role;
grant execute on function public.take_over_workout_log(uuid) to authenticated;

-- hand_back_workout_log: the coach logging an in-progress log gives it back to the client's phone.
-- The revision jumps by 1000: a phone that was offline with edits queued since before the take over would
-- otherwise push its older copy over the coach's sets. With the jump it adopts the coach's copy instead (and
-- keeps its own as a rejected copy, as for any refusal). Returns { revision, status }.
create function public.hand_back_workout_log(p_log_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_log public.workout_logs%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to log a workout.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('save_workout_log:' || p_log_id::text, 0));
  select * into v_log from public.workout_logs l where l.id = p_log_id for update;
  if not found or not public.is_coach_of(v_log.workspace_id) or v_log.logged_by is distinct from v_uid then
    raise exception 'Only the coach logging this workout can hand it back.' using errcode = '42501';
  end if;
  if not public.is_client_in(v_log.workspace_id, v_log.client_id) then
    raise exception 'Only a current client of this coach can save workouts.'
      using errcode = '42501', hint = 'not_a_client';
  end if;
  if v_log.status <> 'in_progress' then
    raise exception 'This workout is not in progress any more.' using errcode = '23514';
  end if;
  update public.workout_logs l set logged_by = l.client_id, revision = l.revision + 1000, last_activity_at = now()
  where l.id = p_log_id;
  return jsonb_build_object('revision', v_log.revision + 1000, 'status', v_log.status);
end;
$$;

revoke execute on function public.hand_back_workout_log(uuid) from public, anon, service_role;
grant execute on function public.hand_back_workout_log(uuid) to authenticated;

-- workout_log_logger: for the client's own log, who holds it. Activity is the server's clock: a coach's save sets
-- last_activity_at to now() (see private.save_workout_log_as), so typing counts and a wrong browser clock can't
-- make a session look abandoned. { status, heldByOther, lastActivityAt, canReclaim }.
-- canReclaim: held by someone else, in progress, and either 20 minutes without activity or the holder is no
-- longer a coach of the workspace (a removed staff coach). The holder's id is never returned to the client.
create function public.workout_log_logger(p_log_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_log public.workout_logs%rowtype;
  v_held boolean;
  v_holder_is_coach boolean;
begin
  select * into v_log from public.workout_logs l where l.id = p_log_id;
  if not found or v_uid is null or v_log.client_id <> v_uid or not public.is_client_in(v_log.workspace_id, v_uid) then
    return null;
  end if;
  v_held := coalesce(v_log.logged_by, v_log.client_id) <> v_log.client_id;
  v_holder_is_coach := exists (select 1 from public.workspace_members m
    where m.workspace_id = v_log.workspace_id and m.user_id = v_log.logged_by and m.role in ('owner', 'staff'));
  return jsonb_build_object('status', v_log.status, 'heldByOther', v_held, 'lastActivityAt', v_log.last_activity_at,
    'canReclaim', v_held and v_log.status = 'in_progress'
      and (not v_holder_is_coach or v_log.last_activity_at < now() - private.reclaim_after()));
end;
$$;

revoke execute on function public.workout_log_logger(uuid) from public, anon, service_role;
grant execute on function public.workout_log_logger(uuid) to authenticated;

-- reclaim_workout_log: the client takes their in-progress log back on the phone, when workout_log_logger says
-- canReclaim. Like hand back, the revision jumps by 1000, so the phone's own older copy (edits queued before the
-- coach took over) is refused as stale and the phone adopts the server copy, with the coach's sets, instead of
-- overwriting it. Returns { revision, status }; the phone then carries on from the server copy.
create function public.reclaim_workout_log(p_log_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_log public.workout_logs%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to log a workout.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('save_workout_log:' || p_log_id::text, 0));
  select * into v_log from public.workout_logs l where l.id = p_log_id for update;
  if not found or v_log.client_id <> v_uid then
    raise exception 'This workout belongs to someone else.' using errcode = '42501';
  end if;
  if not public.is_client_in(v_log.workspace_id, v_uid) then
    raise exception 'Only a current client of this coach can save workouts.'
      using errcode = '42501', hint = 'not_a_client';
  end if;
  if v_log.status <> 'in_progress' then
    raise exception 'This workout is not in progress any more.' using errcode = '23514';
  end if;
  if coalesce(v_log.logged_by, v_uid) = v_uid then
    return jsonb_build_object('revision', v_log.revision, 'status', v_log.status);
  end if;
  if v_log.last_activity_at >= now() - private.reclaim_after() and exists (select 1 from public.workspace_members m
      where m.workspace_id = v_log.workspace_id and m.user_id = v_log.logged_by and m.role in ('owner', 'staff')) then
    raise exception 'Your coach is still logging this workout.' using errcode = '55000';
  end if;
  update public.workout_logs l set logged_by = v_uid, revision = l.revision + 1000, last_activity_at = now()
  where l.id = p_log_id;
  return jsonb_build_object('revision', v_log.revision + 1000, 'status', v_log.status);
end;
$$;

revoke execute on function public.reclaim_workout_log(uuid) from public, anon, service_role;
grant execute on function public.reclaim_workout_log(uuid) to authenticated;

-- coach_last_results: last_results (20261105000800) for one client, read by their coach ("Last time: 135 × 8"
-- on the coach's logging screen). Security invoker: RLS lets a coach read only their own workspace's logs, so
-- another workspace's coach, or a client asking about someone else, gets no rows.
create function public.coach_last_results(p_client_id uuid, p_exercise_ids uuid[])
returns table (exercise_id uuid, finished_at timestamptz, set_type public.set_type, actual_reps smallint,
  actual_weight_kg numeric, actual_duration_s integer, actual_distance_m numeric, "position" smallint)
language sql stable security invoker set search_path = '' as $$
  with latest as (
    select distinct on (le.exercise_id) le.exercise_id, l.id as log_id, l.finished_at
    from public.log_exercises le
    join public.workout_logs l on l.id = le.log_id
    where le.exercise_id = any (p_exercise_ids)
      and le.client_id = p_client_id
      and l.client_id = p_client_id
      and l.status = 'completed'
      and exists (select 1 from public.log_sets s where s.log_exercise_id = le.id and s.completed_at is not null)
    order by le.exercise_id, l.finished_at desc, l.id
  )
  select latest.exercise_id, latest.finished_at, s.set_type, s.actual_reps, s.actual_weight_kg,
    s.actual_duration_s, s.actual_distance_m, s.position
  from latest
  join public.log_exercises le on le.log_id = latest.log_id and le.exercise_id = latest.exercise_id
  join public.log_blocks b on b.id = le.block_id
  join public.log_sets s on s.log_exercise_id = le.id and s.completed_at is not null
  order by latest.exercise_id, b.position, le.position, s.position;
$$;

revoke execute on function public.coach_last_results(uuid, uuid[]) from public, anon;
grant execute on function public.coach_last_results(uuid, uuid[]) to authenticated;
