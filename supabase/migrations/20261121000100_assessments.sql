-- Movement assessments, step 1 (coach website, "Limitations & injuries" tab). Boards AS0–AS12, approved 2026-11-20.
--
--   assessment_test_definitions   the test library: built-in tests (workspace_id null, seeded by the next migration)
--                                 and, later, a coach's own tests (workspace_id set). Versioned: a change is a new row.
--   assessment_cycles             per client: cycle 1, 2, … ; each holds Initial → Retest 1 → optional Retest 2.
--   assessments                   one per slot of a cycle: date, coach, foot arch L/R, draft or done, overall score.
--   assessment_tests              the tests done in one assessment, in order, each with a COPY of the definition it was
--                                 run with (so later library edits never change it), status, discomfort L/R, note,
--                                 the push-up "Type done", follow-up answers and the test's score.
--   assessment_checkpoint_results one rating per checkpoint per side (Normal / Slight / Severe). Ids are stable across
--                                 versions (`ohs.knee_valgus`), so Compare joins on (checkpoint_id, side).
--   assessment_measure_results    one number per measure per side, with its unit and which way is better.
--
-- Scores are worked out by movementScore() in packages/shared (one rule for the website and the client app) when the
-- coach saves, and stored here.
--
-- Access: coach-only. The coach of the workspace reads everything (also a removed client's history) and writes only
-- for a current client, and only while the assessment is a draft. Clients, other workspaces and anon get nothing; the
-- client app's view of the score (step 5) will be added on purpose then. Everything runs as the caller (security
-- invoker); the only security definer functions used are the existing tenancy helpers is_coach_of / is_client_in.
--
-- Later steps fit beside these tables without changing them (see the PR): step 2 suspected muscles and confirmations
-- (per assessment, muscle, side) and corrective exercises; step 3 templates (an ordered list of test keys); step 4
-- flags (replacing client_limitations).

-- ---------- Test library ----------
create table public.assessment_test_definitions (
  id uuid primary key default gen_random_uuid(),
  -- null = built-in, read by every signed-in coach; set = a coach's own test (later).
  workspace_id uuid references public.workspaces on delete cascade,
  test_key text not null check (test_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  version integer not null check (version between 1 and 1000),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('scored', 'record_only')),
  definition jsonb not null check (jsonb_typeof(definition) = 'object' and char_length(definition::text) <= 50000),
  -- Kept for old assessments but no longer offered when starting one.
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint assessment_test_definitions_matches check (
    definition ->> 'key' = test_key and definition ->> 'version' = version::text
    and definition ->> 'name' = name and definition ->> 'kind' = kind)
);
create unique index assessment_test_definitions_builtin_key on public.assessment_test_definitions (test_key, version)
  where workspace_id is null;
create unique index assessment_test_definitions_custom_key on public.assessment_test_definitions (workspace_id, test_key, version)
  where workspace_id is not null;

-- ---------- Cycles ----------
create table public.assessment_cycles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  number integer not null check (number between 1 and 1000),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, client_id, number),
  unique (id, workspace_id, client_id)
);
create index assessment_cycles_client_idx on public.assessment_cycles (client_id);
create index assessment_cycles_created_by_idx on public.assessment_cycles (created_by);

-- ---------- Assessments ----------
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  cycle_id uuid not null,
  slot text not null check (slot in ('initial', 'retest_1', 'retest_2')),
  status text not null default 'draft' check (status in ('draft', 'done')),
  assessed_on date not null check (assessed_on >= date '2000-01-01'),
  coach_id uuid default auth.uid() references auth.users on delete set null,
  -- "Before the tests": foot arch standing with shoes on, each side.
  foot_arch_left text check (foot_arch_left in ('flat', 'normal', 'high')),
  foot_arch_right text check (foot_arch_right in ('flat', 'normal', 'high')),
  note text not null default '' check (char_length(note) <= 1000),
  -- Movement score 0–100 (movementScore in packages/shared); null until done, or when nothing was scored.
  score smallint check (score between 0 and 100),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, workspace_id, client_id) references public.assessment_cycles (id, workspace_id, client_id) on delete cascade,
  unique (cycle_id, slot),
  unique (id, workspace_id),
  constraint assessments_finished check ((status = 'done') = (finished_at is not null)),
  constraint assessments_score_when_done check (status = 'done' or score is null)
);
create index assessments_client_idx on public.assessments (workspace_id, client_id, assessed_on desc);
create index assessments_client_id_idx on public.assessments (client_id);
create index assessments_coach_idx on public.assessments (coach_id);

