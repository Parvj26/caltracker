begin;
select plan(43);

-- Fixtures (as postgres)
select tests.create_user('aw-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('aw-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('aw-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('aw-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('aw-b1@t.local', 'Client B1') as b1 \gset
select tests.create_user('aw-gone@t.local', 'Client Gone') as gone \gset
select tests.create_workspace('AW Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('AW Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select tests.add_client(:'ws_b', :'gone');

select tests.create_log(:'ws_a', :'a1') as log_a1 \gset
select tests.create_log(:'ws_a', :'a2') as log_a2 \gset
select tests.create_log(:'ws_b', :'b1') as log_b1 \gset
select tests.create_log(:'ws_b', :'gone') as log_gone \gset
select tests.create_exercise(null, 'AW lift') as ex \gset

insert into public.sticker_awards (client_id, workspace_id, sticker_key, first_log_id) values
  (:'a1', :'ws_a', 'k1', :'log_a1'), (:'a2', :'ws_a', 'k1', :'log_a2'),
  (:'b1', :'ws_b', 'k1', :'log_b1'), (:'gone', :'ws_b', 'k1', :'log_gone');
insert into public.awards (log_id, client_id, workspace_id, result) values
  (:'log_a1', :'a1', :'ws_a', '{}'), (:'log_a2', :'a2', :'ws_a', '{}'),
  (:'log_b1', :'b1', :'ws_b', '{}'), (:'log_gone', :'gone', :'ws_b', '{}');
insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, reps, log_id, achieved_at) values
  (:'a1', :'ws_a', :'ex', 'heaviest', 100, 5, :'log_a1', now()),
  (:'a2', :'ws_a', :'ex', 'heaviest', 90, 5, :'log_a2', now()),
  (:'b1', :'ws_b', :'ex', 'heaviest', 80, 5, :'log_b1', now()),
  (:'gone', :'ws_b', :'ex', 'heaviest', 70, 5, :'log_gone', now());
insert into public.client_stats (client_id, workspace_id, workouts) values
  (:'a1', :'ws_a', 1), (:'a2', :'ws_a', 1), (:'b1', :'ws_b', 1), (:'gone', :'ws_b', 1);

-- Structure
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.sticker_awards'::regclass, 'public.awards'::regclass,
    'public.personal_records'::regclass, 'public.client_stats'::regclass)),
  'RLS is enabled on all four award tables');
