-- Workout log functions (phase 3a): the phone saves a whole log document, a coach corrects typos in a
-- finished log, and "Last time: 135 × 8" reads the client's previous results.
--
-- Defence in depth first: owner and parent columns of the log tables never change after insert. The insert
-- trigger (inherit_log_owner) copies them from the parent; this trigger refuses any later change to them,
-- whoever writes (definer functions, service_role, postgres).

-- tg_argv lists the columns to protect. logged_by may only become null (its account was deleted: on delete set null).
create function public.refuse_owner_change() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_col text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  foreach v_col in array tg_argv loop
    if (v_new -> v_col) is distinct from (v_old -> v_col)
       and not (v_col = 'logged_by' and v_new -> v_col = 'null'::jsonb) then
      raise exception 'Column % of % cannot be changed.', v_col, tg_table_name using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.refuse_owner_change() from public, anon, authenticated;

create trigger workout_logs_refuse_owner_change before update on public.workout_logs
  for each row execute function public.refuse_owner_change('workspace_id', 'client_id', 'logged_by');
create trigger log_blocks_refuse_owner_change before update on public.log_blocks
  for each row execute function public.refuse_owner_change('log_id', 'workspace_id', 'client_id');
create trigger log_exercises_refuse_owner_change before update on public.log_exercises
  for each row execute function public.refuse_owner_change('block_id', 'log_id', 'workspace_id', 'client_id');
create trigger log_sets_refuse_owner_change before update on public.log_sets
  for each row execute function public.refuse_owner_change('log_exercise_id', 'log_id', 'workspace_id', 'client_id');
create trigger workout_log_comments_refuse_owner_change before update on public.workout_log_comments
  for each row execute function public.refuse_owner_change('log_id', 'workspace_id', 'client_id');

-- The same set rules as workout_sets: a drop has no rest timer, and only drops can be "to failure".
alter table public.log_sets
  add constraint log_sets_drop_no_rest check (set_type <> 'drop' or coalesce(rest_seconds, 0) = 0),
  add constraint log_sets_failure_only_drop check (not to_failure or set_type = 'drop');