-- ---------- Tests done in an assessment ----------
create table public.assessment_tests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  assessment_id uuid not null,
  position smallint not null check (position between 0 and 49),
  -- The library row it was started from. Set null if that row is ever deleted (a coach's own test, with its
  -- workspace): the copy below is what the assessment keeps.
  definition_id uuid references public.assessment_test_definitions on delete set null,
  -- Copied from the definition row by the trigger below; never sent by the app.
  test_key text not null,
  definition_version integer not null,
  definition jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped', 'stopped')),
  discomfort_left boolean not null default false,
  discomfort_right boolean not null default false,
  -- Push-up "Type done" (floor, incline, knees); empty for tests without it.
  type_done text not null default '' check (char_length(type_done) <= 120),
  note text not null default '' check (char_length(note) <= 1000),
  -- Follow-up id → answer, e.g. {"ohs.heel_lift_retest": "better"}.
  follow_ups jsonb not null default '{}' check (jsonb_typeof(follow_ups) = 'object' and char_length(follow_ups::text) <= 2000),
  score smallint check (score between 0 and 100),
  updated_at timestamptz not null default now(),
  foreign key (assessment_id, workspace_id) references public.assessments (id, workspace_id) on delete cascade,
  unique (assessment_id, position),
  unique (assessment_id, test_key),
  unique (id, workspace_id)
);
create index assessment_tests_workspace_idx on public.assessment_tests (workspace_id);
create index assessment_tests_definition_idx on public.assessment_tests (definition_id);
create index assessment_tests_assessment_ws_idx on public.assessment_tests (assessment_id, workspace_id);

create table public.assessment_checkpoint_results (
  test_id uuid not null,
  workspace_id uuid not null,
  checkpoint_id text not null check (checkpoint_id ~ '^[a-z]+\.[a-z0-9_]+$'),
  side text not null check (side in ('L', 'R', 'none')),
  severity text not null check (severity in ('normal', 'slight', 'severe')),
  primary key (test_id, checkpoint_id, side),
  foreign key (test_id, workspace_id) references public.assessment_tests (id, workspace_id) on delete cascade
);
create index assessment_checkpoint_results_ws_idx on public.assessment_checkpoint_results (test_id, workspace_id);
create index assessment_checkpoint_results_workspace_idx on public.assessment_checkpoint_results (workspace_id);

create table public.assessment_measure_results (
  test_id uuid not null,
  workspace_id uuid not null,
  measure_id text not null check (measure_id ~ '^[a-z]+\.[a-z0-9_]+$'),
  side text not null check (side in ('L', 'R', 'none')),
  value numeric not null check (value between 0 and 1000),
  unit text not null check (unit in ('cm', 'deg', 's')),
  higher_is_better boolean not null,
  primary key (test_id, measure_id, side),
  foreign key (test_id, workspace_id) references public.assessment_tests (id, workspace_id) on delete cascade
);
create index assessment_measure_results_ws_idx on public.assessment_measure_results (test_id, workspace_id);
create index assessment_measure_results_workspace_idx on public.assessment_measure_results (workspace_id);

-- ---------- Rules kept by triggers (security invoker: they read only what the caller may read) ----------

-- A new cycle follows the newest one, and only once that one's Retest 1 is done and nothing in it is half-done.
create function public.assessment_cycles_before_insert() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_newest integer;
  v_newest_id uuid;
