-- Metrics: one dated value per row for the six metrics the Metrics tab shows (weight, body fat, muscle mass,
-- VO2 max, waist, resting heart rate), logged by the coach or the client, or imported from Apple Health.
--
-- Why a new table next to body_measurements instead of changing it: the client app already installed from
-- TestFlight reads and writes body_measurements / body_measurement_values / save_body_measurement and cannot be
-- updated over the air. Those stay exactly as they are. InBody scans and the client's weight entries keep living
-- there; the metric_entries view below puts them together with the new rows, so every Metrics card reads one list.
-- Nothing is copied (no backfill, no mirrored writes), so the two can never disagree.
--
-- Values are stored in canonical metric units: kg (weight, muscle mass), % (body fat), mL/kg/min (VO2 max),
-- cm (waist), bpm (resting heart rate). Keys and ranges mirror METRIC_CATALOGUE in packages/shared/src/metrics.

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(), -- may be generated on the phone, so a retry edits the same row
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  metric_key text not null
    check (metric_key in ('weight_kg', 'body_fat_pct', 'smm_kg', 'vo2_max', 'waist_cm', 'resting_hr_bpm')),
  value numeric not null,
  measured_on date not null check (measured_on >= date '2000-01-01'),
  -- The exact time when known (Apple Health samples); orders several values on one day.
  measured_at timestamptz,
  source text not null check (source in ('manual', 'apple_health')),
  entered_by_role text not null check (entered_by_role in ('coach', 'client')),
  entered_by uuid default auth.uid() references auth.users on delete set null,
  -- Apple Health's sample id. Re-syncing the same sample updates the row instead of adding a second one.
  external_id text check (char_length(external_id) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint body_metrics_external_id_needed check ((source = 'apple_health') = (external_id is not null)),
  constraint body_metrics_apple_health_client check (source <> 'apple_health' or entered_by_role = 'client'),
  -- Apple Health has no skeletal muscle mass.
  constraint body_metrics_source_allowed check (not (source = 'apple_health' and metric_key = 'smm_kg')),
  constraint body_metrics_value_range check (case metric_key
    when 'weight_kg' then value between 20 and 400
    when 'body_fat_pct' then value between 2 and 75
    when 'smm_kg' then value between 5 and 120
    when 'vo2_max' then value between 10 and 100
    when 'waist_cm' then value between 40 and 250
    when 'resting_hr_bpm' then value between 25 and 220
  end),
  -- One row per Apple Health sample per coaching relationship (manual rows have no external id, so never clash).
  constraint body_metrics_external_unique unique (workspace_id, client_id, source, external_id)
);
create index body_metrics_client_idx on public.body_metrics (client_id, metric_key, measured_on desc);
create index body_metrics_workspace_idx on public.body_metrics (workspace_id);
create index body_metrics_entered_by_idx on public.body_metrics (entered_by);

-- Dates: not in the future (one day of slack past today in UTC, for time zones ahead of UTC), same as scans; an exact
-- time at most a day ahead, and on (or a day either side of, for the client's time zone) the date it is filed under.
-- A trigger rather than a check, because "today" is not a fixed value. Also keeps updated_at current.
create function public.body_metrics_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.measured_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'The date is not valid.' using errcode = '23514';
  end if;
  if new.measured_at is not null and (new.measured_at > now() + interval '1 day'
    or abs((new.measured_at at time zone 'utc')::date - new.measured_on) > 1) then
    raise exception 'The time is not valid.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.body_metrics_before_write() from public, anon, authenticated;
create trigger body_metrics_before_write before insert or update on public.body_metrics
  for each row execute function public.body_metrics_before_write();

-- Privileges: nothing for anon. authenticated inserts the row's own columns, changes only the value and its date
-- (who entered it, the source, the client and the sample id never change), and deletes; RLS decides which rows.
revoke all on table public.body_metrics from anon, authenticated, service_role;
grant select, delete on public.body_metrics to authenticated;
grant insert (id, workspace_id, client_id, metric_key, value, measured_on, measured_at, source, entered_by_role,
  entered_by, external_id) on public.body_metrics to authenticated;
grant update (value, measured_on, measured_at) on public.body_metrics to authenticated;
grant select, insert, update, delete on public.body_metrics to service_role;

alter table public.body_metrics enable row level security;

-- Read: the coach sees every entry in their workspace (including removed clients' history, as with scans);
-- a client sees only their own, and only while still a client of that workspace.
create policy body_metrics_select on public.body_metrics for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));

-- Add: always as yourself, for a current client of the workspace. The coach adds manual entries marked 'coach';
-- the client adds their own entries marked 'client' (manual, or imported from Apple Health).
create policy body_metrics_insert on public.body_metrics for insert to authenticated
  with check (entered_by = (select auth.uid()) and public.is_client_in(workspace_id, client_id) and (
    (entered_by_role = 'coach' and source = 'manual' and public.is_coach_of(workspace_id))
    or (entered_by_role = 'client' and client_id = (select auth.uid()))));

