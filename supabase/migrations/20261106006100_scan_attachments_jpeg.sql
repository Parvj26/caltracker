-- A browser that cannot encode WebP compresses a printout photo to JPEG instead, so the bucket and the path rule
-- accept image/jpeg and a .jpg extension as well.

alter table public.body_measurements drop constraint body_measurements_attachment_path_check;
alter table public.body_measurements add constraint body_measurements_attachment_path_check
  check (attachment_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|pdf)$');

update storage.buckets set allowed_mime_types = array['image/webp', 'image/jpeg', 'application/pdf']
where id = 'scan-attachments';

create or replace function public.scan_path_workspace(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|pdf)$'
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 1)::uuid end;
$$;
create or replace function public.scan_path_client(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|pdf)$'
    and split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 2)::uuid end;
$$;