begin
  select c.number, c.id into v_newest, v_newest_id from public.assessment_cycles c
    where c.workspace_id = new.workspace_id and c.client_id = new.client_id
    order by c.number desc limit 1;
  if v_newest is null then
    if new.number <> 1 then
      raise exception 'The first cycle is cycle 1.' using errcode = '23514';
    end if;
  elsif new.number <> v_newest + 1
    or not exists (select 1 from public.assessments a where a.cycle_id = v_newest_id and a.slot = 'retest_1' and a.status = 'done')
    or exists (select 1 from public.assessments a where a.cycle_id = v_newest_id and a.status = 'draft') then
    raise exception 'Finish Retest 1 before starting a new cycle.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.assessment_cycles_before_insert() from public, anon, authenticated;
create trigger assessment_cycles_before_insert before insert on public.assessment_cycles
  for each row execute function public.assessment_cycles_before_insert();

-- Slots go in order inside the newest cycle: Retest 1 after a done Initial, Retest 2 after a done Retest 1. Dates are
-- not in the future (a day of slack for time zones ahead of UTC). A draft turning done gets its finish time.
create function public.assessments_before_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.assessed_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'The date is not valid.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.score is not null then
      raise exception 'An assessment starts as a draft.' using errcode = '23514';
    end if;
    if exists (select 1 from public.assessment_cycles c join public.assessment_cycles mine on mine.id = new.cycle_id
        where c.workspace_id = mine.workspace_id and c.client_id = mine.client_id and c.number > mine.number) then
      raise exception 'Only the newest cycle can take new assessments.' using errcode = '23514';
    end if;
    if (new.slot = 'retest_1' and not exists (select 1 from public.assessments a
          where a.cycle_id = new.cycle_id and a.slot = 'initial' and a.status = 'done'))
      or (new.slot = 'retest_2' and not exists (select 1 from public.assessments a
          where a.cycle_id = new.cycle_id and a.slot = 'retest_1' and a.status = 'done')) then
      raise exception 'Finish the assessment before this one first.' using errcode = '23514';
    end if;
    new.finished_at := null;
  else
    if old.status = 'done' then
      raise exception 'A finished assessment cannot change.' using errcode = '23514';
    end if;
    new.finished_at := case when new.status = 'done' then now() end;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.assessments_before_write() from public, anon, authenticated;
create trigger assessments_before_write before insert or update on public.assessments
  for each row execute function public.assessments_before_write();

-- A test row takes its definition copy from the library row it names: a built-in, or one of the same workspace, not
-- retired. The app never sends the copy, so it can't be faked.
create function public.assessment_tests_before_insert() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_def public.assessment_test_definitions;
begin
  select d.* into v_def from public.assessment_test_definitions d
    where d.id = new.definition_id and (d.workspace_id is null or d.workspace_id = new.workspace_id) and d.retired_at is null;
  if v_def.id is null then
    raise exception 'That test is not in the library.' using errcode = '23514';
  end if;
  new.test_key := v_def.test_key;
  new.definition_version := v_def.version;
  new.definition := v_def.definition;
  return new;
end;
$$;
revoke execute on function public.assessment_tests_before_insert() from public, anon, authenticated;
create trigger assessment_tests_before_insert before insert on public.assessment_tests
  for each row execute function public.assessment_tests_before_insert();

create trigger assessment_tests_touch before update on public.assessment_tests
  for each row execute function public.touch_updated_at();

-- ---------- Privileges ----------
revoke all on table public.assessment_test_definitions, public.assessment_cycles, public.assessments,
  public.assessment_tests, public.assessment_checkpoint_results, public.assessment_measure_results
  from anon, authenticated, service_role;
grant select on public.assessment_test_definitions to authenticated;
grant select on public.assessment_cycles, public.assessments, public.assessment_tests,
  public.assessment_checkpoint_results, public.assessment_measure_results to authenticated;
grant insert (workspace_id, client_id, number) on public.assessment_cycles to authenticated;
grant insert (id, workspace_id, client_id, cycle_id, slot, assessed_on, foot_arch_left, foot_arch_right, note)
  on public.assessments to authenticated;
