-- Body scans (InBody) and client-logged weight. A measurement is a dated header plus one row per metric.
-- Built-in metric keys and ranges mirror METRICS in packages/shared/src/body/metrics.ts; custom metrics use
-- the key custom:<uuid> and carry their own range. Nobody writes the measurement tables directly: every
-- create and edit goes through save_body_measurement (below), which checks the ranges and who may write what.

create table public.custom_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  unit_label text not null default '' check (char_length(unit_label) <= 10),
  min numeric not null,
  max numeric not null,
  -- An archived metric keeps its history but disappears from the scan form.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (min < max)
);
create unique index custom_metrics_name_idx on public.custom_metrics (workspace_id, lower(name));

create table public.body_measurements (
  id uuid primary key default gen_random_uuid(), -- may be generated on the phone
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  measured_on date not null,
  entered_by uuid default auth.uid() references auth.users on delete set null,
  source text not null check (source in ('coach', 'client')),
  -- {workspace_id}/{client_id}/{uuid}.{webp|pdf} in the scan-attachments bucket.
  attachment_path text check (attachment_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|pdf)$'),
  created_at timestamptz not null default now()
);
create index body_measurements_client_idx on public.body_measurements (client_id, measured_on desc);
create index body_measurements_workspace_idx on public.body_measurements (workspace_id);
create index body_measurements_entered_by_idx on public.body_measurements (entered_by);

create table public.body_measurement_values (
  measurement_id uuid not null references public.body_measurements on delete cascade,
  -- No foreign key for custom:<uuid> keys: the metric lives in custom_metrics, which is only archived, never
  -- deleted except with its workspace, and save_body_measurement checks it exists on every write.
  metric_key text not null check (metric_key ~ '^(weight_kg|body_fat_pct|smm_kg|lbm_kg|bmi|visceral_fat|bmr_kcal|custom:[0-9a-f-]{36})$'),
  value numeric not null,
  primary key (measurement_id, metric_key)
);

-- Privileges: nothing for anon. authenticated reads, and deletes measurements (RLS decides which);
-- all creates and edits go through save_body_measurement. Coaches manage custom metrics directly (no delete: archive).
revoke all on table public.custom_metrics, public.body_measurements, public.body_measurement_values
  from anon, authenticated, service_role;
grant select on public.custom_metrics, public.body_measurements, public.body_measurement_values to authenticated;
grant delete on public.body_measurements to authenticated;
grant insert (workspace_id, name, unit_label, min, max) on public.custom_metrics to authenticated;
grant update (name, unit_label, min, max, archived_at) on public.custom_metrics to authenticated;
grant select, insert, update, delete on public.custom_metrics, public.body_measurements,
  public.body_measurement_values to service_role;

alter table public.custom_metrics enable row level security;
alter table public.body_measurements enable row level security;
alter table public.body_measurement_values enable row level security;

-- Custom metrics: the coach manages them; clients of the workspace read them (names and units for their charts).
create policy custom_metrics_select on public.custom_metrics for select to authenticated
  using (public.is_member_of(workspace_id));
create policy custom_metrics_insert on public.custom_metrics for insert to authenticated
  with check (public.is_coach_of(workspace_id));
create policy custom_metrics_update on public.custom_metrics for update to authenticated
  using (public.is_coach_of(workspace_id)) with check (public.is_coach_of(workspace_id));

-- Measurements: coaches see every scan in their workspace (including removed clients' history);
-- a client sees only their own, and only while still a client of that workspace.
create policy body_measurements_select on public.body_measurements for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));

-- A coach deletes any scan. A client deletes only a weight entry they made themselves.
create policy body_measurements_delete on public.body_measurements for delete to authenticated
  using (public.is_coach_of(workspace_id)
    or (source = 'client' and client_id = (select auth.uid()) and entered_by = (select auth.uid())
      and public.is_client_in(workspace_id, client_id)));

