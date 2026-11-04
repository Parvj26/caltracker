begin;
select plan(34);

-- Fixtures (as postgres)
select tests.create_user('coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_b', :'b1');

insert into public.exercises (id, source, external_id, name, tracking_type)
values ('00000000-0000-0000-0000-0000000000b1', 'builtin', 'Test_Builtin', 'Test Builtin', 'reps') ;
insert into public.exercises (id, workspace_id, source, name, tracking_type)
values ('00000000-0000-0000-0000-0000000000a1', :'ws_a', 'custom', 'A Custom', 'weight_reps'),
       ('00000000-0000-0000-0000-0000000000c2', :'ws_b', 'custom', 'B Custom', 'reps');

-- Privileges
select ok(not has_table_privilege('anon', 'public.exercises', 'select,insert,update,delete'), 'anon has no privileges on exercises');
select ok(not has_table_privilege('anon', 'public.exercise_overrides', 'select,insert,update,delete'), 'anon has no privileges on exercise_overrides');
select ok(not has_column_privilege('authenticated', 'public.exercises', 'source', 'update')
  and not has_column_privilege('authenticated', 'public.exercises', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.exercises', 'external_id', 'update')
  and not has_column_privilege('authenticated', 'public.exercises', 'created_by', 'update'),
  'authenticated cannot update source/workspace_id/external_id/created_by');
select ok(not has_column_privilege('authenticated', 'public.exercises', 'external_id', 'insert')
  and not has_column_privilege('authenticated', 'public.exercises', 'created_by', 'insert'),
  'authenticated cannot insert external_id/created_by');
select is((select public from storage.buckets where id = 'exercise-images'), true, 'exercise-images bucket is public');

-- anon reads nothing
select tests.act_as_anon();
select throws_ok($$select * from public.exercises$$, '42501', null, 'anon cannot select exercises');
select throws_ok($$select * from public.exercise_overrides$$, '42501', null, 'anon cannot select overrides');
reset role;

-- Client A1
select tests.act_as(:'a1');
select is((select count(*)::int from public.exercises where external_id = 'Test_Builtin'), 1, 'A1 reads a built-in');
select is((select count(*)::int from public.exercises where name = 'A Custom'), 1, 'A1 reads A custom exercise');
select is((select count(*)::int from public.exercises where name = 'B Custom'), 0, 'A1 cannot read B custom exercise');
select throws_ok(
  format($$insert into public.exercises (workspace_id, source, name, tracking_type) values (%L, 'custom', 'Hack', 'reps')$$, :'ws_a'),
  '42501', null, 'client cannot create exercises');
update public.exercises set name = 'Hacked' where name = 'A Custom';
delete from public.exercises where name = 'A Custom';
reset role;
select is((select count(*)::int from public.exercises where name = 'A Custom'), 1, 'client could neither rename nor delete A custom exercise');

-- Coach A
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.exercises where external_id = 'Test_Builtin'), 1, 'coach A reads built-in');
select is((select count(*)::int from public.exercises where name = 'B Custom'), 0, 'coach A cannot read B custom');
insert into public.exercises (workspace_id, source, name, tracking_type, youtube_url)
values (:'ws_a', 'custom', 'Coach A Move', 'time', 'https://youtu.be/dQw4w9WgXcQ');
select is((select count(*)::int from public.exercises where name = 'Coach A Move'), 1, 'coach A creates custom exercise in A');
select is((select created_by from public.exercises where name = 'Coach A Move'), :'coach_a'::uuid, 'created_by defaults to the caller');
update public.exercises set name = 'Coach A Move 2' where name = 'Coach A Move';
select is((select count(*)::int from public.exercises where name = 'Coach A Move 2'), 1, 'coach A updates own custom exercise');
delete from public.exercises where name = 'Coach A Move 2';
select is((select count(*)::int from public.exercises where name like 'Coach A Move%'), 0, 'coach A deletes own custom exercise');

select throws_ok(
  format($$insert into public.exercises (workspace_id, source, name, tracking_type) values (%L, 'custom', 'Into B', 'reps')$$, :'ws_b'),
  '42501', null, 'coach A cannot insert custom exercise into B');
