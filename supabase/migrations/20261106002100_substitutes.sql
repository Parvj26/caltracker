-- Coach-added substitute exercises (spec: docs/superpowers/specs/2026-11-06-substitutes-design.md).
--
-- A planned exercise can have up to 3 substitutes, each its own library exercise with its own set targets. The
-- client does the planned exercise or one substitute. Not inside pick-one groups.
--
-- Plans: a new table, one row per substitute. Its sets are the doc's WorkoutSetDoc array in a jsonb column: they
-- are only ever read and written whole, by save_workout / copy_workout and the apps' tree select, and the shared
-- zod schema (WorkoutDoc) holds the per-set rules. Owner columns and RLS are those of the other workout tables.
--
-- Logs: the log exercise row and its sets are always the option actually done, so award_inputs,
-- recent_exercises_for_client, last_results, PRs and volume use the exercise actually done unchanged.
-- substitute_id (which option, null = planned) and substitute_options (a snapshot of every option's planned sets,
-- so the phone can still switch before the first done set) are two new columns on log_exercises. Like
-- picked_exercise_id they have no foreign key: an offline save never fails on them.

-- The set rules of WorkoutSetDoc / WorkoutDoc (packages/shared/src/workouts/schema.ts) for a substitute's jsonb sets,
-- so a row written any way (save_workout, copy_workout, a direct insert) is one the apps can read. The rules that
-- depend on the exercise's tracking type are not checked here (it can change later); the loaders drop those targets.
-- A UUID as zod's z.uuid() accepts it (RFC 9562: version 1-8 and variant 8/9/a/b, or the nil and max UUIDs), so the
-- database and packages/shared agree on what is valid.
create function public.uuid_text_ok(t text) returns boolean
language sql immutable set search_path = '' as $$
  select t ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
$$;