grant update (status, score, assessed_on, foot_arch_left, foot_arch_right, note) on public.assessments to authenticated;
grant delete on public.assessments to authenticated;
grant insert (workspace_id, assessment_id, position, definition_id) on public.assessment_tests to authenticated;
grant update (status, discomfort_left, discomfort_right, type_done, note, follow_ups, score) on public.assessment_tests to authenticated;
grant insert, delete on public.assessment_checkpoint_results, public.assessment_measure_results to authenticated;
grant select, insert, update, delete on public.assessment_test_definitions, public.assessment_cycles, public.assessments,
  public.assessment_tests, public.assessment_checkpoint_results, public.assessment_measure_results to service_role;

alter table public.assessment_test_definitions enable row level security;
alter table public.assessment_cycles enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_tests enable row level security;
alter table public.assessment_checkpoint_results enable row level security;
alter table public.assessment_measure_results enable row level security;

-- ---------- Policies ----------
-- Library: built-in tests are generic content; a workspace's own tests only for its coaches. No writes yet.
create policy assessment_test_definitions_select on public.assessment_test_definitions for select to authenticated
  using (workspace_id is null or public.is_coach_of(workspace_id));

-- Cycles: coach reads all; adds only for a current client. Never changed or deleted by the app.
create policy assessment_cycles_select on public.assessment_cycles for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy assessment_cycles_insert on public.assessment_cycles for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));

-- Assessments: coach reads all; starts one for a current client; changes or deletes only a draft.
create policy assessments_select on public.assessments for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy assessments_insert on public.assessments for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy assessments_update on public.assessments for update to authenticated
  using (public.is_coach_of(workspace_id) and status = 'draft')
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy assessments_delete on public.assessments for delete to authenticated
  using (public.is_coach_of(workspace_id) and status = 'draft');

-- Tests and results: coach reads all; writes only inside a draft assessment of a current client. The subqueries run
-- under the caller's own RLS on assessments / assessment_tests.
create policy assessment_tests_select on public.assessment_tests for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy assessment_tests_insert on public.assessment_tests for insert to authenticated
  with check (public.is_coach_of(workspace_id) and exists (select 1 from public.assessments a
    where a.id = assessment_id and a.workspace_id = assessment_tests.workspace_id and a.status = 'draft'
      and public.is_client_in(a.workspace_id, a.client_id)));
create policy assessment_tests_update on public.assessment_tests for update to authenticated
  using (public.is_coach_of(workspace_id) and exists (select 1 from public.assessments a
    where a.id = assessment_id and a.status = 'draft'))
  with check (public.is_coach_of(workspace_id) and exists (select 1 from public.assessments a
    where a.id = assessment_id and a.workspace_id = assessment_tests.workspace_id and a.status = 'draft'
      and public.is_client_in(a.workspace_id, a.client_id)));

create policy assessment_checkpoint_results_select on public.assessment_checkpoint_results for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy assessment_checkpoint_results_insert on public.assessment_checkpoint_results for insert to authenticated
  with check (public.is_coach_of(workspace_id) and exists (select 1 from public.assessment_tests t
    join public.assessments a on a.id = t.assessment_id
    where t.id = test_id and t.workspace_id = assessment_checkpoint_results.workspace_id and a.status = 'draft'
      and public.is_client_in(a.workspace_id, a.client_id)));
create policy assessment_checkpoint_results_delete on public.assessment_checkpoint_results for delete to authenticated
  using (public.is_coach_of(workspace_id) and exists (select 1 from public.assessment_tests t
    join public.assessments a on a.id = t.assessment_id
    where t.id = test_id and a.status = 'draft'));

create policy assessment_measure_results_select on public.assessment_measure_results for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy assessment_measure_results_insert on public.assessment_measure_results for insert to authenticated
  with check (public.is_coach_of(workspace_id) and exists (select 1 from public.assessment_tests t
    join public.assessments a on a.id = t.assessment_id
    where t.id = test_id and t.workspace_id = assessment_measure_results.workspace_id and a.status = 'draft'
      and public.is_client_in(a.workspace_id, a.client_id)));
