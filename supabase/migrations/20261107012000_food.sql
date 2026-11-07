-- Food tab (docs/superpowers/specs/2026-11-07-food-design.md): clients log meals (a photo, macros, or both);
-- coaches set daily targets per client and read the meals. Limits mirror packages/shared/src/food/food.ts.

-- ---------------------------------------------------------------------------------------------------------------
-- Meals: the client's own. The id is made on the phone, so a repeated offline save finds its row (23505) and
-- updates it instead of adding a second meal.
-- ---------------------------------------------------------------------------------------------------------------
create table public.meals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  -- Always the caller on insert (no column privilege, so the default applies).
  client_id uuid not null default auth.uid() references auth.users on delete cascade,
  eaten_at timestamptz not null default now(),
  -- The client's local day, set by the phone. Within a day of eaten_at (time zones run from UTC-12 to UTC+14).
  eaten_on date not null,
  name text check (name is null or (char_length(name) between 1 and 40 and name = btrim(name))),
  note text not null default '' check (char_length(note) <= 500),
  calories numeric(5, 0) check (calories between 0 and 10000),
  protein_g numeric(5, 1) check (protein_g between 0 and 1000),
  carbs_g numeric(5, 1) check (carbs_g between 0 and 1000),
  fat_g numeric(5, 1) check (fat_g between 0 and 1000),
  -- {workspace_id}/{client_id}/{id}-{photo id}.{webp|jpg} and {…}-thumb.{same ext} in the meal-photos bucket. Each photo
  -- has its own id, so a replaced photo gets new files (uploads never overwrite) and the old ones are deleted.
  photo_path text,
  photo_thumb_path text,
  -- The stored photo's size (at most 1600 px on the long edge), so the coach page reserves its shape.
  photo_width integer check (photo_width between 1 and 1600),
  photo_height integer check (photo_height between 1 and 1600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (eaten_on between (eaten_at at time zone 'utc')::date - 1 and (eaten_at at time zone 'utc')::date + 1),
  check ((photo_path is null) = (photo_thumb_path is null)),
  check ((photo_width is null) = (photo_height is null)),
  check (photo_path is null
    or photo_path ~ ('^' || workspace_id::text || '/' || client_id::text || '/' || id::text
      || '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$')),
  check (photo_thumb_path is null
    or photo_thumb_path = regexp_replace(photo_path, '\.(webp|jpg)$', '-thumb.\1')),
  -- A meal is a photo, macros, or both (a note alone is not a meal).
  check (photo_path is not null or calories is not null or protein_g is not null or carbs_g is not null or fat_g is not null)
);

create index meals_client_day_idx on public.meals (client_id, eaten_on);
create index meals_workspace_client_day_idx on public.meals (workspace_id, client_id, eaten_on);

-- Stamps updated_at, and refuses a meal more than a day in the future (23514).
create function public.meals_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.eaten_at > now() + interval '1 day' or new.eaten_at < timestamptz '2000-01-01' then
    raise exception 'The meal time is not valid.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger meals_before_write before insert or update on public.meals
  for each row execute function public.meals_before_write();

