-- Movement assessments, step 2: findings on the body map, the coach's corrective-exercise library, and the picks
-- that make the suggested corrective workout (boards AS4, AS5, AS5b, AS8).
--
--   corrective_exercises         a library exercise (built-in or the workspace's own) tagged as corrective: direction
--                                (under = strengthen / over = release, stretch) and its default sets × reps or seconds.
--   corrective_exercise_muscles  its muscle groups and sides (the shared catalogue, packages/shared/src/anatomy).
--   assessment_muscle_marks      the coach's decisions on the findings: per muscle group and side, possibly over /
--                                under / normal, confirmed or rejected, with the checkpoints it came from.
--   assessment_checks            the "Also check" items the coach ticked.
--   assessment_exercise_picks    the exercises picked per confirmed muscle (they make the suggested workout).
--
-- Access: coach-only, like the rest of the assessment. The coach of the workspace reads everything (a removed client's
-- history too). Marks and checks are part of the assessment record: written only while the assessment is a draft and
-- the client is current, so a finished assessment stays locked (Compare and the report read them). Picks are the
-- coach's plan, not the record: they can change after finishing (to remake the suggested workout) while the client is
-- current. Clients, other workspaces and anon read nothing. Plain RLS with is_coach_of / is_client_in; the two save
-- functions are security invoker with search_path '' (every row they touch goes through the policies). No new
-- security definer.
--
-- Photos for the coach's own exercises: the existing public exercise-images bucket gets RLS-checked uploads under
-- custom/<workspace>/<exercise>/<file>.webp|jpg, only by a coach of that workspace and only for that workspace's own
-- custom exercise. Built-in images and other paths stay service-role only. A deleted coach's photos are removed with
-- their account (storage_objects_for_user lists objects they own).

-- ---------- Corrective exercises ----------
create table public.corrective_exercises (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  exercise_id uuid not null references public.exercises on delete cascade,
  direction text not null check (direction in ('under', 'over')),
  default_sets smallint not null default 2 check (default_sets between 1 and 20),
  default_reps smallint check (default_reps between 1 and 100),
  default_seconds smallint check (default_seconds between 1 and 600),
  each_side boolean not null default false,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, exercise_id, direction),
  unique (id, workspace_id),
  constraint corrective_exercises_reps_or_seconds check (default_reps is null or default_seconds is null)
);
create index corrective_exercises_exercise_idx on public.corrective_exercises (exercise_id);
create index corrective_exercises_created_by_idx on public.corrective_exercises (created_by);

create trigger corrective_exercises_touch before update on public.corrective_exercises
  for each row execute function public.touch_updated_at();

create table public.corrective_exercise_muscles (
  corrective_id uuid not null,
  workspace_id uuid not null,
  -- A catalogue muscle group (not a joint). Widen with a new migration when the catalogue grows; ids never change.
  muscle_id text not null check (muscle_id in (
    'neck', 'upper_traps', 'mid_lower_traps', 'chest', 'shoulders', 'rotator_cuff', 'lats', 'biceps', 'triceps',
    'forearms', 'abs', 'obliques', 'lower_back', 'hip_flexors', 'tfl', 'glute_medius', 'glute_max', 'adductors',
    'quads', 'hamstrings', 'shins', 'calves')),
  -- The client's own side; abs is one region ('none').
  side text not null check (side in ('L', 'R', 'none')),
  primary key (corrective_id, muscle_id, side),
  foreign key (corrective_id, workspace_id) references public.corrective_exercises (id, workspace_id) on delete cascade,
  constraint corrective_exercise_muscles_side check ((muscle_id = 'abs') = (side = 'none'))
);
create index corrective_exercise_muscles_ws_idx on public.corrective_exercise_muscles (corrective_id, workspace_id);
create index corrective_exercise_muscles_workspace_idx on public.corrective_exercise_muscles (workspace_id);

