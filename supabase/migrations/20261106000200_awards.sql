-- Stickers, personal records and streak stats (see docs/superpowers/specs/2026-11-05-stickers-prs-streaks-design.md).
-- Clients and coaches only read these tables. Every write comes from the award Edge Function with the service role.
-- All rows cascade from the client's account (auth.users) and from the workspace.
-- Every award row belongs to one workspace and is worked out from that workspace's logs only. A client who leaves a
-- coach and joins another starts fresh there: the new coach never sees what was earned with the old one, and the old
-- coach's rows stay as they were (keyed by workspace, never moved).

-- The client's own time zone decides which calendar day and week a workout counts for.
alter table public.profiles
  add column time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 64);
-- Clients may change their own time zone through the existing profiles_update_own policy.
grant update (time_zone) on public.profiles to authenticated;

-- One row per sticker a client owns.
create table public.sticker_awards (
  client_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  sticker_key text not null check (char_length(sticker_key) between 1 and 100),
  count integer not null default 1 check (count >= 1),
  shiny boolean not null default false,
  first_earned_at timestamptz not null default now(),
  last_earned_at timestamptz not null default now(),
  first_log_id uuid references public.workout_logs on delete set null,
  primary key (client_id, workspace_id, sticker_key)
);
create index sticker_awards_workspace_idx on public.sticker_awards (workspace_id, client_id);
create index sticker_awards_first_log_idx on public.sticker_awards (first_log_id);

-- What a finished workout earned: written once per log, so a retry returns the same result.
create table public.awards (
  log_id uuid primary key references public.workout_logs on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  result jsonb not null,
  -- The log's revision when the award was last worked out. A reopen and re-finish raises the log's revision,
  -- and the next call then recomputes its PRs and stats (never its stickers).
  log_revision integer not null default 0 check (log_revision >= 0),
  created_at timestamptz not null default now()
);
create index awards_client_idx on public.awards (client_id, created_at desc);
create index awards_workspace_idx on public.awards (workspace_id);

-- The current best per kind. 'heaviest' and 'e1rm' have one row per exercise; 'reps_at_weight' has one per
-- weight (value_kg is the weight, reps the best reps at it).
create table public.personal_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  exercise_id uuid not null references public.exercises on delete cascade,
  kind text not null check (kind in ('heaviest', 'reps_at_weight', 'e1rm')),
  value_kg numeric(8,3) not null check (value_kg > 0),
  reps integer check (reps between 1 and 1000),
  log_id uuid references public.workout_logs on delete set null,
  achieved_at timestamptz not null,
  check (kind <> 'reps_at_weight' or reps is not null)
);
create unique index personal_records_best_idx on public.personal_records (client_id, workspace_id, exercise_id, kind)
  where kind <> 'reps_at_weight';
create unique index personal_records_reps_idx on public.personal_records
  (client_id, workspace_id, exercise_id, value_kg)
  where kind = 'reps_at_weight';
create index personal_records_workspace_idx on public.personal_records (workspace_id);
create index personal_records_exercise_idx on public.personal_records (exercise_id);
create index personal_records_log_idx on public.personal_records (log_id);

create table public.client_stats (
  client_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  workouts integer not null default 0 check (workouts >= 0),
  streak integer not null default 0 check (streak >= 0),
  -- The Monday (client's time zone) of the last week that counted for streak; null with no streak. The streak is
  -- only written when a workout is awarded, so readers pass both to the shared liveStreak, which drops it to 0 once
  -- a whole week has ended without a workout.
  streak_week date,
  best_streak integer not null default 0 check (best_streak >= 0),
  journey_week integer not null default 0 check (journey_week >= 0),
  pr_count integer not null default 0 check (pr_count >= 0),
  lifetime_volume_kg numeric(14,3) not null default 0 check (lifetime_volume_kg >= 0),
  updated_at timestamptz not null default now(),
  primary key (client_id, workspace_id)
);
create index client_stats_workspace_idx on public.client_stats (workspace_id);

-- Deleting a workspace: clear the award rows (and logs, workouts) before the cascade reaches exercises.
create or replace function public.delete_workspace_workouts() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from public.sticker_awards a where a.workspace_id = old.id;
  delete from public.awards a where a.workspace_id = old.id;
  delete from public.personal_records p where p.workspace_id = old.id;
  delete from public.client_stats s where s.workspace_id = old.id;
  delete from public.workout_logs l where l.workspace_id = old.id;
  delete from public.workouts w where w.workspace_id = old.id;
  return old;
end;
$$;
revoke execute on function public.delete_workspace_workouts() from public, anon, authenticated;

-- Privileges: nothing for anon; authenticated reads; only the service role writes.
revoke all on table public.sticker_awards, public.awards, public.personal_records, public.client_stats
  from anon, authenticated, service_role;
grant select on public.sticker_awards, public.awards, public.personal_records, public.client_stats
  to authenticated;
grant select, insert, update, delete on public.sticker_awards, public.awards, public.personal_records,
  public.client_stats to service_role;

alter table public.sticker_awards enable row level security;
alter table public.awards enable row level security;
alter table public.personal_records enable row level security;
alter table public.client_stats enable row level security;

create policy sticker_awards_select on public.sticker_awards for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy awards_select on public.awards for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy personal_records_select on public.personal_records for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy client_stats_select on public.client_stats for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
