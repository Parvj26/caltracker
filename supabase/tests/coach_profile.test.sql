begin;
select plan(29);

select tests.create_user('coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_b', :'b1');
select tests.create_user('staff-a@t.local', 'Staff A') as staff_a \gset
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws_a', :'staff_a', 'staff');
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars', :'a1' || '/avatar.webp', :'a1'),
  ('avatars', :'coach_a' || '/avatar-thumb.webp', :'coach_a');

-- Bio limit
select tests.act_as(:'coach_a');
select lives_ok($$update public.profiles set bio = repeat('x', 300) where id = auth.uid()$$, '300-character bio is accepted');
select throws_ok($$update public.profiles set bio = repeat('x', 301) where id = auth.uid()$$, '23514', null,
  '301-character bio is rejected');
reset role;

-- Renaming the business
select tests.act_as(:'coach_a');
select lives_ok($$select public.update_workspace_name('  New Name  ')$$, 'owner can rename');
select is((select name from public.workspaces where id = :'ws_a'), 'New Name', 'name is trimmed and saved');
select throws_ok($$select public.update_workspace_name('   ')$$, '23514', null, 'blank name rejected');
select throws_ok($$select public.update_workspace_name(repeat('x', 81))$$, '23514', null, '81-character name rejected');
select throws_ok($$update public.workspaces set name = 'Direct' where id = (select id from public.workspaces limit 1)$$,
  '42501', null, 'direct name update is no longer allowed');
reset role;
select tests.act_as(:'coach_b');
select lives_ok($$select public.update_workspace_name('B Renamed')$$, 'other coach renames only their own');
reset role;
select is((select name from public.workspaces where id = :'ws_a'), 'New Name', 'workspace A untouched by coach B');
select tests.act_as(:'a1');
select throws_ok($$select public.update_workspace_name('Hacked')$$, '42501', null, 'client cannot rename');
reset role;

-- Client reads their coach's profile, not another coach's
select tests.act_as(:'a1');
select is((select full_name from public.profiles where id = :'coach_a'), 'Coach A', 'client reads own coach profile');
select is((select count(*)::int from public.profiles where id = :'coach_b'), 0, 'client cannot read another coach profile');
reset role;

-- Storage
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', %L, %L)$$,
  :'coach_a' || '/avatar.webp', :'coach_a'), 'insert into own folder works');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('avatars', %L)$$,
  :'a1' || '/avatar.webp'), '42501', null, 'insert into another user folder denied');
reset role;
select tests.act_as(:'a1');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars' and name = :'coach_a' || '/avatar.webp'),
  1, 'same-workspace client reads coach avatar');
reset role;
select tests.act_as(:'b1');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars' and name = :'coach_a' || '/avatar.webp'),
  0, 'cross-workspace read denied');
reset role;

-- Staff cannot rename the business
select tests.act_as(:'staff_a');
select throws_ok($$select public.update_workspace_name('Staff Rename')$$, '42501', null, 'staff coach cannot rename');
reset role;

-- Nested paths
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', %L, %L)$$,
  :'coach_a' || '/nested/x.webp', :'coach_a'), 'nested insert into own folder works');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('avatars', %L)$$,
  :'a1' || '/nested/x.webp'), '42501', null, 'nested insert into another user folder denied');

-- Update and delete: own object works, another user's is untouched
with u as (update storage.objects set metadata = '{}'::jsonb
    where bucket_id = 'avatars' and name = :'a1' || '/avatar.webp' returning 1)
select is((select count(*)::int from u), 0, 'coach cannot update a client avatar object');
select set_config('storage.allow_delete_query', 'true', true);
with d as (delete from storage.objects
    where bucket_id = 'avatars' and name = :'a1' || '/avatar.webp' returning 1)
select is((select count(*)::int from d), 0, 'coach cannot delete a client avatar object');
with u as (update storage.objects set metadata = '{}'::jsonb
    where bucket_id = 'avatars' and name = :'coach_a' || '/avatar-thumb.webp' returning 1)
select is((select count(*)::int from u), 1, 'coach can update own avatar object');
with d as (delete from storage.objects
    where bucket_id = 'avatars' and name = :'coach_a' || '/avatar-thumb.webp' returning 1)
select is((select count(*)::int from d), 1, 'coach can delete own avatar object');

-- avatar_path must sit in the user's own folder
select lives_ok(format($$update public.profiles set avatar_path = %L where id = auth.uid()$$, :'coach_a' || '/avatar.webp'),
  'avatar_path in own folder accepted');
select throws_ok(format($$update public.profiles set avatar_path = %L where id = auth.uid()$$, :'a1' || '/avatar.webp'),
  '23514', null, 'avatar_path in another folder rejected');
select lives_ok($$update public.profiles set avatar_path = null where id = auth.uid()$$, 'avatar_path can be cleared');
reset role;

select is((select public from storage.buckets where id = 'avatars'), false, 'the avatars bucket is private');
select is((select file_size_limit from storage.buckets where id = 'avatars'), 3145728::bigint, 'photos are limited to 3 MB');
select is((select allowed_mime_types from storage.buckets where id = 'avatars'), array['image/webp', 'image/jpeg'],
  'only WebP and JPEG photos are accepted');

select * from finish();
rollback;
