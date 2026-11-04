-- Exercise library: built-in exercises (free-exercise-db, workspace_id null) and
-- per-workspace custom exercises, plus per-workspace overrides (pinned YouTube video, notes).

create extension if not exists pg_trgm with schema extensions;

create type public.tracking_type as enum ('weight_reps', 'reps', 'time', 'distance');

-- Pinned videos are YouTube links only (no uploads). Apps store the https form.
create domain public.youtube_url as text
  check (value ~* '^https://(www\.|m\.)?(youtube\.com|youtu\.be)/');

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces on delete cascade,
  source text not null check (source in ('builtin', 'custom')),
  external_id text unique,
  name text not null,
  tracking_type public.tracking_type not null,
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  equipment text,
  category text,
  instructions text[] not null default '{}',
  image_paths text[] not null default '{}',
  youtube_url public.youtube_url,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz default now(),
  check ((source = 'builtin') = (workspace_id is null))
);

create index exercises_name_trgm_idx on public.exercises
  using gin (name extensions.gin_trgm_ops);
create index exercises_workspace_id_idx on public.exercises (workspace_id);

create table public.exercise_overrides (
  workspace_id uuid not null references public.workspaces on delete cascade,
  exercise_id uuid not null references public.exercises on delete cascade,
  youtube_url public.youtube_url,
  coach_notes text,
  updated_at timestamptz default now(),
  primary key (workspace_id, exercise_id)
);

create index exercise_overrides_exercise_id_idx on public.exercise_overrides (exercise_id);

create function public.touch_exercise_override() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger exercise_overrides_touch
  before insert or update on public.exercise_overrides
  for each row execute function public.touch_exercise_override();

-- Privileges: nothing for anon. Built-ins are written only by the service role (import script).
-- Coaches cannot set or change source, workspace_id (after insert), external_id or created_by.
revoke all on table public.exercises, public.exercise_overrides from anon, authenticated;
grant select on public.exercises, public.exercise_overrides to authenticated;
grant insert (workspace_id, source, name, tracking_type, primary_muscles, secondary_muscles,
  equipment, category, instructions, image_paths, youtube_url)
  on public.exercises to authenticated;
grant update (name, tracking_type, primary_muscles, secondary_muscles, equipment, category,
  instructions, image_paths, youtube_url)
  on public.exercises to authenticated;
grant delete on public.exercises to authenticated;
grant insert (workspace_id, exercise_id, youtube_url, coach_notes) on public.exercise_overrides to authenticated;
grant update (youtube_url, coach_notes) on public.exercise_overrides to authenticated;
grant delete on public.exercise_overrides to authenticated;

alter table public.exercises enable row level security;
alter table public.exercise_overrides enable row level security;

create policy exercises_select on public.exercises for select to authenticated
  using (source = 'builtin' or public.is_member_of(workspace_id));
create policy exercises_insert on public.exercises for insert to authenticated
  with check (source = 'custom' and public.is_coach_of(workspace_id));
create policy exercises_update on public.exercises for update to authenticated
  using (source = 'custom' and public.is_coach_of(workspace_id))
  with check (source = 'custom' and public.is_coach_of(workspace_id));
create policy exercises_delete on public.exercises for delete to authenticated
  using (source = 'custom' and public.is_coach_of(workspace_id));

create policy exercise_overrides_select on public.exercise_overrides for select to authenticated
  using (public.is_member_of(workspace_id));
-- An override may target a built-in or this workspace's own custom exercise only.
create policy exercise_overrides_insert on public.exercise_overrides for insert to authenticated
  with check (
    public.is_coach_of(workspace_id)
    and exists (
      select 1 from public.exercises e
      where e.id = exercise_id and (e.workspace_id is null or e.workspace_id = exercise_overrides.workspace_id)
    )
  );
create policy exercise_overrides_update on public.exercise_overrides for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id));
create policy exercise_overrides_delete on public.exercise_overrides for delete to authenticated
  using (public.is_coach_of(workspace_id));

-- Public-read image bucket. No policies on storage.objects for writes: only the service role writes.
insert into storage.buckets (id, name, public)
values ('exercise-images', 'exercise-images', true)
on conflict do nothing;