-- plpgsql, so each test runs only after the ones before it passed (a SQL AND may evaluate a cast first).
create function public.json_number_ok(x jsonb, lo numeric, hi numeric, whole boolean, lo_exclusive boolean default false)
returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  n numeric;
begin
  if x is null or x = 'null'::jsonb then return true; end if;
  if jsonb_typeof(x) <> 'number' then return false; end if;
  n := (x #>> '{}')::numeric;
  return (not whole or n = trunc(n)) and (case when lo_exclusive then n > lo else n >= lo end) and n <= hi;
end;
$$;

create function public.valid_substitute_set(v jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(v) is distinct from 'object' then return false; end if;
  if jsonb_typeof(v -> 'id') is distinct from 'string'
     or not public.uuid_text_ok(v ->> 'id') then
    return false;
  end if;
  if coalesce(v ->> 'setType', '') not in ('normal', 'warmup', 'drop') then return false; end if;
  if not (public.json_number_ok(v -> 'targetRepsMin', 1, 1000, true)
      and public.json_number_ok(v -> 'targetRepsMax', 1, 1000, true)
      and public.json_number_ok(v -> 'targetWeightKg', 0, 1000, false)
      and public.json_number_ok(v -> 'targetDurationS', 1, 86400, true)
      and public.json_number_ok(v -> 'targetDistanceM', 0, 1000000, false, true)) then
    return false;
  end if;
  if jsonb_typeof(v -> 'toFailure') is distinct from 'boolean' then return false; end if;
  if jsonb_typeof(v -> 'restSeconds') is distinct from 'number'
     or not public.json_number_ok(v -> 'restSeconds', 0, 3600, true) then
    return false;
  end if;
  if not (v -> 'note' is null or v -> 'note' = 'null'::jsonb
      or (jsonb_typeof(v -> 'note') = 'string' and char_length(v ->> 'note') <= 500)) then
    return false;
  end if;
  if jsonb_typeof(v -> 'targetRepsMin') = 'number' and jsonb_typeof(v -> 'targetRepsMax') = 'number'
     and (v ->> 'targetRepsMin')::numeric > (v ->> 'targetRepsMax')::numeric then
    return false;
  end if;
  if (v -> 'toFailure')::boolean and v ->> 'setType' <> 'drop' then return false; end if;
  -- A drop has no rest timer (as for workout_sets).
  if v ->> 'setType' = 'drop' and (v ->> 'restSeconds')::numeric <> 0 then return false; end if;
  return true;
end;
$$;

create function public.valid_substitute_sets(p_sets jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_sets) is distinct from 'array' or jsonb_array_length(p_sets) not between 1 and 20 then
    return false;
  end if;
  if p_sets -> 0 ->> 'setType' = 'drop' then return false; end if;
  return not exists (select 1 from jsonb_array_elements(p_sets) s where not public.valid_substitute_set(s.value));
end;
$$;

revoke execute on function public.uuid_text_ok(text), public.json_number_ok(jsonb, numeric, numeric, boolean, boolean),
  public.valid_substitute_set(jsonb), public.valid_substitute_sets(jsonb) from public, anon;
grant execute on function public.uuid_text_ok(text), public.json_number_ok(jsonb, numeric, numeric, boolean, boolean),
  public.valid_substitute_set(jsonb), public.valid_substitute_sets(jsonb) to authenticated, service_role;

create table public.workout_substitutes (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises on delete cascade,
  workout_id uuid not null,
  workspace_id uuid not null,
  client_id uuid,
  position smallint not null check (position between 0 and 2),
  -- As for workout_exercises: an exercise a workout still uses cannot be deleted.
  exercise_id uuid not null references public.exercises on delete restrict,
  note text check (char_length(note) <= 500),
  sets jsonb not null check (public.valid_substitute_sets(sets)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workout_exercise_id, position) deferrable initially deferred,
  unique (workout_exercise_id, exercise_id) deferrable initially deferred
);

create index workout_substitutes_workout_id_idx on public.workout_substitutes (workout_id);
create index workout_substitutes_exercise_id_idx on public.workout_substitutes (exercise_id);

-- inherit_workout_owner (from 20261105000100), changed only to also serve workout_substitutes.
create or replace function public.inherit_workout_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_workout_id uuid;
  v_workspace_id uuid;
  v_client_id uuid;
begin
  if tg_table_name = 'workout_blocks' then
    select w.id, w.workspace_id, w.client_id into v_workout_id, v_workspace_id, v_client_id
    from public.workouts w where w.id = new.workout_id;
  elsif tg_table_name = 'workout_exercises' then
    select b.workout_id, b.workspace_id, b.client_id into v_workout_id, v_workspace_id, v_client_id
    from public.workout_blocks b where b.id = new.block_id;
  elsif tg_table_name in ('workout_sets', 'workout_substitutes') then
    select we.workout_id, we.workspace_id, we.client_id into v_workout_id, v_workspace_id, v_client_id
    from public.workout_exercises we where we.id = new.workout_exercise_id;
  else
    raise exception 'inherit_workout_owner() is not for table %', tg_table_name;
  end if;

  if not found then
    raise exception 'Parent row not found for % insert', tg_table_name using errcode = '23503';
  end if;

  new.workout_id := v_workout_id;
  new.workspace_id := v_workspace_id;
  new.client_id := v_client_id;
  return new;
end;
$$;
revoke execute on function public.inherit_workout_owner() from public, anon, authenticated;

create trigger workout_substitutes_inherit_owner before insert on public.workout_substitutes
  for each row execute function public.inherit_workout_owner();
create trigger workout_substitutes_touch_updated_at before update on public.workout_substitutes
  for each row execute function public.touch_updated_at();

-- A substitute is never on a pick-one option and never the planned exercise itself, however it is written. Checked
-- at commit (constraint triggers, deferred), because save_workout changes the exercise and block rows before it
-- prunes the substitutes the doc no longer has. Fires on the substitute, and on the exercise / block it hangs from.
create function public.check_substitute_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.workout_substitutes ws
    join public.workout_exercises we on we.id = ws.workout_exercise_id
    join public.workout_blocks b on b.id = we.block_id
    where b.kind = 'choice' and case tg_table_name
      when 'workout_substitutes' then ws.id = new.id
      when 'workout_exercises' then we.id = new.id
      else b.id = new.id end
  ) then
    raise exception 'A pick-one group''s exercises can''t have substitutes.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.workout_substitutes ws
    join public.workout_exercises we on we.id = ws.workout_exercise_id
    where ws.exercise_id = we.exercise_id and case tg_table_name
      when 'workout_substitutes' then ws.id = new.id
      else we.id = new.id end
  ) then
    raise exception 'A substitute must be a different exercise.' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke execute on function public.check_substitute_rules() from public, anon, authenticated;

