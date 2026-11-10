-- F (failure) sets: the workout builder's set types are now one letter, W warm-up, N normal, F failure, D drop set.
-- F is stored with the existing columns as set_type 'normal' + to_failure = true, so nothing changes shape. Until
-- now only drops could be "to failure"; this lets any set but a warm-up be, in plans and in logs alike (a log copies
-- its plan's sets). Older drops to failure stay valid.
alter table public.workout_sets
  drop constraint workout_sets_check2,
  add constraint workout_sets_failure_not_warmup check (not to_failure or set_type <> 'warmup');

alter table public.log_sets
  drop constraint log_sets_failure_only_drop,
  add constraint log_sets_failure_not_warmup check (not to_failure or set_type <> 'warmup');

-- private.save_workout_log_as (from 20261107003000_coach_logging_polish.sql), unchanged except one rule: a set may
-- be "to failure" unless it is a warm-up (was: only drops). The phone and the coach's session logging both save
-- through it, so a client can log the F sets of their plan.
create or replace function private.save_workout_log_as(p_doc jsonb, p_client uuid, p_logger uuid) returns jsonb
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
  v_final_save boolean := false;
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
    -- The final save of whoever logged it just before a take over (sets ticked on the phone, not yet uploaded):
    -- applied once, while the log is still in progress and the new holder has saved nothing since the take over
    -- (their first save clears taken_over_from). Nothing the new holder did can be lost, and the answer still says
    -- loggedByOther, so the phone then shows the coach's copy. A finish or discard is not a final save.
    if not (coalesce(v_log.taken_over_from = p_logger, false) and v_log.status = 'in_progress' and v_status = 'in_progress'
        and v_revision > v_log.revision) then
      return jsonb_build_object('applied', false, 'revision', v_log.revision, 'status', v_log.status,
        'loggedByOther', true);
    end if;
    v_final_save := true;
    -- Stored 1000 above the take over's revision (as hand back and reclaim do): the coach's page counts its own
    -- revisions up from the take over's, so without the jump a coach save could rank above this one and replace the
    -- whole log, dropping the client's sets. With it, the coach's next save is stale: the page reloads this copy and
    -- re-applies its own edits on top.
    v_revision := greatest(v_revision, v_log.revision + 1000);
  end if;

  -- A coach starts a session only for today's workout or a missed one, never a later day's (the client's today,
  -- the same day Live Sync uses: public.client_today).
  if not v_exists and p_logger <> v_uid and v_workout_id is not null and v_plan.scheduled_on is not null
      and v_plan.scheduled_on > public.client_today(v_uid, v_workspace_id) then
    raise exception 'This workout is on a later day. Log it on the day.' using errcode = '22023', hint = 'future_workout';
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
        if coalesce((v_set -> 'target' ->> 'toFailure')::boolean, false) and v_set ->> 'setType' = 'warmup' then
          raise exception 'A warm-up can''t be "to failure".' using errcode = '23514';
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
      -- A final save keeps the take over's time: the coach's 20 minutes count from then.
      last_activity_at = case when v_final_save then v_log.last_activity_at when p_logger <> v_uid then now()
        else least(coalesce((p_doc ->> 'lastActivityAt')::timestamptz, now()), now()) end,
      taken_over_from = null,
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

  if v_final_save then
    return jsonb_build_object('applied', true, 'revision', v_revision, 'status', v_status, 'loggedByOther', true);
  end if;
  return jsonb_build_object('applied', true, 'revision', v_revision, 'status', v_status);
end;
$$;

revoke execute on function private.save_workout_log_as(jsonb, uuid, uuid) from public, anon, authenticated, service_role;
