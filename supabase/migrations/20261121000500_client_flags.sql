-- Flags: the coach's pains, injuries and limitations for a client, each on a body region (the shared muscle and
-- body-area catalogue, packages/shared/src/anatomy/muscles.ts) or General, with a side, a since date, a short note,
-- and open / resolved. They replace the single free-text "Limitations & injuries" note (client_limitations).
-- Boards AS9 (Overview card), AS10 (builder reminder), AS1 (the same list on the Limitations & injuries tab).
--
-- Access: coach-only, like the note it replaces. The coach of the workspace reads everything (a removed client's
-- history too) and writes only for a current client. The client does NOT read their own flags (product decision:
-- they are the coach's working notes; sharing them would be a separate, explicit choice). Other workspaces, other
-- clients and anon get nothing. Plain RLS with is_coach_of / is_client_in; no security definer functions here.

create table public.client_flags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  -- A catalogue id, or null for a General flag (a note moved over from the old field). Widen this list with a new
  -- migration when the catalogue grows; ids are never renamed.
  region text check (region in (
    'neck', 'upper_traps', 'mid_lower_traps', 'chest', 'shoulders', 'rotator_cuff', 'lats', 'biceps', 'triceps',
    'forearms', 'abs', 'obliques', 'lower_back', 'hip_flexors', 'tfl', 'glute_medius', 'glute_max', 'adductors',
    'quads', 'hamstrings', 'shins', 'calves',
    'elbow', 'wrist', 'hip', 'knee', 'ankle', 'foot')),
  -- The client's own left / right, both, or the middle. A General flag sits in the middle.
  side text not null default 'centre' check (side in ('L', 'R', 'both', 'centre')),
  type text not null check (type in ('pain', 'injury', 'limitation')),
  since date not null default current_date check (since >= date '2000-01-01'),
  note text not null default '' check (char_length(note) <= 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_on date,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_flags_general_centre check (region is not null or side = 'centre'),
  constraint client_flags_resolved_on check ((status = 'resolved') = (resolved_on is not null))
);
create index client_flags_client_idx on public.client_flags (workspace_id, client_id, status, since desc);
create index client_flags_client_id_idx on public.client_flags (client_id);
create index client_flags_created_by_idx on public.client_flags (created_by);

create trigger client_flags_touch before update on public.client_flags
  for each row execute function public.touch_updated_at();

-- ---------- Privileges: column grants keep owners and authors fixed ----------
revoke all on table public.client_flags from anon, authenticated, service_role;
grant select, delete on public.client_flags to authenticated;
grant insert (workspace_id, client_id, region, side, type, since, note) on public.client_flags to authenticated;
grant update (region, side, type, since, note, status, resolved_on) on public.client_flags to authenticated;
grant select, insert, update, delete on public.client_flags to service_role;

alter table public.client_flags enable row level security;

create policy client_flags_select on public.client_flags for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy client_flags_insert on public.client_flags for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy client_flags_update on public.client_flags for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy client_flags_delete on public.client_flags for delete to authenticated
  using (public.is_coach_of(workspace_id));

-- ---------- The old free-text note becomes one open General "Limitation" flag ----------
-- Each client's non-blank note is copied as it is (the text kept whole, trimmed), dated the day it was last saved.
-- Safe to run again: a client who already has the same General note open is skipped. Plain (invoker) function, run
-- here as the migration owner; nobody else may call it.
create function private.copy_limitations_to_flags() returns integer
language sql set search_path = '' as $$
  with moved as (
    insert into public.client_flags (workspace_id, client_id, region, side, type, since, note, created_by, created_at)
    select l.workspace_id, l.client_id, null, 'centre', 'limitation',
      greatest((l.updated_at at time zone 'UTC')::date, date '2000-01-01'), btrim(l.body, E' \t\r\n'), null, l.updated_at
    from public.client_limitations l
    where btrim(l.body, E' \t\r\n') <> ''
      and not exists (
        select 1 from public.client_flags f
        where f.workspace_id = l.workspace_id and f.client_id = l.client_id and f.region is null
          and f.note = btrim(l.body, E' \t\r\n'))
    returning 1
  )
  select count(*)::int from moved;
$$;
revoke execute on function private.copy_limitations_to_flags() from public, anon, authenticated, service_role;

select private.copy_limitations_to_flags();

-- The old note retires: the apps read and write flags from now on. Writing to it is turned off (so nothing typed
-- during the switch-over lands where no screen shows it), but the table and its rows stay readable to the coach for
-- now, so the old text is never lost and a rollback still has it. A later cleanup removes the table.
revoke insert, update on public.client_limitations from authenticated;