-- Change: each side changes only what its side entered. The coach: manual entries a coach of the workspace made,
-- for a current client. The client: their own entries (manual ones by hand; Apple Health ones when a re-sync
-- brings a changed sample). Nobody changes the other side's entries.
create policy body_metrics_update on public.body_metrics for update to authenticated
  using ((entered_by_role = 'coach' and source = 'manual' and public.is_coach_of(workspace_id)
      and public.is_client_in(workspace_id, client_id))
    or (entered_by_role = 'client' and client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)))
  with check ((entered_by_role = 'coach' and source = 'manual' and public.is_coach_of(workspace_id)
      and public.is_client_in(workspace_id, client_id))
    or (entered_by_role = 'client' and client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));

-- Delete: the coach deletes manual entries a coach made (also for a removed client); the client deletes their own
-- entries (manual ones, and Apple Health imports, e.g. after turning the import off).
create policy body_metrics_delete on public.body_metrics for delete to authenticated
  using ((entered_by_role = 'coach' and source = 'manual' and public.is_coach_of(workspace_id))
    or (entered_by_role = 'client' and client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));

-- Every Metrics value in one list: the new body_metrics rows, plus the matching values of InBody scans and of the
-- client's weight entries in body_measurements. Security invoker: each table's own RLS decides what the caller sees,
-- so this shows nobody anything they could not already read.
--   origin 'body_metrics'      → id is the body_metrics row (edit or delete that row)
--   origin 'body_measurements' → id is the scan / weight entry (edit through save_body_measurement, as before)
-- A coach-entered body measurement counts as an InBody scan (source 'inbody_scan') when it has a printout or any
-- value besides weight (the scan form's other measures); a coach-entered weight on its own is a manual entry by the
-- coach. A client-entered one is the client's own weigh-in (source 'manual').
create view public.metric_entries with (security_invoker = true) as
  select
    'body_metrics'::text as origin,
    b.id,
    b.workspace_id,
    b.client_id,
    b.metric_key,
    b.value,
    b.measured_on,
    b.measured_at,
    b.source,
    b.entered_by_role,
    b.entered_by,
    b.external_id,
    b.created_at
  from public.body_metrics b
  union all
  select
    'body_measurements'::text,
    m.id,
    m.workspace_id,
    m.client_id,
    v.metric_key,
    v.value,
    m.measured_on,
    null::timestamptz,
    case when m.source = 'coach' and (m.attachment_path is not null or exists (
      select 1 from public.body_measurement_values o where o.measurement_id = m.id and o.metric_key <> 'weight_kg'))
      then 'inbody_scan' else 'manual' end,
    m.source,
    m.entered_by,
    null::text,
    m.created_at
  from public.body_measurements m
  join public.body_measurement_values v on v.measurement_id = m.id
  where v.metric_key in ('weight_kg', 'body_fat_pct', 'smm_kg');

revoke all on public.metric_entries from anon, authenticated, service_role;
grant select on public.metric_entries to authenticated, service_role;

-- sync_apple_health_metrics(p_workspace_id, p_samples): the phone's Apple Health import for the signed-in client.
--   p_samples = [{ external_id, metric_key, value, measured_on 'YYYY-MM-DD', measured_at? }], at most 500 per call.
-- Adds new samples and updates ones already imported (matched by workspace + client + source + external_id), so a
-- re-sync never duplicates. The same external_id twice in one call keeps the later one. Security invoker: it runs with the caller's own rights, so the insert and update
-- policies above apply to every row; a coach or anyone else gets a permission error. Returns how many rows it
-- added or changed.
create function public.sync_apple_health_metrics(p_workspace_id uuid, p_samples jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Sign in to import from Apple Health.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_samples) is distinct from 'array' then
    raise exception 'Samples are not valid.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_samples) > 500 then
    raise exception 'Send at most 500 samples at a time.' using errcode = '22023';
  end if;

  insert into public.body_metrics as b
    (workspace_id, client_id, metric_key, value, measured_on, measured_at, source, entered_by_role, entered_by,
     external_id)
  select distinct on (s.external_id) p_workspace_id, v_uid, s.metric_key, s.value, s.measured_on, s.measured_at,
    'apple_health', 'client', v_uid, s.external_id
  from rows from (jsonb_to_recordset(p_samples)
      as (external_id text, metric_key text, value numeric, measured_on date, measured_at timestamptz))
    with ordinality as s(external_id, metric_key, value, measured_on, measured_at, n)
  order by s.external_id, s.n desc
  on conflict (workspace_id, client_id, source, external_id) do update
    set value = excluded.value, measured_on = excluded.measured_on, measured_at = excluded.measured_at
    where (b.value, b.measured_on, b.measured_at) is distinct from
      (excluded.value, excluded.measured_on, excluded.measured_at);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.sync_apple_health_metrics(uuid, jsonb) from public, anon;
grant execute on function public.sync_apple_health_metrics(uuid, jsonb) to authenticated;
