-- Automatic progression (docs/superpowers/specs/2026-11-07-auto-progression-design.md).
--
-- Progression never rewrites a workout plan, so it never fights Live Sync or its "customised" marks. It only changes
-- the SUGGESTED weight (the phone's pre-fill and what the coach sees), worked out by the shared nextSuggestion
-- (packages/shared/src/progression) from the client's last two completed sessions of each exercise. The database
-- holds the coach's switch and serves that history.

-- The coach's switch per program: off for existing programs, on by default for new ones (duplicates included), the
-- same pattern as live_sync.
alter table public.programs add column auto_progression boolean not null default false;
alter table public.programs alter column auto_progression set default true;
grant insert (auto_progression) on public.programs to authenticated;
grant update (auto_progression) on public.programs to authenticated;

-- progression_history: for one planned workout, the client's last two completed sessions (logs) of each of these
-- exercises, with every set of the exercise in them (done or not), plus the exercise's primary muscles (for the
-- shared upper/lower body rule). Returns nothing unless the workout comes from a program assignment whose program has
-- Auto progression on.
--
-- Security definer, because clients can't read programs. It answers only:
--   - a coach of the workout's workspace, or
--   - the workout's own client while they are still a client of that workspace,
-- and only from that client's logs in that same workspace, so it never reveals another client's or another
-- workspace's history. Logs of this workout itself are left out (a reopened or in-progress log isn't "previous").
create function public.progression_history(p_workout_id uuid, p_exercise_ids uuid[])
returns table (exercise_id uuid, session integer, set_type public.set_type, completed boolean,
  actual_reps smallint, actual_weight_kg numeric, primary_muscles text[])
language sql stable security definer set search_path = '' as $$
  with wk as (
    select w.id, w.workspace_id, w.client_id
    from public.workouts w
    join public.program_assignments a on a.id = w.assignment_id
    join public.programs p on p.id = a.program_id
    where w.id = p_workout_id
      and w.client_id is not null
      and p.auto_progression
      and (public.is_coach_of(w.workspace_id)
        or (w.client_id = (select auth.uid()) and public.is_client_in(w.workspace_id, w.client_id)))
  ),
  done as (
    -- Exercises of a log with at least one done set: the sessions that count.
    select le.id as log_exercise_id, le.exercise_id, l.id as log_id, l.finished_at
    from wk
    join public.workout_logs l on l.client_id = wk.client_id and l.workspace_id = wk.workspace_id
    join public.log_exercises le on le.log_id = l.id
    where l.status = 'completed'
      and l.workout_id is distinct from wk.id
      and le.exercise_id = any (p_exercise_ids)
      and exists (select 1 from public.log_sets s where s.log_exercise_id = le.id and s.completed_at is not null)
  ),
  ranked as (
    select x.exercise_id, x.log_id,
      row_number() over (partition by x.exercise_id order by x.finished_at desc, x.log_id) as session
    from (select distinct d.exercise_id, d.log_id, d.finished_at from done d) x
  )
  select r.exercise_id, r.session::integer, s.set_type, s.completed_at is not null, s.actual_reps,
    s.actual_weight_kg, e.primary_muscles
  from ranked r
  join done d on d.log_id = r.log_id and d.exercise_id = r.exercise_id
  join public.log_exercises le on le.id = d.log_exercise_id
  join public.log_blocks b on b.id = le.block_id
  join public.log_sets s on s.log_exercise_id = le.id
  join public.exercises e on e.id = r.exercise_id
  where r.session <= 2
  order by r.exercise_id, r.session, b.position, le.position, s.position;
$$;

revoke execute on function public.progression_history(uuid, uuid[]) from public, anon;
grant execute on function public.progression_history(uuid, uuid[]) to authenticated;
