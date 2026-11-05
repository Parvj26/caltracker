-- Workouts (phase 2). One table holds both kinds of workout:
--   - library workouts: client_id and scheduled_on are null, only the coaches of the workspace see them;
--   - client instances: a copy on a client's calendar (client_id + scheduled_on), editable only by coaches.
-- Each workout has ordered blocks (straight or superset), each block ordered exercises, each exercise ordered sets.
-- workspace_id (and client_id) are copied onto every child row for RLS and offline sync; a trigger fills them
-- from the parent so the API can never forge them. Clients write nothing in phase 2.

create type public.set_type as enum ('normal', 'warmup', 'drop');
create type public.block_kind as enum ('straight', 'superset');

-- Generic updated_at maintenance, attached before update on every table created in this phase.
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- True when uid is a current client of ws. Answers only for the user themselves or a coach of ws,
-- so nobody can probe another workspace's client list.
create function public.is_client_in(ws uuid, uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (uid = (select auth.uid()) or public.is_coach_of(ws))
    and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = ws and m.user_id = uid and m.role = 'client'
    );
$$;

-- True when ex is a built-in exercise or a custom exercise of ws. Answers only for members of ws.
create function public.exercise_usable_in(ex uuid, ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_member_of(ws)
    and exists (
      select 1 from public.exercises e
      where e.id = ex and (e.workspace_id is null or e.workspace_id = ws)
    );
$$;

revoke execute on function public.is_client_in(uuid, uuid), public.exercise_usable_in(uuid, uuid) from public, anon;
grant execute on function public.is_client_in(uuid, uuid), public.exercise_usable_in(uuid, uuid) to authenticated;

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid references auth.users on delete cascade,
  scheduled_on date,
  assignment_id uuid, -- foreign key added with program assignments (Task 13)
  source_workout_id uuid references public.workouts on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  notes text check (char_length(notes) <= 2000),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((client_id is null) = (scheduled_on is null))
);

create index workouts_library_idx on public.workouts (workspace_id) where client_id is null;
create index workouts_client_calendar_idx on public.workouts (client_id, scheduled_on);
create index workouts_source_workout_id_idx on public.workouts (source_workout_id);

create table public.workout_blocks (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts on delete cascade,
  workspace_id uuid not null,
  client_id uuid,
  position smallint not null check (position >= 0),
  kind public.block_kind not null default 'straight',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workout_id, position) deferrable initially deferred
);

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.workout_blocks on delete cascade,
  workout_id uuid not null,
  workspace_id uuid not null,
  client_id uuid,
  position smallint not null check (position >= 0),
  -- A coach cannot delete a custom exercise that a workout still uses (the app explains why).
  exercise_id uuid not null references public.exercises on delete restrict,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (block_id, position) deferrable initially deferred
);

create index workout_exercises_workout_id_idx on public.workout_exercises (workout_id);
create index workout_exercises_exercise_id_idx on public.workout_exercises (exercise_id);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises on delete cascade,
  workout_id uuid not null,
  workspace_id uuid not null,
  client_id uuid,
  position smallint not null check (position >= 0),
  set_type public.set_type not null default 'normal',
  target_reps_min smallint check (target_reps_min between 1 and 1000),
  target_reps_max smallint check (target_reps_max between 1 and 1000),
  target_weight_kg numeric(7,3) check (target_weight_kg between 0 and 1000),
  target_duration_s integer check (target_duration_s between 1 and 86400),
  target_distance_m numeric(9,2) check (target_distance_m > 0 and target_distance_m <= 1000000),
  to_failure boolean not null default false,
  rest_seconds smallint not null default 0 check (rest_seconds between 0 and 3600),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_reps_min <= target_reps_max),
  check (set_type <> 'drop' or rest_seconds = 0),
  check (not to_failure or set_type = 'drop'),
  unique (workout_exercise_id, position) deferrable initially deferred
);

create index workout_sets_workout_id_idx on public.workout_sets (workout_id);

-- Copy workout_id/workspace_id/client_id from the parent row, whatever the insert said.
-- Definer so it can read the parent regardless of RLS; RLS then checks the copied workspace.
create function public.inherit_workout_owner() returns trigger
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
  elsif tg_table_name = 'workout_sets' then
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

create trigger workout_blocks_inherit_owner before insert on public.workout_blocks
  for each row execute function public.inherit_workout_owner();
create trigger workout_exercises_inherit_owner before insert on public.workout_exercises
  for each row execute function public.inherit_workout_owner();
create trigger workout_sets_inherit_owner before insert on public.workout_sets
  for each row execute function public.inherit_workout_owner();