-- Values are visible exactly when their measurement is (the parent's RLS applies inside the subquery).
create policy body_measurement_values_select on public.body_measurement_values for select to authenticated
  using (exists (select 1 from public.body_measurements m where m.id = measurement_id));

-- save_body_measurement(p): create or edit a measurement in one transaction.
--   p = { id?, workspace_id, client_id, measured_on 'YYYY-MM-DD', values: { metric_key: number },
--         attachment_path? (omit to keep the current one, null to clear) }
-- Security definer, because nobody has write privileges on the tables. So it checks everything itself:
--   * the caller is a coach of the workspace (source 'coach'), or the client themself (source 'client');
--   * client_id is a current client of the workspace;
--   * a client may save only weight_kg, no attachment, and only edit a row they entered as source 'client'
--     (a coach scan is refused with 42501); a coach cannot save onto a client-entered row (42501, "Add a new
--     scan instead."), so a client's entries stay weight-only and the client's own;
--   * at least one value; every value is a number inside its range (built-in, or the custom metric's own);
--     out of range, unknown key, missing custom metric or a future date give 23514;
--   * an archived custom metric cannot get a new value, but keeps (and may re-save) one it already has;
--   * the date is from 2000-01-01 and not in the future (one day of slack past today in UTC, for time zones
--     ahead of UTC).
create function public.save_body_measurement(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid;
  v_client uuid;
  v_id uuid;
  v_on date;
  v_is_coach boolean;
  v_row public.body_measurements;
  v_attach text;
  v_set_attach boolean := false;
  v_vals jsonb;
  v_key text;
  v_val jsonb;
  v_num numeric;
  v_min numeric;
  v_max numeric;
  v_cm public.custom_metrics;
begin
  if v_uid is null then
    raise exception 'Sign in to save a measurement.' using errcode = '42501';
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Measurement is not valid.' using errcode = '22023';
  end if;

  begin
    v_ws := (p ->> 'workspace_id')::uuid;
    v_client := (p ->> 'client_id')::uuid;
    v_id := coalesce((p ->> 'id')::uuid, gen_random_uuid());
    v_on := (p ->> 'measured_on')::date;
  exception when others then
    raise exception 'Measurement is not valid.' using errcode = '22023';
  end;
  if v_ws is null or v_client is null or v_on is null then
    raise exception 'Measurement is not valid.' using errcode = '22023';
  end if;

  v_is_coach := public.is_coach_of(v_ws);
  if not (v_is_coach or v_uid = v_client) or not public.is_client_in(v_ws, v_client) then
    raise exception 'You cannot save measurements for this client.' using errcode = '42501';
  end if;

  if v_on > (now() at time zone 'utc')::date + 1 or v_on < date '2000-01-01' then
    raise exception 'The date is not valid.' using errcode = '23514';
  end if;

  v_vals := p -> 'values';
  if jsonb_typeof(v_vals) is distinct from 'object' or v_vals = '{}'::jsonb then
    raise exception 'Enter at least one value.' using errcode = '23514';
  end if;

  if p ? 'attachment_path' then
    v_set_attach := true;
    if not v_is_coach then
      raise exception 'Only the coach can attach a printout.' using errcode = '42501';
    end if;
    v_attach := case when jsonb_typeof(p -> 'attachment_path') = 'null' then null else p ->> 'attachment_path' end;
    if v_attach is not null and v_attach not like v_ws::text || '/' || v_client::text || '/%' then
      raise exception 'The printout does not belong to this client.' using errcode = '23514';
    end if;
  end if;

  -- An existing row: lock it, and check the caller may change it.
  select * into v_row from public.body_measurements m where m.id = v_id for update;
  if found then
    if v_row.workspace_id <> v_ws or v_row.client_id <> v_client then
      raise exception 'You cannot save measurements for this client.' using errcode = '42501';
    end if;
    if v_is_coach and v_row.source = 'client' then
      raise exception 'Add a new scan instead.' using errcode = '42501';
    end if;
    if not v_is_coach and (v_row.source <> 'client' or v_row.entered_by is distinct from v_uid) then
      raise exception 'You can only change your own weight entries.' using errcode = '42501';
    end if;
  end if;

  for v_key, v_val in select * from jsonb_each(v_vals) loop
    if jsonb_typeof(v_val) <> 'number' then
      raise exception 'Each value must be a number.' using errcode = '23514';
    end if;
    v_num := (v_val #>> '{}')::numeric;
    if not v_is_coach and v_key <> 'weight_kg' then
      raise exception 'Clients can only log their weight.' using errcode = '42501';
    end if;

    if v_key like 'custom:%' then
      begin
        select * into v_cm from public.custom_metrics c
        where c.id = substr(v_key, 8)::uuid and c.workspace_id = v_ws;
      exception when others then
        v_cm := null;
      end;
      if v_cm.id is null then
        raise exception 'Unknown measure %.', v_key using errcode = '23514';
      end if;
      if v_cm.archived_at is not null and not exists (
        select 1 from public.body_measurement_values x where x.measurement_id = v_id and x.metric_key = v_key) then
        raise exception '% is archived.', v_cm.name using errcode = '23514';
      end if;
      v_min := v_cm.min;
      v_max := v_cm.max;
    else
      select r.lo, r.hi into v_min, v_max from (values
        ('weight_kg', 20, 400), ('body_fat_pct', 2, 75), ('smm_kg', 5, 120), ('lbm_kg', 10, 250),
        ('bmi', 10, 80), ('visceral_fat', 1, 20), ('bmr_kcal', 500, 5000)
      ) as r(k, lo, hi) where r.k = v_key;
      if v_min is null then
        raise exception 'Unknown measure %.', v_key using errcode = '23514';
      end if;
    end if;

    if v_num < v_min or v_num > v_max then
      raise exception '% must be between % and %.', v_key, v_min, v_max using errcode = '23514';
    end if;
  end loop;

  if v_row.id is null then
    insert into public.body_measurements (id, workspace_id, client_id, measured_on, entered_by, source, attachment_path)
    values (v_id, v_ws, v_client, v_on, v_uid, case when v_is_coach then 'coach' else 'client' end,
      case when v_set_attach then v_attach end);
  else
    update public.body_measurements m
    set measured_on = v_on,
        attachment_path = case when v_set_attach then v_attach else m.attachment_path end
    where m.id = v_id;
  end if;

  delete from public.body_measurement_values x
  where x.measurement_id = v_id and not (v_vals ? x.metric_key);
  insert into public.body_measurement_values (measurement_id, metric_key, value)
  select v_id, e.key, (e.value #>> '{}')::numeric from jsonb_each(v_vals) e
  on conflict (measurement_id, metric_key) do update set value = excluded.value;

  return v_id;
end;
$$;
revoke execute on function public.save_body_measurement(jsonb) from public, anon;
grant execute on function public.save_body_measurement(jsonb) to authenticated;

-- Private bucket for InBody printouts: images (WebP) and PDFs, at most 5 MB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-attachments', 'scan-attachments', false, 5242880, array['image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/webp', 'application/pdf'];

-- Path parts as uuids, or null when the path is not {workspace}/{client}/{uuid}.{webp|pdf}.
create function public.scan_path_workspace(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|pdf)$'
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 1)::uuid end;
$$;
create function public.scan_path_client(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|pdf)$'
    and split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 2)::uuid end;
$$;
revoke execute on function public.scan_path_workspace(text), public.scan_path_client(text) from public, anon;
grant execute on function public.scan_path_workspace(text), public.scan_path_client(text) to authenticated;

-- The coach of the workspace and that client read; only the coach writes.
create policy scan_attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'scan-attachments' and (
    public.is_coach_of(public.scan_path_workspace(name))
    or (public.scan_path_client(name) = (select auth.uid())
      and public.is_client_in(public.scan_path_workspace(name), public.scan_path_client(name)))));
create policy scan_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'scan-attachments'
    and public.is_coach_of(public.scan_path_workspace(name))
    and public.is_client_in(public.scan_path_workspace(name), public.scan_path_client(name)));
create policy scan_attachments_update on storage.objects for update to authenticated
  using (bucket_id = 'scan-attachments' and public.is_coach_of(public.scan_path_workspace(name)))
  with check (bucket_id = 'scan-attachments'
    and public.is_coach_of(public.scan_path_workspace(name))
    and public.is_client_in(public.scan_path_workspace(name), public.scan_path_client(name)));
create policy scan_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'scan-attachments' and public.is_coach_of(public.scan_path_workspace(name)));

-- Printout files are not removed by SQL: deleting rows from storage.objects leaves the real files behind.
-- Whatever deletes a scan or a workspace removes the files through the Storage API (see the plan).