-- ---------- Findings: muscle marks and "Also check" ----------
create table public.assessment_muscle_marks (
  assessment_id uuid not null,
  workspace_id uuid not null,
  muscle_id text not null check (muscle_id in (
    'neck', 'upper_traps', 'mid_lower_traps', 'chest', 'shoulders', 'rotator_cuff', 'lats', 'biceps', 'triceps',
    'forearms', 'abs', 'obliques', 'lower_back', 'hip_flexors', 'tfl', 'glute_medius', 'glute_max', 'adductors',
    'quads', 'hamstrings', 'shins', 'calves')),
  side text not null check (side in ('L', 'R', 'none')),
  status text not null check (status in ('over', 'under', 'normal')),
  review text not null check (review in ('confirmed', 'rejected')),
  -- The checkpoints it came from (stable ids like 'ohs.knee_valgus'); empty for one the coach added from nothing.
  sources text[] not null default '{}' check (
    cardinality(sources) <= 10
    and array_to_string(sources, ',') ~ '^([a-z]+\.[a-z0-9_]+(,[a-z]+\.[a-z0-9_]+)*)?$'),
  primary key (assessment_id, muscle_id, side),
  foreign key (assessment_id, workspace_id) references public.assessments (id, workspace_id) on delete cascade,
  constraint assessment_muscle_marks_side check ((muscle_id = 'abs') = (side = 'none'))
);
create index assessment_muscle_marks_ws_idx on public.assessment_muscle_marks (assessment_id, workspace_id);
create index assessment_muscle_marks_workspace_idx on public.assessment_muscle_marks (workspace_id);

create table public.assessment_checks (
  assessment_id uuid not null,
  workspace_id uuid not null,
  check_id text not null check (check_id in (
    'ankle_mobility', 'upper_back_mobility', 'hip_rotation', 'trunk_control', 'hands_on_hips', 'hamstring_length',
    'hip_flexor_length', 'foot_posture', 'pain_history', 'squat_depth')),
  primary key (assessment_id, check_id),
  foreign key (assessment_id, workspace_id) references public.assessments (id, workspace_id) on delete cascade
);
create index assessment_checks_ws_idx on public.assessment_checks (assessment_id, workspace_id);
create index assessment_checks_workspace_idx on public.assessment_checks (workspace_id);

-- ---------- Picks ----------
create table public.assessment_exercise_picks (
  assessment_id uuid not null,
  workspace_id uuid not null,
  muscle_id text not null check (muscle_id in (
    'neck', 'upper_traps', 'mid_lower_traps', 'chest', 'shoulders', 'rotator_cuff', 'lats', 'biceps', 'triceps',
    'forearms', 'abs', 'obliques', 'lower_back', 'hip_flexors', 'tfl', 'glute_medius', 'glute_max', 'adductors',
    'quads', 'hamstrings', 'shins', 'calves')),
  status text not null check (status in ('over', 'under')),
  exercise_id uuid not null references public.exercises on delete cascade,
  position smallint not null check (position between 0 and 99),
  primary key (assessment_id, muscle_id, status, exercise_id),
  foreign key (assessment_id, workspace_id) references public.assessments (id, workspace_id) on delete cascade
);
create index assessment_exercise_picks_ws_idx on public.assessment_exercise_picks (assessment_id, workspace_id);
create index assessment_exercise_picks_workspace_idx on public.assessment_exercise_picks (workspace_id);
create index assessment_exercise_picks_exercise_idx on public.assessment_exercise_picks (exercise_id);

-- ---------- Privileges ----------
revoke all on table public.corrective_exercises, public.corrective_exercise_muscles, public.assessment_muscle_marks,
  public.assessment_checks, public.assessment_exercise_picks from anon, authenticated, service_role;
grant select, delete on public.corrective_exercises to authenticated;
grant insert (workspace_id, exercise_id, direction, default_sets, default_reps, default_seconds, each_side)
  on public.corrective_exercises to authenticated;