create trigger workouts_touch_updated_at before update on public.workouts
  for each row execute function public.touch_updated_at();
create trigger workout_blocks_touch_updated_at before update on public.workout_blocks
  for each row execute function public.touch_updated_at();
create trigger workout_exercises_touch_updated_at before update on public.workout_exercises
  for each row execute function public.touch_updated_at();
create trigger workout_sets_touch_updated_at before update on public.workout_sets
  for each row execute function public.touch_updated_at();

-- Deleting a workspace cascades to both its exercises and its workouts, in no guaranteed order, and the
-- restrict above would refuse if the exercises went first. Delete the workouts (and their children) first.
create function public.delete_workspace_workouts() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from public.workouts w where w.workspace_id = old.id;
  return old;
end;
$$;
revoke execute on function public.delete_workspace_workouts() from public, anon, authenticated;

create trigger workspaces_delete_workouts before delete on public.workspaces
  for each row execute function public.delete_workspace_workouts();

-- Privileges: nothing for anon. Owner columns (workspace_id, client_id, parent links) are never updatable;
-- on child tables they are not even insertable (the trigger fills them).
revoke all on table public.workouts, public.workout_blocks, public.workout_exercises, public.workout_sets
  from anon, authenticated, service_role;
grant select on public.workouts, public.workout_blocks, public.workout_exercises, public.workout_sets
  to authenticated;

grant insert (id, workspace_id, client_id, scheduled_on, name, notes) on public.workouts to authenticated;
grant update (name, notes, scheduled_on) on public.workouts to authenticated;

grant insert (id, workout_id, position, kind) on public.workout_blocks to authenticated;
grant update (position, kind) on public.workout_blocks to authenticated;

grant insert (id, block_id, position, exercise_id, note) on public.workout_exercises to authenticated;
grant update (position, exercise_id, note) on public.workout_exercises to authenticated;

grant insert (id, workout_exercise_id, position, set_type, target_reps_min, target_reps_max, target_weight_kg,
  target_duration_s, target_distance_m, to_failure, rest_seconds, note) on public.workout_sets to authenticated;
grant update (position, set_type, target_reps_min, target_reps_max, target_weight_kg,
  target_duration_s, target_distance_m, to_failure, rest_seconds, note) on public.workout_sets to authenticated;

grant delete on public.workouts, public.workout_blocks, public.workout_exercises, public.workout_sets
  to authenticated;

grant select, insert, update, delete
  on public.workouts, public.workout_blocks, public.workout_exercises, public.workout_sets to service_role;

-- RLS. Coaches see everything in their workspace (including removed clients' history);
-- a client sees only their own instances, and only while still a client of that workspace.
alter table public.workouts enable row level security;
alter table public.workout_blocks enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;

create policy workouts_select on public.workouts for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy workouts_insert on public.workouts for insert to authenticated
  with check (public.is_coach_of(workspace_id)
    and (client_id is null or public.is_client_in(workspace_id, client_id)));
create policy workouts_update on public.workouts for update to authenticated
  using (public.is_coach_of(workspace_id)) with check (public.is_coach_of(workspace_id));
create policy workouts_delete on public.workouts for delete to authenticated
  using (public.is_coach_of(workspace_id));

create policy workout_blocks_select on public.workout_blocks for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy workout_blocks_insert on public.workout_blocks for insert to authenticated
  with check (public.is_coach_of(workspace_id));
create policy workout_blocks_update on public.workout_blocks for update to authenticated
  using (public.is_coach_of(workspace_id)) with check (public.is_coach_of(workspace_id));
create policy workout_blocks_delete on public.workout_blocks for delete to authenticated
  using (public.is_coach_of(workspace_id));

create policy workout_exercises_select on public.workout_exercises for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy workout_exercises_insert on public.workout_exercises for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.exercise_usable_in(exercise_id, workspace_id));
create policy workout_exercises_update on public.workout_exercises for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id) and public.exercise_usable_in(exercise_id, workspace_id));
create policy workout_exercises_delete on public.workout_exercises for delete to authenticated
  using (public.is_coach_of(workspace_id));

create policy workout_sets_select on public.workout_sets for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy workout_sets_insert on public.workout_sets for insert to authenticated
  with check (public.is_coach_of(workspace_id));
create policy workout_sets_update on public.workout_sets for update to authenticated
  using (public.is_coach_of(workspace_id)) with check (public.is_coach_of(workspace_id));
create policy workout_sets_delete on public.workout_sets for delete to authenticated
  using (public.is_coach_of(workspace_id));