select is((select column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'time_zone'),
  '''UTC''::text', 'time_zone defaults to UTC');
select throws_ok(format($$update public.profiles set time_zone = '' where id = %L$$, :'a1'), '23514', null,
  'time_zone cannot be empty');
select throws_ok(format($$update public.profiles set time_zone = %L where id = %L$$, repeat('x', 65), :'a1'), '23514', null,
  'time_zone cannot be longer than 64 characters');

-- Privileges
select ok(not has_any_column_privilege('anon', 'public.sticker_awards', 'select,insert,update')
  and not has_any_column_privilege('anon', 'public.awards', 'select,insert,update')
  and not has_any_column_privilege('anon', 'public.personal_records', 'select,insert,update')
  and not has_any_column_privilege('anon', 'public.client_stats', 'select,insert,update')
  and not has_table_privilege('anon', 'public.sticker_awards', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'public.awards', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'public.personal_records', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'public.client_stats', 'select,insert,update,delete'),
  'anon has no privileges on the award tables');
select table_privs_are('public', 'sticker_awards', 'authenticated', array['SELECT'], 'authenticated has exactly select on sticker_awards');
select table_privs_are('public', 'awards', 'authenticated', array['SELECT'], 'authenticated has exactly select on awards');
select table_privs_are('public', 'personal_records', 'authenticated', array['SELECT'], 'authenticated has exactly select on personal_records');
select table_privs_are('public', 'client_stats', 'authenticated', array['SELECT'], 'authenticated has exactly select on client_stats');

-- A client reads only their own rows
select tests.act_as(:'a1');
select is((select count(*)::int from public.sticker_awards), 1, 'a client sees exactly their own sticker_awards row');
select is((select count(*)::int from public.awards), 1, 'a client sees exactly their own awards row');
select is((select count(*)::int from public.personal_records), 1, 'a client sees exactly their own personal_records row');
select is((select count(*)::int from public.client_stats), 1, 'a client sees exactly their own client_stats row');
select is((select count(*)::int from public.sticker_awards where client_id <> :'a1')
  + (select count(*)::int from public.awards where client_id <> :'a1')
  + (select count(*)::int from public.personal_records where client_id <> :'a1')
  + (select count(*)::int from public.client_stats where client_id <> :'a1'), 0,
  'a client sees nothing of another client (same workspace or another one)');

-- Writes are refused to clients
select throws_ok(format($$insert into public.sticker_awards (client_id, workspace_id, sticker_key) values (%L, %L, 'k2')$$, :'a1', :'ws_a'),
  '42501', null, 'a client cannot insert into sticker_awards');
select throws_ok(format($$insert into public.awards (log_id, client_id, workspace_id, result) values (gen_random_uuid(), %L, %L, '{}')$$, :'a1', :'ws_a'),
  '42501', null, 'a client cannot insert into awards');
select throws_ok(format($$insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, achieved_at) values (%L, %L, %L, 'e1rm', 1, now())$$, :'a1', :'ws_a', :'ex'),
  '42501', null, 'a client cannot insert into personal_records');
select throws_ok(format($$insert into public.client_stats (client_id, workspace_id) values (%L, %L)$$, :'a1', :'ws_a'),
  '42501', null, 'a client cannot insert into client_stats');
select throws_ok($$update public.sticker_awards set count = 99$$, '42501', null, 'a client cannot update sticker_awards');
select throws_ok($$delete from public.personal_records$$, '42501', null, 'a client cannot delete personal_records');

-- Time zone: own row only
select lives_ok(format($$update public.profiles set time_zone = 'America/New_York' where id = %L$$, :'a1'),
  'a client can change their own time zone');
with u as (update public.profiles set time_zone = 'Asia/Tokyo' where id = :'a2' returning 1)
select is((select count(*)::int from u), 0, 'a client cannot change another client''s time zone');

-- A coach reads their workspace only
reset role;
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.sticker_awards where workspace_id = :'ws_a'), 2, 'the coach sees both clients'' sticker_awards rows');
select is((select count(*)::int from public.awards where workspace_id = :'ws_a'), 2, 'the coach sees both clients'' awards rows');
select is((select count(*)::int from public.personal_records where workspace_id = :'ws_a'), 2, 'the coach sees both clients'' personal_records rows');
select is((select count(*)::int from public.client_stats where workspace_id = :'ws_a'), 2, 'the coach sees both clients'' client_stats rows');
select is((select count(*)::int from public.sticker_awards where workspace_id = :'ws_b')
  + (select count(*)::int from public.awards where workspace_id = :'ws_b')
  + (select count(*)::int from public.personal_records where workspace_id = :'ws_b')
  + (select count(*)::int from public.client_stats where workspace_id = :'ws_b'), 0,
  'a coach sees nothing from another workspace');
select throws_ok(format($$insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, achieved_at) values (%L, %L, %L, 'e1rm', 1, now())$$, :'a1', :'ws_a', :'ex'),
  '42501', null, 'a coach cannot insert awards either');
with u as (update public.profiles set time_zone = 'Asia/Tokyo' where id = :'a1' returning 1)
select is((select count(*)::int from u), 0, 'a coach cannot change a client''s time zone');
reset role;
select is((select time_zone from public.profiles where id = :'a1'), 'America/New_York', 'the client''s time zone was saved');

-- Anon gets nothing
select tests.act_as_anon();
select throws_ok($$select * from public.sticker_awards$$, '42501', null, 'anon cannot read sticker_awards');
select throws_ok($$select * from public.awards$$, '42501', null, 'anon cannot read awards');
select throws_ok($$select * from public.personal_records$$, '42501', null, 'anon cannot read personal_records');
select throws_ok($$select * from public.client_stats$$, '42501', null, 'anon cannot read client_stats');
reset role;

-- A removed client no longer reads their rows; the coach still does
delete from public.workspace_members where workspace_id = :'ws_b' and user_id = :'gone';
select tests.act_as(:'gone');
select is((select count(*)::int from public.sticker_awards), 0, 'a removed client no longer sees their stickers');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.sticker_awards where client_id = :'gone'), 1, 'the coach still sees a removed client''s stickers');
reset role;

-- Unique rules
select throws_ok(format($$insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, achieved_at) values (%L, %L, %L, 'heaviest', 120, now())$$, :'a1', :'ws_a', :'ex'),
  '23505', null, 'one heaviest record per client and exercise');
select lives_ok(format($$insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, reps, achieved_at) values (%L, %L, %L, 'reps_at_weight', 60, 10, now()), (%L, %L, %L, 'reps_at_weight', 70, 8, now())$$, :'a1', :'ws_a', :'ex', :'a1', :'ws_a', :'ex'),
  'reps_at_weight keeps one record per weight');
select throws_ok(format($$insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, reps, achieved_at) values (%L, %L, %L, 'reps_at_weight', 60, 12, now())$$, :'a1', :'ws_a', :'ex'),
  '23505', null, 'not two reps_at_weight records for the same weight');
select throws_ok(format($$insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, achieved_at) values (%L, %L, %L, 'reps_at_weight', 80, now())$$, :'a1', :'ws_a', :'ex'),
  '23514', null, 'reps_at_weight needs reps');

-- Cascades
delete from auth.users where id = :'a2';
select is((select count(*)::int from public.sticker_awards where client_id = :'a2')
  + (select count(*)::int from public.awards where client_id = :'a2')
  + (select count(*)::int from public.personal_records where client_id = :'a2')
  + (select count(*)::int from public.client_stats where client_id = :'a2'), 0,
  'deleting a user deletes their award rows');
select lives_ok(format($$delete from public.workspaces where id = %L$$, :'ws_b'), 'a workspace with award rows can be deleted');
select is((select count(*)::int from public.sticker_awards where workspace_id = :'ws_b')
  + (select count(*)::int from public.awards where workspace_id = :'ws_b')
  + (select count(*)::int from public.personal_records where workspace_id = :'ws_b')
  + (select count(*)::int from public.client_stats where workspace_id = :'ws_b'), 0,
  'deleting a workspace deletes its award rows');

select * from finish();
rollback;