grant update (direction, default_sets, default_reps, default_seconds, each_side) on public.corrective_exercises to authenticated;
grant select, insert, delete on public.corrective_exercise_muscles, public.assessment_muscle_marks,
  public.assessment_checks, public.assessment_exercise_picks to authenticated;
grant select, insert, update, delete on public.corrective_exercises, public.corrective_exercise_muscles,
  public.assessment_muscle_marks, public.assessment_checks, public.assessment_exercise_picks to service_role;

alter table public.corrective_exercises enable row level security;
alter table public.corrective_exercise_muscles enable row level security;
alter table public.assessment_muscle_marks enable row level security;
alter table public.assessment_checks enable row level security;
alter table public.assessment_exercise_picks enable row level security;

-- ---------- Policies ----------
-- Corrective library: the workspace's coaches only. The exercise must be a built-in or the workspace's own (the
-- subquery runs under the caller's RLS on exercises, which already hides other workspaces' exercises).
create policy corrective_exercises_select on public.corrective_exercises for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy corrective_exercises_insert on public.corrective_exercises for insert to authenticated
  with check (public.is_coach_of(workspace_id) and exists (select 1 from public.exercises e
    where e.id = exercise_id and (e.workspace_id is null or e.workspace_id = corrective_exercises.workspace_id)));
create policy corrective_exercises_update on public.corrective_exercises for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id));
create policy corrective_exercises_delete on public.corrective_exercises for delete to authenticated
  using (public.is_coach_of(workspace_id));

create policy corrective_exercise_muscles_select on public.corrective_exercise_muscles for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy corrective_exercise_muscles_insert on public.corrective_exercise_muscles for insert to authenticated
  with check (public.is_coach_of(workspace_id) and exists (select 1 from public.corrective_exercises c
    where c.id = corrective_id and c.workspace_id = corrective_exercise_muscles.workspace_id));
create policy corrective_exercise_muscles_delete on public.corrective_exercise_muscles for delete to authenticated
  using (public.is_coach_of(workspace_id));

-- Marks and checks: read by the coach; written only inside a draft assessment of a current client.
create policy assessment_muscle_marks_select on public.assessment_muscle_marks for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy assessment_muscle_marks_insert on public.assessment_muscle_marks for insert to authenticated
  with check (public.is_coach_of(workspace_id) and exists (select 1 from public.assessments a
    where a.id = assessment_id and a.workspace_id = assessment_muscle_marks.workspace_id and a.status = 'draft'
      and public.is_client_in(a.workspace_id, a.client_id)));
create policy assessment_muscle_marks_delete on public.assessment_muscle_marks for delete to authenticated
  using (public.is_coach_of(workspace_id) and exists (select 1 from public.assessments a
    where a.id = assessment_id and a.workspace_id = assessment_muscle_marks.workspace_id and a.status = 'draft'
      and public.is_client_in(a.workspace_id, a.client_id)));

create policy assessment_checks_select on public.assessment_checks for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy assessment_checks_insert on public.assessment_checks for insert to authenticated
  with check (public.is_coach_of(workspace_id) and exists (select 1 from public.assessments a
    where a.id = assessment_id and a.workspace_id = assessment_checks.workspace_id and a.status = 'draft'
      and public.is_client_in(a.workspace_id, a.client_id)));
create policy assessment_checks_delete on public.assessment_checks for delete to authenticated
  using (public.is_coach_of(workspace_id) and exists (select 1 from public.assessments a
    where a.id = assessment_id and a.workspace_id = assessment_checks.workspace_id and a.status = 'draft'
      and public.is_client_in(a.workspace_id, a.client_id)));

