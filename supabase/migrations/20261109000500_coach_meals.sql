-- Coach shared meals (docs/superpowers/specs/2026-11-09-food-and-coach-meals-design.md): a recipe list the coach
-- shares with every client of the workspace. Not meal plans: no schedule, no days, no assignment, no targets.
-- Clients log one by copying its name and numbers into their own meal, which keeps a link back (coach_meal_id).
-- Limits mirror packages/shared/src/food/coach-meals.ts.

create table public.coach_meals (
  -- Made in the browser, so the photo path can include it before the row exists.
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  -- Same limit as meals.name, since logging copies it there.
  name text not null check (char_length(name) between 1 and 40 and name = btrim(name)),
  calories numeric(5, 0) check (calories between 0 and 10000),
  protein_g numeric(5, 1) check (protein_g between 0 and 1000),
  carbs_g numeric(5, 1) check (carbs_g between 0 and 1000),
  fat_g numeric(5, 1) check (fat_g between 0 and 1000),
  ingredients text not null default '' check (char_length(ingredients) <= 2000),
  how_to text not null default '' check (char_length(how_to) <= 4000),
  -- {workspace_id}/{id}-{photo id}.{webp|jpg} and {…}-thumb.{same ext} in the coach-meal-photos bucket. A replaced
  -- photo gets new files (its own photo id) and the old ones are deleted.
  photo_path text,
  photo_thumb_path text,
  photo_width integer check (photo_width between 1 and 1600),
  photo_height integer check (photo_height between 1 and 1600),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Removing a meal sets this: clients stop seeing it, meals already logged from it keep their link.
  deleted_at timestamptz,
  unique (workspace_id, id),
  check ((photo_path is null) = (photo_thumb_path is null)),
  check ((photo_width is null) = (photo_height is null)),
  check ((photo_path is null) = (photo_width is null)),
  check (photo_path is null
    or photo_path ~ ('^' || workspace_id::text || '/' || id::text
      || '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$')),
  check (photo_thumb_path is null
    or photo_thumb_path = regexp_replace(photo_path, '\.(webp|jpg)$', '-thumb.\1'))
);
create index coach_meals_created_by_idx on public.coach_meals (created_by);

create function public.coach_meals_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger coach_meals_before_write before insert or update on public.coach_meals
  for each row execute function public.coach_meals_before_write();

-- The client's meal links the coach meal it was logged from. Same workspace only (composite FK, 23503 otherwise).
-- Rows are never hard-deleted by users; if the workspace goes, the link is cleared (and the meals go with it anyway).
alter table public.meals add column coach_meal_id uuid;
alter table public.meals add constraint meals_coach_meal_fk foreign key (workspace_id, coach_meal_id)
  references public.coach_meals (workspace_id, id) on delete set null (coach_meal_id);
create index meals_coach_meal_idx on public.meals (coach_meal_id);
grant insert (coach_meal_id), update (coach_meal_id) on public.meals to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------------------------
revoke all on table public.coach_meals from anon, authenticated, service_role;
grant select on public.coach_meals to authenticated;
grant insert (id, workspace_id, name, calories, protein_g, carbs_g, fat_g, ingredients, how_to,
  photo_path, photo_thumb_path, photo_width, photo_height) on public.coach_meals to authenticated;
grant update (name, calories, protein_g, carbs_g, fat_g, ingredients, how_to,
  photo_path, photo_thumb_path, photo_width, photo_height, deleted_at) on public.coach_meals to authenticated;
grant select, insert, update, delete on public.coach_meals to service_role;
revoke execute on function public.coach_meals_before_write() from public, anon, authenticated;

alter table public.coach_meals enable row level security;

-- The coach sees every meal (removed ones too); a current client sees the live ones. Only the coach writes.
create policy coach_meals_select on public.coach_meals for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (deleted_at is null and public.is_client_in(workspace_id, (select auth.uid()))));
create policy coach_meals_insert on public.coach_meals for insert to authenticated
  with check (public.is_coach_of(workspace_id));
create policy coach_meals_update on public.coach_meals for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id));

-- How often each coach meal was logged. Runs as the caller, so meals RLS decides: the coach counts every client's
-- meals (current or past), a client only their own, anyone else nothing.
create function public.coach_meal_log_counts(p_workspace_id uuid)
returns table (coach_meal_id uuid, logged bigint)
language sql stable security invoker set search_path = '' as $$
  select m.coach_meal_id, count(*)
  from public.meals m
  where m.workspace_id = p_workspace_id and m.coach_meal_id is not null
  group by m.coach_meal_id;
$$;
revoke execute on function public.coach_meal_log_counts(uuid) from public, anon;
grant execute on function public.coach_meal_log_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Storage: coach-meal-photos, {workspace}/{meal}-{photo}.{webp|jpg} and {…}-thumb.{ext}. Any member of the
-- workspace (coach or current client) reads; only its coach uploads and deletes. False for anything malformed.
-- ---------------------------------------------------------------------------------------------------------------
create function public.can_access_coach_meal_photo(p_name text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-thumb)?\.(webp|jpg)$'
    then
      case when p_write then public.is_coach_of(split_part(p_name, '/', 1)::uuid)
        else public.is_member_of(split_part(p_name, '/', 1)::uuid) end
    else false
  end;
$$;
revoke execute on function public.can_access_coach_meal_photo(text, boolean) from public, anon, authenticated;
grant execute on function public.can_access_coach_meal_photo(text, boolean) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coach-meal-photos', 'coach-meal-photos', false, 3145728, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/webp', 'image/jpeg'];

create policy coach_meal_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'coach-meal-photos' and public.can_access_coach_meal_photo(name, false));
create policy coach_meal_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'coach-meal-photos' and public.can_access_coach_meal_photo(name, true));
create policy coach_meal_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'coach-meal-photos' and public.can_access_coach_meal_photo(name, true));
