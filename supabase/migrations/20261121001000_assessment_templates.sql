-- Movement assessments, step 3: assessment templates (board AS11). Boards AS0–AS12, approved 2026-11-20.
--
--   assessment_templates   a coach's named, ordered set of tests ("My lower-body screen"), owned by the workspace.
--                          Picking one when starting an assessment (AS2) fills the test list in this order.
--
-- Tests are named by library key (assessment_test_definitions.test_key), never a version: start_assessment always takes
-- the newest version not retired. A key whose definitions are all retired stays in the template (nothing breaks) and
-- the website leaves it out when the template is used, saying which. A new or changed template may only name keys the
-- coach can see in the library (built-in, or the workspace's own), retired or not, so editing an old template that
-- still holds a retired key keeps working.
--
-- Access: the coaches of the workspace read and write its templates; clients, other workspaces and anon get nothing.
-- Like step 1: security invoker everywhere, search_path '', no security definer (the tenancy helper is_coach_of is
-- the existing one).

create table public.assessment_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  -- Library keys in the coach's order: 1–20, no repeats (checked by the trigger below).
  test_keys text[] not null check (cardinality(test_keys) between 1 and 20 and array_position(test_keys, null) is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One "My first screen" per workspace, whatever the case.
create unique index assessment_templates_name_idx on public.assessment_templates (workspace_id, lower(name));

-- Keys well formed, no repeats, and each one a test the coach can see in the library. Runs as the caller, so "can see"
-- is the library's own policy (built-ins, or this workspace's own tests).
create function public.assessment_templates_before_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.test_keys) k where k !~ '^[a-z][a-z0-9_]{1,60}$')
    or cardinality(new.test_keys) <> (select count(distinct k) from unnest(new.test_keys) k) then
    raise exception 'Pick between 1 and 20 different tests.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(new.test_keys) k
    where not exists (select 1 from public.assessment_test_definitions d
      where d.test_key = k and (d.workspace_id is null or d.workspace_id = new.workspace_id))
  ) then
    raise exception 'That test is not in the library.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.assessment_templates_before_write() from public, anon, authenticated;
create trigger assessment_templates_before_write before insert or update on public.assessment_templates
  for each row execute function public.assessment_templates_before_write();

-- ---------- Privileges ----------
revoke all on table public.assessment_templates from anon, authenticated, service_role;
grant select, delete on public.assessment_templates to authenticated;
grant insert (workspace_id, name, test_keys) on public.assessment_templates to authenticated;
grant update (name, test_keys) on public.assessment_templates to authenticated;
grant select, insert, update, delete on public.assessment_templates to service_role;

alter table public.assessment_templates enable row level security;

-- ---------- Policies: the workspace's coaches only ----------
create policy assessment_templates_select on public.assessment_templates for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy assessment_templates_insert on public.assessment_templates for insert to authenticated
  with check (public.is_coach_of(workspace_id));
create policy assessment_templates_update on public.assessment_templates for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id));
create policy assessment_templates_delete on public.assessment_templates for delete to authenticated
  using (public.is_coach_of(workspace_id));