-- Picks: read by the coach; written for a current client's assessment (draft or done), only with an exercise the
-- workspace can use.
create policy assessment_exercise_picks_select on public.assessment_exercise_picks for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy assessment_exercise_picks_insert on public.assessment_exercise_picks for insert to authenticated
  with check (public.is_coach_of(workspace_id)
    and exists (select 1 from public.assessments a
      where a.id = assessment_id and a.workspace_id = assessment_exercise_picks.workspace_id
        and public.is_client_in(a.workspace_id, a.client_id))
    and exists (select 1 from public.exercises e
      where e.id = exercise_id and (e.workspace_id is null or e.workspace_id = assessment_exercise_picks.workspace_id)));
create policy assessment_exercise_picks_delete on public.assessment_exercise_picks for delete to authenticated
  using (public.is_coach_of(workspace_id) and exists (select 1 from public.assessments a
    where a.id = assessment_id and a.workspace_id = assessment_exercise_picks.workspace_id
      and public.is_client_in(a.workspace_id, a.client_id)));

-- ---------- Functions (security invoker: every row goes through the policies above) ----------

-- save_corrective_exercise: adds (p_id null) or changes one corrective exercise and replaces its muscle tags, in one
-- go. Returns its id.  p_muscles = [{ muscle_id, side }] (1 to 24).
create function public.save_corrective_exercise(
  p_workspace_id uuid,
  p_id uuid,
  p_exercise_id uuid,
  p_direction text,
  p_sets smallint,
  p_reps smallint,
  p_seconds smallint,
  p_each_side boolean,
  p_muscles jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_muscles) is distinct from 'array' or jsonb_array_length(p_muscles) not between 1 and 24 then
    raise exception 'Pick at least one muscle group.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.corrective_exercises (workspace_id, exercise_id, direction, default_sets, default_reps, default_seconds, each_side)
      values (p_workspace_id, p_exercise_id, p_direction, p_sets, p_reps, p_seconds, coalesce(p_each_side, false))
      returning id into v_id;
  else
    update public.corrective_exercises
      set direction = p_direction, default_sets = p_sets, default_reps = p_reps, default_seconds = p_seconds,
        each_side = coalesce(p_each_side, false)
      where id = p_id and workspace_id = p_workspace_id and exercise_id = p_exercise_id
      returning id into v_id;
    if v_id is null then
      raise exception 'This corrective exercise can''t be changed.' using errcode = '42501';
    end if;
    delete from public.corrective_exercise_muscles where corrective_id = v_id;
  end if;
  insert into public.corrective_exercise_muscles (corrective_id, workspace_id, muscle_id, side)
    select v_id, p_workspace_id, m.muscle_id, m.side
    from jsonb_to_recordset(p_muscles) as m(muscle_id text, side text);
  return v_id;
end;
$$;
revoke execute on function public.save_corrective_exercise(uuid, uuid, uuid, text, smallint, smallint, smallint, boolean, jsonb) from public, anon;
grant execute on function public.save_corrective_exercise(uuid, uuid, uuid, text, smallint, smallint, smallint, boolean, jsonb) to authenticated;

