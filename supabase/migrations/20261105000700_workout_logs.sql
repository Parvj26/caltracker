-- Workout logs (phase 3a). What a client actually did, kept as a tree separate from the planned workout:
-- workout_logs -> log_blocks -> log_exercises -> log_sets, plus coach comments on a log.
-- The plan is never changed by logging, so planned vs. actual is always available, and a log needs no plan.
-- Owner columns (log_id, workspace_id, client_id) are copied onto every child row by a trigger, as for workouts.
-- Clients and coaches only read these tables; writes go through security definer functions (next migration),
-- except coach comments, which are written under RLS.

create type public.log_status as enum ('in_progress', 'completed', 'discarded');

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(), -- generated on the phone
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  -- The planned instance this log follows; null when unplanned or once the plan is deleted.
  workout_id uuid references public.workouts on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  status public.log_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_activity_at timestamptz not null default now(),
  auto_finished boolean not null default false,
  logged_by uuid default auth.uid() references auth.users on delete set null,
  revision integer not null default 0 check (revision >= 0),
  notes text check (char_length(notes) <= 2000),
  corrected_at timestamptz,
  corrected_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'completed' or finished_at is not null)
);

-- One in-progress workout per client at a time.
create unique index one_active_log_per_client on public.workout_logs (client_id) where status = 'in_progress';
create index workout_logs_feed_idx on public.workout_logs (workspace_id, finished_at desc) where status = 'completed';
create index workout_logs_client_idx on public.workout_logs (client_id, finished_at desc);
create index workout_logs_workout_id_idx on public.workout_logs (workout_id);

create table public.log_blocks (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.workout_logs on delete cascade,
  workspace_id uuid not null,
  client_id uuid not null,
  position smallint not null check (position >= 0),
  kind public.block_kind not null default 'straight',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (log_id, position) deferrable initially deferred
);

create table public.log_exercises (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.log_blocks on delete cascade,
  log_id uuid not null,
  workspace_id uuid not null,
  client_id uuid not null,
  position smallint not null check (position >= 0),
  -- A coach cannot delete a custom exercise that a log still uses.
  exercise_id uuid not null references public.exercises on delete restrict,
  -- Deliberately no foreign key: the coach may edit or delete the plan mid-session and an
  -- offline log must still save. It is only a hint for planned vs. actual.
  planned_workout_exercise_id uuid,
  swapped_from_exercise_id uuid references public.exercises on delete set null,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (block_id, position) deferrable initially deferred
);

create index log_exercises_log_id_idx on public.log_exercises (log_id);
create index log_exercises_exercise_id_idx on public.log_exercises (exercise_id);
create index log_exercises_swapped_from_idx on public.log_exercises (swapped_from_exercise_id);

create table public.log_sets (
  id uuid primary key default gen_random_uuid(),
  log_exercise_id uuid not null references public.log_exercises on delete cascade,
  log_id uuid not null,
  workspace_id uuid not null,
  client_id uuid not null,
  position smallint not null check (position >= 0),
  set_type public.set_type not null default 'normal',
  -- Snapshot of the planned target (same ranges as workout_sets).
  target_reps_min smallint check (target_reps_min between 1 and 1000),
  target_reps_max smallint check (target_reps_max between 1 and 1000),
  target_weight_kg numeric(7,3) check (target_weight_kg between 0 and 1000),
  target_duration_s integer check (target_duration_s between 1 and 86400),
  target_distance_m numeric(9,2) check (target_distance_m > 0 and target_distance_m <= 1000000),
  to_failure boolean not null default false,
  rest_seconds smallint check (rest_seconds between 0 and 3600),
  -- What was actually done.
  actual_reps smallint check (actual_reps between 0 and 1000),
  actual_weight_kg numeric(7,3) check (actual_weight_kg between 0 and 1000),
  actual_duration_s integer check (actual_duration_s between 0 and 86400),
  actual_distance_m numeric(9,2) check (actual_distance_m between 0 and 1000000),
  completed_at timestamptz, -- null = not done
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_reps_min <= target_reps_max),
  unique (log_exercise_id, position) deferrable initially deferred
);

create index log_sets_log_id_idx on public.log_sets (log_id);

create table public.workout_log_comments (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.workout_logs on delete cascade,
  workspace_id uuid not null,
  client_id uuid not null,
  -- Always the caller on insert (no column privilege); null only after the author's account is deleted.
  author_id uuid default auth.uid() references auth.users on delete set null,
  body text not null check (char_length(btrim(body)) >= 1 and char_length(body) <= 1000),
  created_at timestamptz not null default now()
);