-- ---------------------------------------------------------------------------------------------------------------
-- Daily targets: one row per client, set by the coach. Any target may be blank.
-- ---------------------------------------------------------------------------------------------------------------
create table public.nutrition_targets (
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  calories numeric(5, 0) check (calories between 0 and 10000),
  protein_g numeric(5, 1) check (protein_g between 0 and 1000),
  carbs_g numeric(5, 1) check (carbs_g between 0 and 1000),
  fat_g numeric(5, 1) check (fat_g between 0 and 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null,
  primary key (workspace_id, client_id)
);
create index nutrition_targets_client_idx on public.nutrition_targets (client_id);
create index nutrition_targets_updated_by_idx on public.nutrition_targets (updated_by);

create function public.nutrition_targets_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;
create trigger nutrition_targets_before_write before insert or update on public.nutrition_targets
  for each row execute function public.nutrition_targets_before_write();

-- Sets (or clears, with nulls) a client's targets. Runs as the caller, so the table's RLS decides: only a coach of
-- the workspace, for a current client of it (42501 otherwise). Out-of-range values give 23514.
create function public.set_nutrition_targets(
  p_workspace_id uuid, p_client_id uuid,
  p_calories numeric, p_protein_g numeric, p_carbs_g numeric, p_fat_g numeric
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not (public.is_coach_of(p_workspace_id) and public.is_client_in(p_workspace_id, p_client_id)) then
    raise exception 'You cannot set targets for this client.' using errcode = '42501';
  end if;
  insert into public.nutrition_targets (workspace_id, client_id, calories, protein_g, carbs_g, fat_g)
  values (p_workspace_id, p_client_id, p_calories, p_protein_g, p_carbs_g, p_fat_g)
  on conflict (workspace_id, client_id) do update
    set calories = excluded.calories, protein_g = excluded.protein_g,
        carbs_g = excluded.carbs_g, fat_g = excluded.fat_g;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------------------------
revoke all on table public.meals, public.nutrition_targets from anon, authenticated, service_role;
grant select, delete on public.meals to authenticated;
grant insert (id, workspace_id, eaten_at, eaten_on, name, note, calories, protein_g, carbs_g, fat_g,
  photo_path, photo_thumb_path, photo_width, photo_height) on public.meals to authenticated;
grant update (eaten_at, eaten_on, name, note, calories, protein_g, carbs_g, fat_g,
  photo_path, photo_thumb_path, photo_width, photo_height) on public.meals to authenticated;
grant select on public.nutrition_targets to authenticated;
grant insert (workspace_id, client_id, calories, protein_g, carbs_g, fat_g) on public.nutrition_targets to authenticated;
grant update (calories, protein_g, carbs_g, fat_g) on public.nutrition_targets to authenticated;
grant select, insert, update, delete on public.meals, public.nutrition_targets to service_role;

revoke execute on function public.meals_before_write(), public.nutrition_targets_before_write(),
  public.set_nutrition_targets(uuid, uuid, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.set_nutrition_targets(uuid, uuid, numeric, numeric, numeric, numeric) to authenticated;

alter table public.meals enable row level security;
alter table public.nutrition_targets enable row level security;

-- Meals: the coach reads every meal in the workspace (a past client's too); the client reads and writes only their
-- own, and only while still a client of that workspace. Coaches never write meals.
create policy meals_select on public.meals for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy meals_insert on public.meals for insert to authenticated
  with check (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id));
create policy meals_update on public.meals for update to authenticated
  using (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id))
  with check (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id));
create policy meals_delete on public.meals for delete to authenticated
  using (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id));

-- Targets: the coach reads and writes them for current clients; the client reads only their own.
create policy nutrition_targets_select on public.nutrition_targets for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy nutrition_targets_insert on public.nutrition_targets for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy nutrition_targets_update on public.nutrition_targets for update to authenticated
  using (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id))
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));

-- ---------------------------------------------------------------------------------------------------------------
-- Storage: meal-photos, {workspace}/{client}/{meal}-{photo}.{webp|jpg} and {meal}-{photo}-thumb.{ext}. The client uploads and
-- deletes in their own folder while a client of the workspace; the coach of the workspace and the client read.
-- False (never an error) for anything malformed.
-- ---------------------------------------------------------------------------------------------------------------
create function public.can_access_meal_photo(p_name text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-thumb)?\.(webp|jpg)$'
    then
      (split_part(p_name, '/', 2) = (select auth.uid())::text
        and public.is_client_in(split_part(p_name, '/', 1)::uuid, (select auth.uid())))
      or (not p_write and public.is_coach_of(split_part(p_name, '/', 1)::uuid))
    else false
  end;
$$;
revoke execute on function public.can_access_meal_photo(text, boolean) from public, anon, authenticated;
-- The storage policies run as the caller, so they need it.
grant execute on function public.can_access_meal_photo(text, boolean) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 3145728, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/webp', 'image/jpeg'];

create policy meal_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'meal-photos' and public.can_access_meal_photo(name, false));
create policy meal_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'meal-photos' and public.can_access_meal_photo(name, true));
create policy meal_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'meal-photos' and public.can_access_meal_photo(name, true));
