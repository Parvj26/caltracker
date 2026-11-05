-- Programs (phase 2). A program is a named, multi-week arrangement of library workouts. Coach-only data:
-- clients never see it (they get copies on their calendar when a program is assigned, Task 13).
-- Slot (week w, day d) means start_date + (w - 1) * 7 + (d - 1): days count from the start date, not Mon-Sun.

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(description) <= 2000),
  weeks smallint not null default 4 check (weeks between 1 and 52),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index programs_workspace_id_idx on public.programs (workspace_id);

create table public.program_workouts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs on delete cascade,
  workspace_id uuid not null, -- copied from the program by a trigger
  week smallint not null check (week between 1 and 52),
  day smallint not null check (day between 1 and 7),
  position smallint not null default 0,
  -- Deleting a library workout removes its slots; the program stays.
  workout_id uuid not null references public.workouts on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index program_workouts_slot_idx on public.program_workouts (program_id, week, day, position);
create index program_workouts_workout_id_idx on public.program_workouts (workout_id);

-- True when w is a library workout (no client) of ws. Answers only for coaches of ws.
create function public.is_library_workout_of(w uuid, ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_coach_of(ws)
    and exists (
      select 1 from public.workouts x
      where x.id = w and x.client_id is null and x.workspace_id = ws
    );
$$;
revoke execute on function public.is_library_workout_of(uuid, uuid) from public, anon;
grant execute on function public.is_library_workout_of(uuid, uuid) to authenticated;

-- Copy workspace_id from the program, whatever the insert said (definer: reads regardless of RLS).
create function public.inherit_program_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
begin
  select p.workspace_id into v_workspace_id from public.programs p where p.id = new.program_id;
  if not found then
    raise exception 'Program not found for program_workouts insert' using errcode = '23503';
  end if;
  new.workspace_id := v_workspace_id;
  return new;
end;
$$;
revoke execute on function public.inherit_program_owner() from public, anon, authenticated;

create trigger program_workouts_inherit_owner before insert on public.program_workouts
  for each row execute function public.inherit_program_owner();
create trigger programs_touch_updated_at before update on public.programs
  for each row execute function public.touch_updated_at();
create trigger program_workouts_touch_updated_at before update on public.program_workouts
  for each row execute function public.touch_updated_at();

-- Change a program's length. Slots beyond the new length are deleted in the same transaction (one function
-- call), and the number removed is returned so the app can warn before and report after.
-- Invoker: RLS decides which programs and slots the caller may touch.
create function public.set_program_weeks(p_program_id uuid, p_weeks smallint) returns int
language plpgsql set search_path = '' as $$
declare
  v_removed int;
begin
  delete from public.program_workouts pw where pw.program_id = p_program_id and pw.week > p_weeks;
  get diagnostics v_removed = row_count;
  update public.programs p set weeks = p_weeks where p.id = p_program_id;
  return v_removed;
end;
$$;
revoke execute on function public.set_program_weeks(uuid, smallint) from public, anon;
grant execute on function public.set_program_weeks(uuid, smallint) to authenticated;

-- Privileges: nothing for anon; owner and parent columns are never updatable.
revoke all on table public.programs, public.program_workouts from anon, authenticated, service_role;
grant select, delete on public.programs, public.program_workouts to authenticated;
grant insert (id, workspace_id, name, description, weeks) on public.programs to authenticated;
grant update (name, description, weeks) on public.programs to authenticated;
grant insert (id, program_id, week, day, position, workout_id) on public.program_workouts to authenticated;
grant update (week, day, position) on public.program_workouts to authenticated;
grant select, insert, update, delete on public.programs, public.program_workouts to service_role;

alter table public.programs enable row level security;
alter table public.program_workouts enable row level security;

create policy programs_select on public.programs for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy programs_insert on public.programs for insert to authenticated
  with check (public.is_coach_of(workspace_id));
create policy programs_update on public.programs for update to authenticated
  using (public.is_coach_of(workspace_id)) with check (public.is_coach_of(workspace_id));
create policy programs_delete on public.programs for delete to authenticated
  using (public.is_coach_of(workspace_id));

create policy program_workouts_select on public.program_workouts for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy program_workouts_insert on public.program_workouts for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.is_library_workout_of(workout_id, workspace_id));
create policy program_workouts_update on public.program_workouts for update to authenticated
  using (public.is_coach_of(workspace_id)) with check (public.is_coach_of(workspace_id));
create policy program_workouts_delete on public.program_workouts for delete to authenticated
  using (public.is_coach_of(workspace_id));