select throws_ok(
  $$insert into public.exercises (source, name, tracking_type) values ('builtin', 'Fake builtin', 'reps')$$,
  '42501', null, 'coach cannot insert a built-in');
select throws_ok(
  format($$insert into public.exercises (workspace_id, source, name, tracking_type, youtube_url) values (%L, 'custom', 'Bad Video', 'reps', 'https://vimeo.com/1')$$, :'ws_a'),
  '23514', null, 'non-YouTube pinned video is rejected');
select throws_ok(
  format($$insert into public.exercises (workspace_id, source, name, tracking_type, created_by) values (%L, 'custom', 'Forged', 'reps', %L)$$, :'ws_a', :'coach_b'),
  '42501', null, 'coach cannot supply created_by');
update public.exercises set name = 'Hacked' where external_id = 'Test_Builtin';
update public.exercises set name = 'Hacked' where name = 'B Custom';
select throws_ok($$update public.exercises set source = 'builtin', workspace_id = null where name = 'A Custom'$$,
  '42501', null, 'coach cannot change source/workspace_id');
select throws_ok($$update public.exercises set external_id = 'x' where name = 'A Custom'$$,
  '42501', null, 'coach cannot change external_id');
delete from public.exercises where external_id = 'Test_Builtin';
reset role;
select is((select name from public.exercises where external_id = 'Test_Builtin'), 'Test Builtin', 'coach A cannot update or delete a built-in');
select is((select name from public.exercises where id = '00000000-0000-0000-0000-0000000000c2'), 'B Custom', 'coach A cannot update B custom');

-- Check constraint (as postgres)
select throws_ok(
  $$insert into public.exercises (source, name, tracking_type) values ('custom', 'Orphan', 'reps')$$,
  '23514', null, 'custom exercise with null workspace violates check');

-- Overrides
select tests.act_as(:'coach_a');
insert into public.exercise_overrides (workspace_id, exercise_id, youtube_url, coach_notes)
values (:'ws_a', '00000000-0000-0000-0000-0000000000b1', 'https://youtu.be/dQw4w9WgXcQ', 'note 1')
on conflict (workspace_id, exercise_id) do update set youtube_url = excluded.youtube_url, coach_notes = excluded.coach_notes;
insert into public.exercise_overrides (workspace_id, exercise_id, youtube_url, coach_notes)
values (:'ws_a', '00000000-0000-0000-0000-0000000000b1', 'https://youtu.be/dQw4w9WgXcQ', 'note 2')
on conflict (workspace_id, exercise_id) do update set youtube_url = excluded.youtube_url, coach_notes = excluded.coach_notes;
select is((select coach_notes from public.exercise_overrides where workspace_id = :'ws_a'), 'note 2', 'coach A upserts an override for a built-in in A');
select throws_ok(
  format($$insert into public.exercise_overrides (workspace_id, exercise_id) values (%L, '00000000-0000-0000-0000-0000000000b1')$$, :'ws_b'),
  '42501', null, 'coach A cannot write an override for workspace B');
select throws_ok(
  format($$insert into public.exercise_overrides (workspace_id, exercise_id) values (%L, '00000000-0000-0000-0000-0000000000c2')$$, :'ws_a'),
  '42501', null, 'coach A cannot override B custom exercise');
reset role;

select tests.act_as(:'a1');
select is((select count(*)::int from public.exercise_overrides), 1, 'A1 reads A override');
reset role;
select tests.act_as(:'b1');
select is((select count(*)::int from public.exercise_overrides), 0, 'B1 cannot read A override');
reset role;
select tests.act_as(:'coach_b');
delete from public.exercise_overrides;
reset role;
select is((select count(*)::int from public.exercise_overrides), 1, 'coach B cannot delete A override');

-- Storage: only the service role writes to exercise-images
select tests.act_as(:'coach_a');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('exercise-images', 'free-exercise-db/hack.jpg')$$,
  '42501', null, 'authenticated coach cannot insert into exercise-images');
reset role;

select * from finish();
rollback;
