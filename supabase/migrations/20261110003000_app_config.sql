-- App config: one public row the phone reads at launch to decide whether this build is too old to use.
--   ios_min_build    builds below this see the "update the app" screen (0 = nobody is blocked);
--   ios_latest_build the newest build testers can install (shown on that screen);
--   ios_update_url   where its "Open TestFlight" button goes.
-- Anyone may read it, signed in or not (the screen also covers sign-in). Only service_role and postgres (the SQL
-- editor) may change it: see docs/runbooks/staging.md, "Releasing a phone build".

create table public.app_config (
  id boolean primary key default true check (id), -- a single row
  ios_min_build int not null default 0 check (ios_min_build >= 0),
  ios_latest_build int not null default 0 check (ios_latest_build >= 0),
  ios_update_url text not null default 'https://testflight.apple.com/join/b9sDKA2B',
  updated_at timestamptz not null default now()
);

insert into public.app_config default values;

create trigger app_config_touch_updated_at before update on public.app_config
  for each row execute function public.touch_updated_at();

revoke all on table public.app_config from anon, authenticated, service_role;
grant select on public.app_config to anon, authenticated;
grant select, insert, update, delete on public.app_config to service_role;

alter table public.app_config enable row level security;

create policy app_config_read on public.app_config for select to anon, authenticated using (true);
