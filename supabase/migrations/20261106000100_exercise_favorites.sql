-- Coach favourites (starred exercises) and "recently used" lists for the exercise picker.
-- Favourites are personal to a coach (not shared across the workspace). Recents are read through
-- security definer functions so they can scan workouts/logs, and always filter on the caller.

create table public.exercise_favorites (
  coach_id uuid not null default auth.uid() references auth.users on delete cascade,
  exercise_id uuid not null references public.exercises on delete cascade,
  created_at timestamptz default now(),
  primary key (coach_id, exercise_id)
);

create index exercise_favorites_exercise_id_idx on public.exercise_favorites (exercise_id);

-- True when the caller is an owner or staff member of any workspace.
create function public.is_coach_anywhere() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.user_id = (select auth.uid()) and m.role in ('owner', 'staff')
  );
$$;
revoke execute on function public.is_coach_anywhere() from public, anon;
grant execute on function public.is_coach_anywhere() to authenticated;

revoke all on table public.exercise_favorites from anon, authenticated;
grant select, delete on public.exercise_favorites to authenticated;
grant insert (exercise_id) on public.exercise_favorites to authenticated;

alter table public.exercise_favorites enable row level security;

create policy exercise_favorites_select on public.exercise_favorites for select to authenticated
  using (coach_id = (select auth.uid()) and public.is_coach_anywhere());
-- Only exercises the coach can see: built-ins or custom exercises of a workspace they belong to.
create policy exercise_favorites_insert on public.exercise_favorites for insert to authenticated
  with check (
    coach_id = (select auth.uid()) and public.is_coach_anywhere()
    and exists (select 1 from public.exercises e where e.id = exercise_id)
  );
create policy exercise_favorites_delete on public.exercise_favorites for delete to authenticated
  using (coach_id = (select auth.uid()) and public.is_coach_anywhere());

-- Distinct exercises the caller used in workouts they created, in workspaces where they are a coach.
create function public.recent_exercises_for_coach(p_limit int default 20)
returns table (exercise_id uuid, last_used timestamptz)
language sql stable security definer set search_path = '' as $$
  select we.exercise_id, max(w.created_at) as last_used
  from public.workouts w
  join public.workout_exercises we on we.workout_id = w.id
  where w.created_by = (select auth.uid())
    and public.is_coach_of(w.workspace_id)
  group by we.exercise_id
  order by last_used desc, we.exercise_id
  limit greatest(coalesce(p_limit, 20), 0);
$$;

-- Distinct exercises in the caller's own completed logs.
create function public.recent_exercises_for_client(p_limit int default 20)
returns table (exercise_id uuid, last_used timestamptz)
language sql stable security definer set search_path = '' as $$
  select le.exercise_id, max(l.finished_at) as last_used
  from public.workout_logs l
  join public.log_exercises le on le.log_id = l.id
  where l.client_id = (select auth.uid())
    and l.status = 'completed'
  group by le.exercise_id
  order by last_used desc, le.exercise_id
  limit greatest(coalesce(p_limit, 20), 0);
$$;

revoke execute on function public.recent_exercises_for_coach(int), public.recent_exercises_for_client(int)
  from public, anon;
grant execute on function public.recent_exercises_for_coach(int), public.recent_exercises_for_client(int)
  to authenticated;
