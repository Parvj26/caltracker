-- The client page's Overview and Documents tabs: coach-private notes and limitations (injuries), a goal with an
-- optional countdown that the client can read, and documents the coach keeps for a client (optionally shared).
-- Design: docs/superpowers/specs/2026-11-06-client-overview-design.md.
--
-- Access, for every table: the coach of the workspace reads everything (including a removed client's history) and
-- writes only for a current client; the client reads their own goal and their own shared documents, nothing else;
-- other clients, other workspaces and anon get nothing. Coaches write directly under RLS; column grants keep
-- workspace_id, client_id, authors and file paths from changing after insert.

-- ---------- Notes: many per client, coach only ----------
create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_notes_client_idx on public.client_notes (workspace_id, client_id, created_at desc);
create index client_notes_created_by_idx on public.client_notes (created_by);
create index client_notes_client_id_idx on public.client_notes (client_id);

-- ---------- Limitations / injuries: one free-text record per client, coach only ----------
create table public.client_limitations (
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, client_id)
);
create index client_limitations_client_idx on public.client_limitations (client_id);

-- ---------- Goal and countdown: one per client, shared with the client ----------
create table public.client_goals (
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  goal text not null check (char_length(btrim(goal)) between 1 and 200),
  -- The countdown runs to this day; none means a goal without a date.
  target_date date check (target_date >= date '2000-01-01'),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, client_id)
);
create index client_goals_client_idx on public.client_goals (client_id);

-- ---------- Documents: PDFs and images the coach keeps for a client ----------
create table public.client_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- {workspace_id}/{client_id}/{uuid}.{pdf|webp|jpg} in the client-documents bucket, always this row's own client.
  storage_path text not null unique
    check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|webp|jpg)$'
      and split_part(storage_path, '/', 1) = workspace_id::text
      and split_part(storage_path, '/', 2) = client_id::text),
  content_type text not null check (content_type in ('application/pdf', 'image/webp', 'image/jpeg')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  shared_with_client boolean not null default false,
  uploaded_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index client_documents_client_idx on public.client_documents (workspace_id, client_id, created_at desc);
create index client_documents_client_id_idx on public.client_documents (client_id);
create index client_documents_uploaded_by_idx on public.client_documents (uploaded_by);

create trigger client_notes_touch before update on public.client_notes
  for each row execute function public.touch_updated_at();
create trigger client_limitations_touch before update on public.client_limitations
  for each row execute function public.touch_updated_at();
create trigger client_goals_touch before update on public.client_goals
  for each row execute function public.touch_updated_at();

-- ---------- Privileges ----------
revoke all on table public.client_notes, public.client_limitations, public.client_goals, public.client_documents
  from anon, authenticated, service_role;
grant select, delete on public.client_notes, public.client_limitations, public.client_goals, public.client_documents
  to authenticated;
grant insert (workspace_id, client_id, body) on public.client_notes to authenticated;
grant update (body) on public.client_notes to authenticated;
grant insert (workspace_id, client_id, body) on public.client_limitations to authenticated;
grant update (body) on public.client_limitations to authenticated;
grant insert (workspace_id, client_id, goal, target_date) on public.client_goals to authenticated;
grant update (goal, target_date) on public.client_goals to authenticated;
grant insert (id, workspace_id, client_id, name, storage_path, content_type, size_bytes, shared_with_client)
  on public.client_documents to authenticated;
grant update (name, shared_with_client) on public.client_documents to authenticated;
grant select, insert, update, delete on public.client_notes, public.client_limitations, public.client_goals,
  public.client_documents to service_role;

alter table public.client_notes enable row level security;
alter table public.client_limitations enable row level security;
alter table public.client_goals enable row level security;
alter table public.client_documents enable row level security;

-- ---------- Policies ----------
-- Coach-only tables: read and delete in the coach's workspace; write only for a current client.
create policy client_notes_select on public.client_notes for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy client_notes_insert on public.client_notes for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy client_notes_update on public.client_notes for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy client_notes_delete on public.client_notes for delete to authenticated
  using (public.is_coach_of(workspace_id));

create policy client_limitations_select on public.client_limitations for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy client_limitations_insert on public.client_limitations for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy client_limitations_update on public.client_limitations for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy client_limitations_delete on public.client_limitations for delete to authenticated
  using (public.is_coach_of(workspace_id));

-- Goals: the client also reads their own, while still a client of the workspace.
create policy client_goals_select on public.client_goals for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy client_goals_insert on public.client_goals for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy client_goals_update on public.client_goals for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
create policy client_goals_delete on public.client_goals for delete to authenticated
  using (public.is_coach_of(workspace_id));

-- Documents: the client reads their own rows the coach marked shared, while still a client.
create policy client_documents_select on public.client_documents for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (shared_with_client and client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));
create policy client_documents_insert on public.client_documents for insert to authenticated
  with check (public.is_coach_of(workspace_id) and public.is_client_in(workspace_id, client_id));
-- For a removed client the coach may still unshare (so a later re-invite doesn't share it again), but not share or
-- rename: the check allows only an unshared row, and the trigger below refuses a new name.
create policy client_documents_update on public.client_documents for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id)
    and (public.is_client_in(workspace_id, client_id) or not shared_with_client));

create function public.client_documents_guard_rename() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.name is distinct from old.name and (select auth.uid()) is not null
    and not public.is_client_in(new.workspace_id, new.client_id) then
    raise exception 'This client was removed, so their documents can''t be renamed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.client_documents_guard_rename() from public, anon, authenticated;
create trigger client_documents_guard_rename before update on public.client_documents
  for each row execute function public.client_documents_guard_rename();
create policy client_documents_delete on public.client_documents for delete to authenticated
  using (public.is_coach_of(workspace_id));

-- ---------- Storage: private bucket, PDFs and images only, at most 5 MB ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-documents', 'client-documents', false, 5242880, array['application/pdf', 'image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['application/pdf', 'image/webp', 'image/jpeg'];

-- Path parts as uuids, or null when the path is not {workspace}/{client}/{uuid}.{pdf|webp|jpg}.
create function public.document_path_workspace(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|webp|jpg)$'
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 1)::uuid end;
$$;
create function public.document_path_client(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|webp|jpg)$'
    and split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 2)::uuid end;
$$;
revoke execute on function public.document_path_workspace(text), public.document_path_client(text) from public, anon;
grant execute on function public.document_path_workspace(text), public.document_path_client(text) to authenticated;

-- The coach reads and writes; the client reads a file only while a shared document row of theirs points at it
-- (the subquery runs under client_documents' own RLS, which already requires shared, own and still a client).
-- No update policy: files are never renamed or overwritten in place.
create policy client_documents_files_select on storage.objects for select to authenticated
  using (bucket_id = 'client-documents' and (
    public.is_coach_of(public.document_path_workspace(name))
    or exists (select 1 from public.client_documents d
      where d.storage_path = objects.name and d.client_id = (select auth.uid()))));
create policy client_documents_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'client-documents'
    and public.is_coach_of(public.document_path_workspace(name))
    and public.is_client_in(public.document_path_workspace(name), public.document_path_client(name)));
create policy client_documents_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'client-documents' and public.is_coach_of(public.document_path_workspace(name)));

-- Files are not removed by SQL: whatever deletes a document (or a workspace) removes its file through the Storage API.