-- save_assessment_review: replaces a draft's muscle marks and ticked checks (autosave on the Findings screen).
--   p_marks  = [{ muscle_id, side, status, review, sources: [checkpoint ids] }]   p_checks = [check ids]
create function public.save_assessment_review(p_assessment_id uuid, p_marks jsonb, p_checks jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_ws uuid;
begin
  if jsonb_typeof(p_marks) is distinct from 'array' or jsonb_typeof(p_checks) is distinct from 'array'
    or jsonb_array_length(p_marks) > 44 or jsonb_array_length(p_checks) > 20 then
    raise exception 'The findings are not valid.' using errcode = '22023';
  end if;
  -- Under RLS: only the workspace's coach sees the assessment; a done one or a past client's is refused here (and
  -- again by the policies).
  select a.workspace_id into v_ws from public.assessments a
    where a.id = p_assessment_id and a.status = 'draft' and public.is_client_in(a.workspace_id, a.client_id);
  if v_ws is null then
    raise exception 'These findings can''t be changed.' using errcode = '42501';
  end if;
  delete from public.assessment_muscle_marks where assessment_id = p_assessment_id;
  insert into public.assessment_muscle_marks (assessment_id, workspace_id, muscle_id, side, status, review, sources)
    select p_assessment_id, v_ws, m.muscle_id, m.side, m.status, m.review,
      coalesce((select array_agg(s) from jsonb_array_elements_text(coalesce(m.sources, '[]'::jsonb)) as s), '{}')
    from jsonb_to_recordset(p_marks) as m(muscle_id text, side text, status text, review text, sources jsonb);
  delete from public.assessment_checks where assessment_id = p_assessment_id;
  insert into public.assessment_checks (assessment_id, workspace_id, check_id)
    select distinct p_assessment_id, v_ws, c from jsonb_array_elements_text(p_checks) as c;
end;
$$;
revoke execute on function public.save_assessment_review(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_assessment_review(uuid, jsonb, jsonb) to authenticated;

-- save_assessment_picks: replaces the picked exercises (in order).  p_picks = [{ muscle_id, status, exercise_id }]
create function public.save_assessment_picks(p_assessment_id uuid, p_picks jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_ws uuid;
begin
  if jsonb_typeof(p_picks) is distinct from 'array' or jsonb_array_length(p_picks) > 60 then
    raise exception 'The picks are not valid.' using errcode = '22023';
  end if;
  select a.workspace_id into v_ws from public.assessments a
    where a.id = p_assessment_id and public.is_client_in(a.workspace_id, a.client_id);
  if v_ws is null then
    raise exception 'These picks can''t be changed.' using errcode = '42501';
  end if;
  delete from public.assessment_exercise_picks where assessment_id = p_assessment_id;
  insert into public.assessment_exercise_picks (assessment_id, workspace_id, muscle_id, status, exercise_id, position)
    select p_assessment_id, v_ws, p.muscle_id, p.status, p.exercise_id, (p.n - 1)::smallint
    from rows from (jsonb_to_recordset(p_picks) as (muscle_id text, status text, exercise_id uuid)) with ordinality
      as p(muscle_id, status, exercise_id, n);
end;
$$;
revoke execute on function public.save_assessment_picks(uuid, jsonb) from public, anon;
grant execute on function public.save_assessment_picks(uuid, jsonb) to authenticated;

-- ---------- Photos for the coach's own exercises (existing public bucket, RLS-checked writes) ----------
-- Now that coaches can write to the public bucket, it takes only pictures, and not big ones: WebP or JPEG, at most 5 MB.
-- (The importer uploads WebP only; every library picture is well under 5 MB. The app sends ~1600 px WebP/JPEG.)
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/webp', 'image/jpeg']
  where id = 'exercise-images';

-- custom/<workspace id>/<exercise id>/<uuid>.webp|jpg. The case keeps the uuid casts behind the shape check (and
-- clauses can run in any order). The exercise lookup runs under the caller's RLS; `objects.name` is the file's path
-- (a bare `name` there would be the exercise's).
create policy exercise_images_custom_select on storage.objects for select to authenticated
  using (bucket_id = 'exercise-images' and case
    when name ~ '^custom/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
    then public.is_coach_of(split_part(name, '/', 2)::uuid)
    else false end);
create policy exercise_images_custom_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'exercise-images' and case
    when name ~ '^custom/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
    then public.is_coach_of(split_part(name, '/', 2)::uuid) and exists (select 1 from public.exercises e
      where e.id = split_part(objects.name, '/', 3)::uuid and e.source = 'custom'
        and e.workspace_id = split_part(objects.name, '/', 2)::uuid)
    else false end);
create policy exercise_images_custom_delete on storage.objects for delete to authenticated
  using (bucket_id = 'exercise-images' and case
    when name ~ '^custom/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
    then public.is_coach_of(split_part(name, '/', 2)::uuid)
    else false end);