create policy assessment_measure_results_delete on public.assessment_measure_results for delete to authenticated
  using (public.is_coach_of(workspace_id) and exists (select 1 from public.assessment_tests t
    join public.assessments a on a.id = t.assessment_id
    where t.id = test_id and a.status = 'draft'));

-- ---------- Functions (security invoker: every row goes through the policies above) ----------

-- start_assessment: starts a draft. A new cycle when asked (or for the very first one), else the newest cycle. The
-- tests are library keys in the order the coach picked; each takes the newest version not retired (the workspace's
-- own before a built-in of the same key). Returns the new assessment's id.
create function public.start_assessment(
  p_workspace_id uuid,
  p_client_id uuid,
  p_slot text,
  p_new_cycle boolean,
  p_assessed_on date,
  p_foot_arch_left text,
  p_foot_arch_right text,
  p_note text,
  p_test_keys text[]
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_cycle uuid;
  v_number integer;
  v_id uuid;
  v_count integer;
begin
  if not public.is_coach_of(p_workspace_id) or not public.is_client_in(p_workspace_id, p_client_id) then
    raise exception 'You can''t assess this client.' using errcode = '42501';
  end if;
  if p_test_keys is null or cardinality(p_test_keys) not between 1 and 20
    or cardinality(p_test_keys) <> (select count(distinct k) from unnest(p_test_keys) k) then
    raise exception 'Pick between 1 and 20 different tests.' using errcode = '22023';
  end if;

  select c.id, c.number into v_cycle, v_number from public.assessment_cycles c
    where c.workspace_id = p_workspace_id and c.client_id = p_client_id
    order by c.number desc limit 1;
  if p_new_cycle or v_cycle is null then
    if p_slot <> 'initial' then
      raise exception 'A new cycle starts with its Initial.' using errcode = '22023';
    end if;
    insert into public.assessment_cycles (workspace_id, client_id, number)
      values (p_workspace_id, p_client_id, coalesce(v_number, 0) + 1)
      returning id into v_cycle;
  end if;

  insert into public.assessments (workspace_id, client_id, cycle_id, slot, assessed_on, foot_arch_left, foot_arch_right, note)
    values (p_workspace_id, p_client_id, v_cycle, p_slot, p_assessed_on, p_foot_arch_left, p_foot_arch_right, coalesce(p_note, ''))
    returning id into v_id;

  insert into public.assessment_tests (workspace_id, assessment_id, position, definition_id)
    select p_workspace_id, v_id, (k.ord - 1)::smallint, d.id
    from unnest(p_test_keys) with ordinality as k(key, ord)
    join lateral (
      select x.id from public.assessment_test_definitions x
      where x.test_key = k.key and (x.workspace_id is null or x.workspace_id = p_workspace_id) and x.retired_at is null
      order by (x.workspace_id is null), x.version desc
      limit 1
    ) d on true;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(p_test_keys) then
    raise exception 'That test is not in the library.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;
revoke execute on function public.start_assessment(uuid, uuid, text, boolean, date, text, text, text, text[]) from public, anon;
grant execute on function public.start_assessment(uuid, uuid, text, boolean, date, text, text, text, text[]) to authenticated;

-- save_assessment_test: saves one test of a draft (autosave and Next / Skip / Stop) in one go. Ratings and numbers
-- replace what was there; each must name a checkpoint or measure of the test's own definition copy, on a side that
-- fits it, and numbers must be in the measure's range. Unit and direction come from the copy.
--   p_results  = [{ checkpoint_id, side, severity }]
--   p_measures = [{ measure_id, side, value }]
create function public.save_assessment_test(
  p_test_id uuid,
  p_status text,
  p_results jsonb,
  p_measures jsonb,
  p_follow_ups jsonb,
  p_discomfort_left boolean,
  p_discomfort_right boolean,
  p_type_done text,
  p_note text,
  p_score smallint
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_ws uuid;
  v_def jsonb;
begin
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_typeof(p_measures) is distinct from 'array'
    or jsonb_array_length(p_results) > 200 or jsonb_array_length(p_measures) > 50 then
    raise exception 'The results are not valid.' using errcode = '22023';
  end if;

  update public.assessment_tests
    set status = p_status, follow_ups = coalesce(p_follow_ups, '{}'::jsonb), discomfort_left = p_discomfort_left,
      discomfort_right = p_discomfort_right, type_done = coalesce(p_type_done, ''), note = coalesce(p_note, ''),
      score = p_score
    where id = p_test_id
    returning workspace_id, definition into v_ws, v_def;
  if v_ws is null then
    raise exception 'This assessment can''t be changed.' using errcode = '42501';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_results) as r(checkpoint_id text, side text, severity text)
    where not exists (
      select 1 from jsonb_path_query(v_def, '$.views[*].groups[*].checkpoints[*]') as c(cp)
      where c.cp ->> 'id' = r.checkpoint_id
        and (case when (c.cp ->> 'sided')::boolean then r.side in ('L', 'R') else r.side = 'none' end))
  ) then
    raise exception 'A rating does not fit this test.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_measures) as r(measure_id text, side text, value numeric)
    where not exists (
      select 1 from jsonb_path_query(v_def, '$.measures[*]') as m(ms)
      where m.ms ->> 'id' = r.measure_id
        and (case when (m.ms ->> 'sided')::boolean then r.side in ('L', 'R') else r.side = 'none' end)
        and r.value between (m.ms ->> 'min')::numeric and (m.ms ->> 'max')::numeric)
  ) then
    raise exception 'A number does not fit this test.' using errcode = '22023';
  end if;

  delete from public.assessment_checkpoint_results where test_id = p_test_id;
  insert into public.assessment_checkpoint_results (test_id, workspace_id, checkpoint_id, side, severity)
    select p_test_id, v_ws, r.checkpoint_id, r.side, r.severity
    from jsonb_to_recordset(p_results) as r(checkpoint_id text, side text, severity text);

  delete from public.assessment_measure_results where test_id = p_test_id;
  insert into public.assessment_measure_results (test_id, workspace_id, measure_id, side, value, unit, higher_is_better)
    select p_test_id, v_ws, r.measure_id, r.side, r.value, m.ms ->> 'unit', (m.ms ->> 'higherIsBetter')::boolean
    from jsonb_to_recordset(p_measures) as r(measure_id text, side text, value numeric)
    join lateral (select x.ms from jsonb_path_query(v_def, '$.measures[*]') as x(ms) where x.ms ->> 'id' = r.measure_id) m on true;
