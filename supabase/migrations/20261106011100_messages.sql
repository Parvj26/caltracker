-- Messages (docs/superpowers/specs/2026-11-05-messages-design.md): one private conversation per coach-client pair.
-- Removed clients: removing deletes the membership (see remove_client). The conversation rows stay, so the coach can
-- still read the history, but nobody can post once the client is not a current member, and the client loses access.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  -- Null until the first message; the inbox sorts on it.
  last_message_at timestamptz,
  unique (workspace_id, client_id)
);

create index conversations_inbox_idx on public.conversations (workspace_id, last_message_at desc nulls last);
create index conversations_client_idx on public.conversations (client_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations on delete cascade,
  -- Copied from the conversation by a trigger, whatever the insert said.
  workspace_id uuid not null references public.workspaces on delete cascade,
  -- Always the caller on insert (no column privilege, so the default applies).
  sender_id uuid not null default auth.uid() references auth.users on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  image_paths text[] not null default '{}'
    check (cardinality(image_paths) <= 4 and array_position(image_paths, null) is null),
  -- Generated on the phone/browser; a retry of the same send is a no-op.
  client_msg_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  check (body ~ '\S' or cardinality(image_paths) > 0),
  unique (sender_id, client_msg_id)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at, id);
create index messages_workspace_idx on public.messages (workspace_id);

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index conversation_reads_user_idx on public.conversation_reads (user_id);

-- Access helpers (definer so they read the tables regardless of the caller's RLS).
-- Read: the workspace's coach (owner or staff, even for a removed client's history), or the conversation's client
-- while they are still a client of that workspace.
create function public.can_read_conversation(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (public.is_coach_of(c.workspace_id)
        or (c.client_id = (select auth.uid()) and public.is_member_of(c.workspace_id)))
  );
$$;

-- Post: a participant, and only while the client is a current client of the workspace.
create function public.can_post_to_conversation(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and exists (
        select 1 from public.workspace_members m
        where m.workspace_id = c.workspace_id and m.user_id = c.client_id and m.role = 'client'
      )
      and (public.is_coach_of(c.workspace_id) or c.client_id = (select auth.uid()))
  );
$$;

-- Storage paths are {workspace_id}/{conversation_id}/{file}. False (never an error) for anything malformed.
create function public.message_image_conversation(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    then split_part(p_name, '/', 2)::uuid
  end;
$$;

create function public.can_access_message_image(p_name text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when p_write then public.can_post_to_conversation(c.id) else public.can_read_conversation(c.id) end
    from public.conversations c
    where c.id = public.message_image_conversation(p_name)
      and c.workspace_id::text = lower(split_part(p_name, '/', 1))
  ), false);
$$;

-- Before insert: copy the workspace from the conversation and keep images inside its own folder.
create function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_prefix text;
begin
  -- Signed-in callers: check access first, so a non-participant cannot learn whether a conversation exists.
  -- (The service role has no auth.uid() and is trusted.)
  if (select auth.uid()) is not null and not public.can_post_to_conversation(new.conversation_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select c.workspace_id into v_workspace_id from public.conversations c where c.id = new.conversation_id;
  if not found then
    raise exception 'Conversation not found' using errcode = '23503';
  end if;
  new.workspace_id := v_workspace_id;
  v_prefix := v_workspace_id::text || '/' || new.conversation_id::text || '/';
  if exists (
    select 1 from unnest(new.image_paths) p
    where left(p, length(v_prefix)) <> v_prefix or length(p) = length(v_prefix) or position('/' in substr(p, length(v_prefix) + 1)) > 0
  ) then
    raise exception 'Image paths must be inside this conversation''s folder' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- After insert: bump the inbox sort key.
create function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations c
  set last_message_at = greatest(coalesce(c.last_message_at, new.created_at), new.created_at)
  where c.id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- Messages are never edited or deleted in this version (the service role can still, for support).
-- The conversation for a coach/client pair, created on first use. 42501 unless the caller is a coach of the
-- workspace that client belongs to, or the client themselves (also for unknown or removed clients: nothing leaks).
create function public.get_or_create_conversation(p_client_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_id uuid;
begin
  select m.workspace_id into v_ws
  from public.workspace_members m
  where m.user_id = p_client_id and m.role = 'client'
    and (p_client_id = (select auth.uid()) or public.is_coach_of(m.workspace_id))
  order by m.created_at, m.workspace_id
  limit 1;
  if v_ws is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  insert into public.conversations (workspace_id, client_id) values (v_ws, p_client_id)
  on conflict (workspace_id, client_id) do nothing
  returning id into v_id;
  if v_id is null then
    select c.id into v_id from public.conversations c where c.workspace_id = v_ws and c.client_id = p_client_id;
  end if;
  return v_id;
end;
$$;

-- The caller has read the conversation up to now. 42501 unless they can read it.
create function public.mark_conversation_read(p_conversation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_read_conversation(p_conversation_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, (select auth.uid()), now())
  on conflict (conversation_id, user_id) do update set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at);
end;
$$;

revoke execute on function
  public.can_read_conversation(uuid), public.can_post_to_conversation(uuid),
  public.message_image_conversation(text), public.can_access_message_image(text, boolean),
  public.messages_before_insert(), public.messages_after_insert(),
  public.get_or_create_conversation(uuid), public.mark_conversation_read(uuid)
  from public, anon, authenticated;
grant execute on function
  public.can_read_conversation(uuid), public.can_post_to_conversation(uuid),
  public.get_or_create_conversation(uuid), public.mark_conversation_read(uuid)
  to authenticated;
-- The storage policies run as the caller, so they need these two.
grant execute on function public.message_image_conversation(text), public.can_access_message_image(text, boolean)
  to authenticated;

-- Privileges: nothing for anon. Clients of the API only read, and insert a message (never its sender/workspace).
revoke all on table public.conversations, public.messages, public.conversation_reads
  from anon, authenticated, service_role;
grant select on public.conversations, public.messages, public.conversation_reads to authenticated;
grant insert (conversation_id, body, image_paths, client_msg_id) on public.messages to authenticated;
grant select, insert, update, delete on public.conversations, public.messages, public.conversation_reads
  to service_role;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;

create policy conversations_select on public.conversations for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_member_of(workspace_id)));

create policy messages_select on public.messages for select to authenticated
  using (public.can_read_conversation(conversation_id));

create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.can_post_to_conversation(conversation_id));

create policy conversation_reads_select on public.conversation_reads for select to authenticated
  using (public.can_read_conversation(conversation_id));

-- Storage: private bucket, WebP (JPEG where a browser can't write WebP), 5 MB. Participants read; participants of a live conversation write.
-- No update or delete policies: photos are not editable or removable in this version.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-images', 'message-images', false, 5242880, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/webp', 'image/jpeg'];

create policy message_images_select on storage.objects for select to authenticated
  using (bucket_id = 'message-images' and public.can_access_message_image(name, false));
create policy message_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'message-images' and public.can_access_message_image(name, true));

-- Realtime. Idempotent, and a no-op where the publication does not exist.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'conversation_reads'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
