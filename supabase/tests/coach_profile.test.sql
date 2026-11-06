begin;
select plan(16);

select tests.create_user('coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_b', :'b1');

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

select * from finish();
rollback;