end;
$$;
revoke execute on function public.save_assessment_test(uuid, text, jsonb, jsonb, jsonb, boolean, boolean, text, text, smallint) from public, anon;
grant execute on function public.save_assessment_test(uuid, text, jsonb, jsonb, jsonb, boolean, boolean, text, text, smallint) to authenticated;

-- finish_assessment: marks a draft done. Tests never reached count as skipped. Stores each test's score and the overall
-- score, as worked out by movementScore() in packages/shared.  p_scores = [{ test_id, score }] (score may be null).
create function public.finish_assessment(p_assessment_id uuid, p_scores jsonb, p_overall smallint) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_scores) is distinct from 'array' then
    raise exception 'The scores are not valid.' using errcode = '22023';
  end if;
  update public.assessment_tests set status = 'skipped' where assessment_id = p_assessment_id and status = 'pending';
  update public.assessment_tests t set score = s.score
    from jsonb_to_recordset(p_scores) as s(test_id uuid, score smallint)
    where t.id = s.test_id and t.assessment_id = p_assessment_id;
  update public.assessments set status = 'done', score = p_overall where id = p_assessment_id and status = 'draft';
  if not found then
    raise exception 'This assessment can''t be finished.' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.finish_assessment(uuid, jsonb, smallint) from public, anon;
grant execute on function public.finish_assessment(uuid, jsonb, smallint) to authenticated;