create index workout_log_comments_log_idx on public.workout_log_comments (log_id, created_at);
create index workout_log_comments_author_idx on public.workout_log_comments (author_id);

-- Copy log_id/workspace_id/client_id from the parent row, whatever the insert said.
-- Definer so it can read the parent regardless of RLS; RLS then checks the copied workspace.
create function public.inherit_log_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_log_id uuid;
  v_workspace_id uuid;
  v_client_id uuid;
begin
  if tg_table_name in ('log_blocks', 'workout_log_comments') then
    select l.id, l.workspace_id, l.client_id into v_log_id, v_workspace_id, v_client_id
    from public.workout_logs l where l.id = new.log_id;
  elsif tg_table_name = 'log_exercises' then
    select b.log_id, b.workspace_id, b.client_id into v_log_id, v_workspace_id, v_client_id
    from public.log_blocks b where b.id = new.block_id;
  elsif tg_table_name = 'log_sets' then
    select le.log_id, le.workspace_id, le.client_id into v_log_id, v_workspace_id, v_client_id
    from public.log_exercises le where le.id = new.log_exercise_id;
  else
    raise exception 'inherit_log_owner() is not for table %', tg_table_name;
  end if;

  if not found then
    raise exception 'Parent row not found for % insert', tg_table_name using errcode = '23503';
  end if;

  new.log_id := v_log_id;
  new.workspace_id := v_workspace_id;
  new.client_id := v_client_id;
  return new;
end;
$$;
revoke execute on function public.inherit_log_owner() from public, anon, authenticated;

create trigger log_blocks_inherit_owner before insert on public.log_blocks
  for each row execute function public.inherit_log_owner();
create trigger log_exercises_inherit_owner before insert on public.log_exercises
  for each row execute function public.inherit_log_owner();
create trigger log_sets_inherit_owner before insert on public.log_sets
  for each row execute function public.inherit_log_owner();
create trigger workout_log_comments_inherit_owner before insert on public.workout_log_comments
  for each row execute function public.inherit_log_owner();

create trigger workout_logs_touch_updated_at before update on public.workout_logs
  for each row execute function public.touch_updated_at();
create trigger log_blocks_touch_updated_at before update on public.log_blocks
  for each row execute function public.touch_updated_at();
create trigger log_exercises_touch_updated_at before update on public.log_exercises
  for each row execute function public.touch_updated_at();
create trigger log_sets_touch_updated_at before update on public.log_sets
  for each row execute function public.touch_updated_at();

-- Deleting a workspace cascades to its exercises and its logs in no guaranteed order, and the restrict on
-- log_exercises.exercise_id would refuse if the exercises went first. Delete the logs, then the workouts, first.
create or replace function public.delete_workspace_workouts() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from public.workout_logs l where l.workspace_id = old.id;
  delete from public.workouts w where w.workspace_id = old.id;
  return old;
end;
$$;
revoke execute on function public.delete_workspace_workouts() from public, anon, authenticated;

-- Privileges: nothing for anon; authenticated reads the log tree and writes only comments (id, log_id, body).
revoke all on table public.workout_logs, public.log_blocks, public.log_exercises, public.log_sets,
  public.workout_log_comments from anon, authenticated, service_role;
grant select on public.workout_logs, public.log_blocks, public.log_exercises, public.log_sets,
  public.workout_log_comments to authenticated;
grant insert (id, log_id, body) on public.workout_log_comments to authenticated;
grant delete on public.workout_log_comments to authenticated;
grant select, insert, update, delete on public.workout_logs, public.log_blocks, public.log_exercises,
  public.log_sets, public.workout_log_comments to service_role;

-- RLS. Coaches see every log in their workspace (including removed clients' history);
-- a client sees only their own logs, and only while still a client of that workspace.
alter table public.workout_logs enable row level security;
alter table public.log_blocks enable row level security;
alter table public.log_exercises enable row level security;
alter table public.log_sets enable row level security;
alter table public.workout_log_comments enable row level security;

create policy workout_logs_select on public.workout_logs for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy log_blocks_select on public.log_blocks for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy log_exercises_select on public.log_exercises for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy log_sets_select on public.log_sets for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy workout_log_comments_select on public.workout_log_comments for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));

-- Coaches comment as themselves and delete only their own comments. There is no update.
create policy workout_log_comments_insert on public.workout_log_comments for insert to authenticated
  with check (public.is_coach_of(workspace_id) and author_id = (select auth.uid()));
create policy workout_log_comments_delete on public.workout_log_comments for delete to authenticated
  using (public.is_coach_of(workspace_id) and author_id = (select auth.uid()));