-- save_workout_log: the client's phone uploads its whole WorkoutLogDoc (packages/shared/src/logs/schema.ts).
--
-- Security definer, because clients have no write privileges on the log tables. So it checks everything itself:
--   * the caller is the log's client (a new log becomes theirs; an existing one must already be theirs);
--   * the caller is a current client of the log's workspace (taken from the planned instance, or their only
--     client membership for an unplanned log);
--   * a planned instance, if it still exists, is the caller's own. A plan deleted since the log started is not
--     an error: the log is saved unlinked (workout_id null), so a retry after the coach deleted it still saves;
--   * every block, exercise and set id in the doc is new or already belongs to this log (no hijacking another
--     log's rows by id), and every exercise is usable in the workspace.
--
-- Sync semantics (global-constraints "SYNC SEMANTICS"). It returns { applied, revision, status }.
--   * A new log may arrive as in_progress, completed (>= 1 completed set) or discarded, with revision >= 1,
--     so a workout started and finished with no signal still saves.
--   * revision is the phone's counter only; server actions (auto-finish, coach correction) never change it.
--     A change applies only when doc.revision > stored revision.
--   * The client may change a log while it is in_progress, or while it is completed/discarded with
--     auto_finished, not corrected, and within 24 h (from finished_at, or last_activity_at when discarded):
--     the phone's data wins over an automatic finish. Manually finished or corrected logs are locked.
--   * A refused change (stale or locked) is not an error: nothing changes and applied=false comes back with
--     the stored revision and status, and the phone adopts the server's doc. Errors are for malformed docs
--     (23514) and authorization (42501).
--   * auto_finished follows the doc only on an in_progress -> completed/discarded change (or an insert as
--     completed/discarded); otherwise the stored value is kept, so a reopen does not erase it.
--
-- Rows are matched by id; positions are 0-based doc indexes; this log's rows that the doc no longer has are
-- deleted. A row that moved to another parent within the log is deleted and re-inserted, because parent
-- columns never change (refuse_owner_change).
create function public.save_workout_log(p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_log_id uuid := (p_doc ->> 'id')::uuid;
  v_revision integer := (p_doc ->> 'revision')::integer;
  v_status public.log_status := (p_doc ->> 'status')::public.log_status;
  v_doc_workout_id uuid := (p_doc ->> 'workoutId')::uuid;
  v_blocks jsonb := coalesce(p_doc -> 'blocks', '[]'::jsonb);
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
    if coalesce(cardinality(v_workspaces), 0) <> 1 then
      raise exception 'You need exactly one coach to log a workout without a plan.' using errcode = '42501';
    end if;
    v_workspace_id := v_workspaces[1];
  end if;

  if not public.is_client_in(v_workspace_id, v_uid) then
    raise exception 'Only a current client of this coach can save workouts.' using errcode = '42501';
  end if;

  if v_revision < 1 then
    raise exception 'Revision must be at least 1.' using errcode = '23514';
  end if;

  -- Stale, repeated or locked: keep the server copy and tell the phone to adopt it.
  if v_exists and (
    v_revision <= v_log.revision
    or not (
      v_log.status = 'in_progress'
      or (v_log.auto_finished and v_log.corrected_at is null
          and now() - case v_log.status when 'completed' then v_log.finished_at else v_log.last_activity_at end
            < interval '24 hours')
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
  if (not v_exists or v_log.status = 'in_progress') and v_status <> 'in_progress' then
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
      last_activity_at = coalesce((p_doc ->> 'lastActivityAt')::timestamptz, now()),
      auto_finished = v_auto_finished,
      revision = v_revision,
      notes = p_doc ->> 'notes'
    where l.id = v_log_id;
  else
    insert into public.workout_logs (id, workspace_id, client_id, workout_id, name, status, started_at, finished_at,
      last_activity_at, auto_finished, logged_by, revision, notes)
    values (v_log_id, v_workspace_id, v_uid, v_workout_id, btrim(p_doc ->> 'name'), v_status,
      coalesce((p_doc ->> 'startedAt')::timestamptz, now()), v_finished_at,
      coalesce((p_doc ->> 'lastActivityAt')::timestamptz, now()),
      v_auto_finished, v_uid, v_revision, p_doc ->> 'notes');
  end if;

  -- The tree. Owner columns come from inherit_log_owner; each update is guarded to rows of this log.
  for v_block, v_block_pos in select value, ordinality - 1 from jsonb_array_elements(v_blocks) with ordinality loop
    v_block_id := (v_block ->> 'id')::uuid;

    insert into public.log_blocks (id, log_id, position, kind)
    values (v_block_id, v_log_id, v_block_pos, (v_block ->> 'kind')::public.block_kind)
    on conflict (id) do update set position = excluded.position, kind = excluded.kind
      where public.log_blocks.log_id = excluded.log_id
        and (public.log_blocks.position, public.log_blocks.kind) is distinct from (excluded.position, excluded.kind);
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

revoke execute on function public.save_workout_log(jsonb) from public, anon, service_role;
grant execute on function public.save_workout_log(jsonb) to authenticated;

-- correct_workout_log: a coach fixes typos in a finished log's actuals. p_sets is an array of
-- { id, actualReps, actualWeightKg, actualDurationS, actualDistanceM }; a key left out keeps its value.
-- It returns the number of sets updated. It never changes revision (the phone's counter); corrected_at locks
-- the log for the client instead, so the phone's next save returns applied=false and it adopts this doc.
create function public.correct_workout_log(p_log_id uuid, p_sets jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_log public.workout_logs%rowtype;
  v_set jsonb;
  v_set_id uuid;
  v_count integer := 0;
begin
  select * into v_log from public.workout_logs l where l.id = p_log_id for update;
  if not found or not public.is_coach_of(v_log.workspace_id) then
    raise exception 'Only a coach of this workspace can correct a workout.' using errcode = '42501';
  end if;
  if v_log.status <> 'completed' then
    raise exception 'Only finished workouts can be corrected.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_sets) is distinct from 'array' or jsonb_array_length(p_sets) = 0 then
    raise exception 'Nothing to correct.' using errcode = '23514';
  end if;

  for v_set in select value from jsonb_array_elements(p_sets) loop
    v_set_id := (v_set ->> 'id')::uuid;
    update public.log_sets s set
      actual_reps = case when v_set ? 'actualReps' then (v_set ->> 'actualReps')::smallint else s.actual_reps end,
      actual_weight_kg = case when v_set ? 'actualWeightKg' then (v_set ->> 'actualWeightKg')::numeric
        else s.actual_weight_kg end,
      actual_duration_s = case when v_set ? 'actualDurationS' then (v_set ->> 'actualDurationS')::integer
        else s.actual_duration_s end,
      actual_distance_m = case when v_set ? 'actualDistanceM' then (v_set ->> 'actualDistanceM')::numeric
        else s.actual_distance_m end
    where s.id = v_set_id and s.log_id = p_log_id;
    if not found then
      raise exception 'Row % belongs to another log.', v_set_id using errcode = '23514';
    end if;
    v_count := v_count + 1;
  end loop;

  update public.workout_logs l set corrected_at = now(), corrected_by = auth.uid() where l.id = p_log_id;
  return v_count;
end;
$$;

revoke execute on function public.correct_workout_log(uuid, jsonb) from public, anon, service_role;
grant execute on function public.correct_workout_log(uuid, jsonb) to authenticated;

-- last_results: for each exercise, the completed sets from the caller's most recent finished log in which
-- that exercise has at least one completed set ("Last time: 135 × 8"). Security invoker: RLS limits it to
-- the caller's logs in workspaces where they are still a client.
create function public.last_results(p_exercise_ids uuid[])
returns table (exercise_id uuid, finished_at timestamptz, set_type public.set_type, actual_reps smallint,
  actual_weight_kg numeric, actual_duration_s integer, actual_distance_m numeric, "position" smallint)
language sql stable security invoker set search_path = '' as $$
  with latest as (
    select distinct on (le.exercise_id) le.exercise_id, l.id as log_id, l.finished_at
    from public.log_exercises le
    join public.workout_logs l on l.id = le.log_id
    where le.exercise_id = any (p_exercise_ids)
      and l.client_id = (select auth.uid())
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

revoke execute on function public.last_results(uuid[]) from public, anon;
grant execute on function public.last_results(uuid[]) to authenticated;
