-- Client push notifications, part 1: devices, preferences and the outbox.
-- Spec: docs/superpowers/specs/2026-11-09-client-push-notifications-design.md
-- Plan: docs/superpowers/plans/2026-11-09-client-push-notifications.md (Task 1)
--
-- push_devices       APNs device tokens; a user sees only their own, writes go through register/unregister.
-- notification_prefs one row per user (no row = all defaults); the client edits their own row.
-- push_outbox        notifications waiting to be sent; written by security definer triggers and the sender only,
--                    never readable by clients.
-- The user's time zone is profiles.time_zone (kept current by the phone), with public.client_zone()'s coach
-- fallback, so notification_prefs has no time_zone column.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- 1. Devices --------------------------------------------------------------------------------------------------------

create table public.push_devices (
  token text primary key check (token ~ '^[0-9a-f]{64,200}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null default 'ios' check (platform = 'ios'),
  app_version text check (char_length(app_version) <= 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_devices_user_id_idx on public.push_devices (user_id);

revoke all on table public.push_devices from anon, authenticated, service_role;
grant select on public.push_devices to authenticated;
grant select, insert, update, delete on public.push_devices to service_role;
alter table public.push_devices enable row level security;
create policy push_devices_select_own on public.push_devices
  for select to authenticated using (user_id = (select auth.uid()));

-- Registers the caller's device token. A token belongs to one iPhone, so registering it moves it from whichever
-- user had it (e.g. after signing out and in as someone else): the old account's pushes never reach this phone.
create function public.register_push_device(p_token text, p_app_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.push_devices (token, user_id, app_version)
  values (p_token, v_uid, p_app_version)
  on conflict (token) do update
    set user_id = excluded.user_id, app_version = excluded.app_version, updated_at = now();
end;
$$;
revoke execute on function public.register_push_device(text, text) from public, anon, authenticated;
grant execute on function public.register_push_device(text, text) to authenticated;

create function public.unregister_push_device(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.push_devices d where d.token = p_token and d.user_id = auth.uid();
end;
$$;
revoke execute on function public.unregister_push_device(text) from public, anon, authenticated;
grant execute on function public.unregister_push_device(text) to authenticated;

-- 2. Preferences ----------------------------------------------------------------------------------------------------

create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Type keys switched off. Mirrors PUSH_TYPES in packages/shared/src/push/catalogue.ts.
  disabled text[] not null default '{}' check (disabled <@ array[
    'workout_assigned', 'workout_changed', 'daily_reminder', 'coach_logged', 'still_training', 'message',
    'workout_comment', 'meal_comment', 'food_targets', 'community_coach_post', 'community_activity'
  ]::text[]),
  reminder_time time not null default '08:00',
  quiet_enabled boolean not null default true,
  quiet_start time not null default '22:00',
  quiet_end time not null default '07:00',
  updated_at timestamptz not null default now()
);

revoke all on table public.notification_prefs from anon, authenticated, service_role;
grant select on public.notification_prefs to authenticated;
-- user_id is not insertable: it defaults to the caller.
grant insert (disabled, reminder_time, quiet_enabled, quiet_start, quiet_end) on public.notification_prefs to authenticated;
grant update (disabled, reminder_time, quiet_enabled, quiet_start, quiet_end) on public.notification_prefs to authenticated;
grant select, insert, update, delete on public.notification_prefs to service_role;
alter table public.notification_prefs enable row level security;
create policy notification_prefs_select_own on public.notification_prefs
  for select to authenticated using (user_id = (select auth.uid()));
create policy notification_prefs_insert_own on public.notification_prefs
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy notification_prefs_update_own on public.notification_prefs
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.touch_notification_prefs() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.touch_notification_prefs() from public, anon, authenticated;
create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.touch_notification_prefs();

-- 3. Outbox ---------------------------------------------------------------------------------------------------------

create table public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  -- Every server-sent type (still_training is on-device only).
  type text not null check (type in (
    'workout_assigned', 'workout_changed', 'daily_reminder', 'coach_logged', 'message', 'workout_comment',
    'meal_comment', 'food_targets', 'community_coach_post', 'community_activity'
  )),
  group_key text not null,
  title text,
  body text,
  data jsonb not null default '{}',
  not_before timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  claimed_until timestamptz,
  outcome text check (outcome in ('sent', 'disabled', 'no_device', 'expired', 'failed'))
);
create index push_outbox_due_idx on public.push_outbox (not_before) where sent_at is null;
create index push_outbox_created_at_idx on public.push_outbox (created_at); -- the hourly clean-up
create index push_outbox_pending_group_idx on public.push_outbox (user_id, group_key) where sent_at is null;
create unique index push_outbox_daily_reminder_key on public.push_outbox (user_id, group_key)
  where type = 'daily_reminder';

revoke all on table public.push_outbox from anon, authenticated, service_role;
grant select, insert, update, delete on public.push_outbox to service_role;
alter table public.push_outbox enable row level security;
-- No policies: only security definer functions and the service role touch the outbox.

-- 4. Helpers for the triggers (private, not callable through the API) ---------------------------------------------

-- Queues a push for p_user if they are a client of p_workspace (a no-op otherwise).
-- p_dedupe: an unsent row with the same group key just takes the new data (one pending "Today's workout changed").
-- Otherwise a new row is added; it shares the send time of an unsent row with the same key, so a burst of
-- reactions goes out together when the first one's gathering window ends.
-- Rows the sender gave up on (5 attempts) are dead and never joined.
create function private.push_enqueue(
  p_user uuid, p_workspace uuid, p_type text, p_group_key text, p_data jsonb,
  p_delay interval default '0', p_dedupe boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pending uuid;
  v_not_before timestamptz;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_user and m.role = 'client'
  ) then
    return;
  end if;

  if p_dedupe then
    select o.id into v_pending from public.push_outbox o
    where o.user_id = p_user and o.group_key = p_group_key and o.sent_at is null and o.attempts < 5
    order by o.created_at
    limit 1
    for update;
    if v_pending is not null then
      update public.push_outbox set data = coalesce(p_data, '{}') where id = v_pending;
      return;
    end if;
  end if;

  select min(o.not_before) into v_not_before from public.push_outbox o
  where o.user_id = p_user and o.group_key = p_group_key and o.sent_at is null and o.attempts < 5;

  insert into public.push_outbox (user_id, workspace_id, type, group_key, data, not_before)
  values (p_user, p_workspace, p_type, p_group_key, coalesce(p_data, '{}'),
    coalesce(v_not_before, now() + coalesce(p_delay, interval '0')));
end;
$$;
revoke execute on function private.push_enqueue(uuid, uuid, text, text, jsonb, interval, boolean)
  from public, anon, authenticated, service_role;

-- True when p_user is the owner or staff of p_workspace.
create function private.push_is_coach(p_workspace uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_user and m.role in ('owner', 'staff')
  );
$$;
revoke execute on function private.push_is_coach(uuid, uuid) from public, anon, authenticated, service_role;

-- The name a push shows: first_name, else the first word of full_name, else ''.
create function private.push_first_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select coalesce(nullif(btrim(p.first_name), ''), nullif(split_part(btrim(p.full_name), ' ', 1), ''), '')
     from public.profiles p where p.id = p_user),
    ''
  );
$$;
revoke execute on function private.push_first_name(uuid) from public, anon, authenticated, service_role;
