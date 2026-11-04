-- First and last name: at most 100 characters each (the apps already enforce NAME_MAX_LENGTH = 100), and trimming
-- that matches JavaScript's trim() (tabs and newlines too, not only spaces).

-- Stop with a clear message instead of a bare constraint error if any existing row is too long.
do $$
begin
  if exists (select 1 from public.profiles where char_length(first_name) > 100 or char_length(last_name) > 100)
     or exists (select 1 from public.client_invites
                where char_length(first_name) > 100 or char_length(last_name) > 100) then
    raise exception 'A first or last name is longer than 100 characters; shorten it before applying this migration';
  end if;
end;
$$;

alter table public.profiles
  add constraint profiles_name_length check (char_length(first_name) <= 100 and char_length(last_name) <= 100);
alter table public.client_invites
  add constraint client_invites_name_length
  check (char_length(first_name) <= 100 and char_length(last_name) <= 100);

-- Same split rule as before; only the trim changed (btrim removed spaces only).
create or replace function public.split_full_name(name text) returns text[]
language sql immutable set search_path = '' as $$
  select regexp_match(regexp_replace(coalesce(name, ''), '^\s+|\s+$', '', 'g'), '^(\S*)\s*(.*)$');
$$;
revoke execute on function public.split_full_name(text) from public, anon, authenticated;

-- Sign-up: trim like JS, and cut names to 100 characters so a long name never makes sign-up fail
-- (the apps already stop longer names; this only matters for direct API calls).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_first text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'first_name', ''), '^\s+|\s+$', '', 'g');
  v_last text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'last_name', ''), '^\s+|\s+$', '', 'g');
  v_split text[];
begin
  if v_first = '' and v_last = '' then
    v_split := public.split_full_name(new.raw_user_meta_data ->> 'full_name');
    v_first := v_split[1];
    v_last := v_split[2];
  end if;
  insert into public.profiles (id, first_name, last_name)
  values (new.id, left(v_first, 100), left(v_last, 100));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