create constraint trigger workout_substitutes_rules after insert or update on public.workout_substitutes
  deferrable initially deferred for each row execute function public.check_substitute_rules();
create constraint trigger workout_exercises_substitute_rules after update of exercise_id on public.workout_exercises
  deferrable initially deferred for each row execute function public.check_substitute_rules();
create constraint trigger workout_blocks_substitute_rules after update of kind on public.workout_blocks
  deferrable initially deferred for each row execute function public.check_substitute_rules();

-- Privileges as for workout_exercises: owner and parent columns are not insertable or updatable.
revoke all on table public.workout_substitutes from anon, authenticated, service_role;
grant select, delete on public.workout_substitutes to authenticated;
grant insert (id, workout_exercise_id, position, exercise_id, note, sets) on public.workout_substitutes to authenticated;
grant update (position, exercise_id, note, sets) on public.workout_substitutes to authenticated;
grant select, insert, update, delete on public.workout_substitutes to service_role;

alter table public.workout_substitutes enable row level security;

create policy workout_substitutes_select on public.workout_substitutes for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy workout_substitutes_insert on public.workout_substitutes for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.exercise_usable_in(exercise_id, workspace_id));
create policy workout_substitutes_update on public.workout_substitutes for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id) and public.exercise_usable_in(exercise_id, workspace_id));
create policy workout_substitutes_delete on public.workout_substitutes for delete to authenticated
  using (public.is_coach_of(workspace_id));

-- Logs. Clients write logs only through save_workout_log (security definer), so there are no new grants.
alter table public.log_exercises
  add column substitute_id uuid,
  add column substitute_options jsonb not null default '[]'::jsonb,
  add constraint log_exercises_substitute_options_array
    check (jsonb_typeof(substitute_options) = 'array' and jsonb_array_length(substitute_options) <= 4);

-- save_workout (from 20261106001000), changed only to check, write and prune substitutes.
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

-- copy_workout (from 20261106001000), changed only to copy substitutes (their set ids are new too).
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

  -- Substitutes, with new ids for their sets too.
  insert into public.workout_substitutes (id, workout_exercise_id, position, exercise_id, note, sets)
  select gen_random_uuid(), em.new_id, ws.position, ws.exercise_id, ws.note,
    (select jsonb_agg(jsonb_set(x.value, '{id}', to_jsonb(gen_random_uuid())) order by x.ordinality)
       from jsonb_array_elements(ws.sets) with ordinality x)
  from unnest(v_old_exercises, v_new_exercises) as em(old_id, new_id)
  join public.workout_substitutes ws on ws.workout_exercise_id = em.old_id;

  insert into public.workout_sets (id, workout_exercise_id, position, set_type, target_reps_min, target_reps_max,
    target_weight_kg, target_duration_s, target_distance_m, to_failure, rest_seconds, note)
  select gen_random_uuid(), em.new_id, s.position, s.set_type, s.target_reps_min, s.target_reps_max,
    s.target_weight_kg, s.target_duration_s, s.target_distance_m, s.to_failure, s.rest_seconds, s.note
  from unnest(v_old_exercises, v_new_exercises) as em(old_id, new_id)
  join public.workout_sets s on s.workout_exercise_id = em.old_id;

  return v_id;
end;
$$;

-- save_workout_log (from 20261106001000), changed only to check and write substitute_id and substitute_options.
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
