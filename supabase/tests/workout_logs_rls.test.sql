begin;
select plan(73);

-- Fixtures (as postgres)
select tests.create_user('wl-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('wl-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('wl-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('wl-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('wl-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('WL Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('WL Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

select tests.create_workout(:'ws_a', 'A1 Day', :'a1', '2026-11-10') as inst_a1 \gset
select tests.create_log(:'ws_a', :'a1', :'inst_a1') as log_a1 \gset
select tests.create_log(:'ws_b', :'b1') as log_b1 \gset
select id as log_a1_block from public.log_blocks where log_id = :'log_a1' \gset
select id as log_a1_le from public.log_exercises where log_id = :'log_a1' \gset
select id as log_a1_set from public.log_sets where log_id = :'log_a1' and position = 0 \gset

-- ---------------------------------------------------------------------------------------------
-- Structure
select has_type('public', 'log_status', 'log_status enum exists');
select enum_has_labels('public', 'log_status', array['in_progress', 'completed', 'discarded'],
  'log_status has in_progress/completed/discarded');
select has_index('public', 'workout_logs', 'one_active_log_per_client', 'one in-progress log per client index exists');
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.workout_logs'::regclass, 'public.log_blocks'::regclass, 'public.log_exercises'::regclass,
    'public.log_sets'::regclass, 'public.workout_log_comments'::regclass)),
  'RLS is enabled on all five log tables');
select has_trigger('public', 'workout_logs', 'workout_logs_touch_updated_at', 'workout_logs has the updated_at trigger');
select has_trigger('public', 'log_blocks', 'log_blocks_touch_updated_at', 'log_blocks has the updated_at trigger');
select has_trigger('public', 'log_exercises', 'log_exercises_touch_updated_at', 'log_exercises has the updated_at trigger');
select has_trigger('public', 'log_sets', 'log_sets_touch_updated_at', 'log_sets has the updated_at trigger');
select ok(not has_function_privilege('authenticated', 'public.inherit_log_owner()', 'execute')
  and not has_function_privilege('anon', 'public.inherit_log_owner()', 'execute'),
  'inherit_log_owner is not callable by API roles');

-- ---------------------------------------------------------------------------------------------
-- Privileges
select ok(not has_table_privilege('anon', 'public.workout_logs', 'select,insert,update,delete')
  and not has_any_column_privilege('anon', 'public.workout_logs', 'select,insert,update'),
  'anon has no privileges on workout_logs');
select ok(not has_table_privilege('anon', 'public.log_blocks', 'select,insert,update,delete')
  and not has_any_column_privilege('anon', 'public.log_blocks', 'select,insert,update'),
  'anon has no privileges on log_blocks');
select ok(not has_table_privilege('anon', 'public.log_exercises', 'select,insert,update,delete')
  and not has_any_column_privilege('anon', 'public.log_exercises', 'select,insert,update'),
  'anon has no privileges on log_exercises');
select ok(not has_table_privilege('anon', 'public.log_sets', 'select,insert,update,delete')
  and not has_any_column_privilege('anon', 'public.log_sets', 'select,insert,update'),
  'anon has no privileges on log_sets');
select ok(not has_table_privilege('anon', 'public.workout_log_comments', 'select,insert,update,delete')
  and not has_any_column_privilege('anon', 'public.workout_log_comments', 'select,insert,update'),
  'anon has no privileges on workout_log_comments');

select table_privs_are('public', 'workout_logs', 'authenticated', array['SELECT'],
  'authenticated has exactly select on workout_logs');
select table_privs_are('public', 'log_blocks', 'authenticated', array['SELECT'],
  'authenticated has exactly select on log_blocks');
select table_privs_are('public', 'log_exercises', 'authenticated', array['SELECT'],
  'authenticated has exactly select on log_exercises');
select table_privs_are('public', 'log_sets', 'authenticated', array['SELECT'],
  'authenticated has exactly select on log_sets');
select ok(not has_any_column_privilege('authenticated', 'public.workout_logs', 'insert,update')
  and not has_any_column_privilege('authenticated', 'public.log_blocks', 'insert,update')
  and not has_any_column_privilege('authenticated', 'public.log_exercises', 'insert,update')
  and not has_any_column_privilege('authenticated', 'public.log_sets', 'insert,update'),
  'authenticated has no column insert/update on the four log tables');

select table_privs_are('public', 'workout_log_comments', 'authenticated', array['SELECT', 'DELETE'],
  'authenticated has exactly select/delete (plus column insert) on workout_log_comments');
select ok(not has_any_column_privilege('authenticated', 'public.workout_log_comments', 'update'),
  'authenticated cannot update comments');
select ok(has_column_privilege('authenticated', 'public.workout_log_comments', 'id', 'insert')
  and has_column_privilege('authenticated', 'public.workout_log_comments', 'log_id', 'insert')
  and has_column_privilege('authenticated', 'public.workout_log_comments', 'body', 'insert'),
  'authenticated can insert comment id/log_id/body');
select ok(not has_column_privilege('authenticated', 'public.workout_log_comments', 'author_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workout_log_comments', 'workspace_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workout_log_comments', 'client_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workout_log_comments', 'created_at', 'insert'),
  'authenticated cannot insert comment author_id/workspace_id/client_id/created_at');

-- ---------------------------------------------------------------------------------------------
-- anon reads nothing
select tests.act_as_anon();
select throws_ok($$select * from public.workout_logs$$, '42501', null, 'anon cannot select workout_logs');
select throws_ok($$select * from public.log_blocks$$, '42501', null, 'anon cannot select log_blocks');
select throws_ok($$select * from public.log_exercises$$, '42501', null, 'anon cannot select log_exercises');
select throws_ok($$select * from public.log_sets$$, '42501', null, 'anon cannot select log_sets');
select throws_ok($$select * from public.workout_log_comments$$, '42501', null, 'anon cannot select workout_log_comments');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Inheritance (as postgres): forged owner columns are overwritten from the parent
insert into public.log_blocks (log_id, workspace_id, client_id, position) values (:'log_a1', :'ws_b', :'b1', 1)
  returning id as forged_block \gset
select results_eq(
  format($$select log_id, workspace_id, client_id from public.log_blocks where id = %L$$, :'forged_block'),
  format($$values (%L::uuid, %L::uuid, %L::uuid)$$, :'log_a1', :'ws_a', :'a1'),
  'a block inherits workspace_id/client_id from its log');
select results_eq(
  format($$select log_id, workspace_id, client_id from public.log_sets where id = %L$$, :'log_a1_set'),
  format($$values (%L::uuid, %L::uuid, %L::uuid)$$, :'log_a1', :'ws_a', :'a1'),
  'a set inherits log_id/workspace_id/client_id through its exercise');
delete from public.log_blocks where id = :'forged_block';
select throws_ok(
  format($$insert into public.log_sets (log_exercise_id, position) values (%L, 9)$$, gen_random_uuid()),
  '23503', null, 'a set with no parent exercise is refused');

-- Coach comment seeded as postgres for the client read check below
insert into public.workout_log_comments (log_id, author_id, body) values (:'log_a1', :'coach_a', 'Nice work')
  returning id as seed_comment \gset
select results_eq(
  format($$select workspace_id, client_id from public.workout_log_comments where id = %L$$, :'seed_comment'),
  format($$values (%L::uuid, %L::uuid)$$, :'ws_a', :'a1'),
  'a comment inherits workspace_id/client_id from its log');

-- ---------------------------------------------------------------------------------------------
-- Coach A reads
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.workout_logs where id = :'log_a1'), 1, 'coach A reads A1''s log');
select is((select count(*)::int from public.log_blocks where log_id = :'log_a1'), 1, 'coach A reads A1''s log blocks');
select is((select count(*)::int from public.log_exercises where log_id = :'log_a1'), 1, 'coach A reads A1''s log exercises');
select is((select count(*)::int from public.log_sets where log_id = :'log_a1'), 2, 'coach A reads A1''s log sets');
select is((select count(*)::int from public.workout_log_comments where log_id = :'log_a1'), 1, 'coach A reads comments on A1''s log');
select is(
  (select count(*)::int from public.workout_logs where id = :'log_b1')
  + (select count(*)::int from public.log_blocks where log_id = :'log_b1')
  + (select count(*)::int from public.log_exercises where log_id = :'log_b1')
  + (select count(*)::int from public.log_sets where log_id = :'log_b1')
  + (select count(*)::int from public.workout_log_comments where log_id = :'log_b1'),
  0, 'coach A reads nothing of B1''s log');

-- Coach A cannot write the log tree directly
select throws_ok(
  format($$insert into public.workout_logs (workspace_id, client_id, name) values (%L, %L, 'Coach made')$$, :'ws_a', :'a1'),
  '42501', null, 'coach A cannot insert a log directly');
select throws_ok(
  format($$update public.log_sets set actual_reps = 12 where id = %L$$, :'log_a1_set'),
  '42501', null, 'coach A cannot update a set directly');

-- Comments
insert into public.workout_log_comments (log_id, body) values (:'log_a1', 'Great depth on the squats')
  returning id as c_a \gset
select results_eq(
  format($$select author_id, workspace_id, client_id from public.workout_log_comments where id = %L$$, :'c_a'),
  format($$values (%L::uuid, %L::uuid, %L::uuid)$$, :'coach_a', :'ws_a', :'a1'),
  'coach A comments on A1''s log as themselves');
select is((select count(*)::int from public.workout_log_comments where id = :'c_a'), 1, 'coach A''s comment is one row');
select throws_ok(
  format($$insert into public.workout_log_comments (log_id, author_id, body) values (%L, %L, 'Spoof')$$, :'log_a1', :'coach_b'),
  '42501', null, 'coach A cannot set author_id');
select throws_ok(
  format($$insert into public.workout_log_comments (log_id, body) values (%L, '')$$, :'log_a1'),
  '23514', null, 'an empty comment is refused');
select throws_ok(
  format($$insert into public.workout_log_comments (log_id, body) values (%L, %L)$$, :'log_a1', repeat('x', 1001)),
  '23514', null, 'a comment over 1000 characters is refused');
select throws_ok(
  format($$update public.workout_log_comments set body = 'Edited' where id = %L$$, :'c_a'),
  '42501', null, 'coach A cannot edit a comment');
reset role;

-- Coach B cannot comment on (or delete comments of) workspace A
select tests.act_as(:'coach_b');
select throws_ok(
  format($$insert into public.workout_log_comments (log_id, body) values (%L, 'Hi from B')$$, :'log_a1'),
  '42501', null, 'coach B cannot comment on A1''s log');
delete from public.workout_log_comments where id = :'c_a';
select is((select count(*)::int from public.workout_logs), 1, 'coach B sees exactly one log (B1''s)');
reset role;
select is((select count(*)::int from public.workout_log_comments where id = :'c_a'), 1, 'coach B could not delete coach A''s comment');

-- ---------------------------------------------------------------------------------------------
-- Client A1
select tests.act_as(:'a1');
select is((select count(*)::int from public.workout_logs where id = :'log_a1'), 1, 'A1 reads own log');
select is((select count(*)::int from public.log_blocks where log_id = :'log_a1'), 1, 'A1 reads own log blocks');
select is((select count(*)::int from public.log_exercises where log_id = :'log_a1'), 1, 'A1 reads own log exercises');
select is((select count(*)::int from public.log_sets where log_id = :'log_a1'), 2, 'A1 reads own log sets');
select is((select count(*)::int from public.workout_log_comments where log_id = :'log_a1'), 2, 'A1 reads the coach''s comments');
select is((select count(*)::int from public.workout_logs), 1, 'A1 sees exactly one log');
select is(
  (select count(*)::int from public.workout_logs where id = :'log_b1')
  + (select count(*)::int from public.log_sets where log_id = :'log_b1'),
  0, 'A1 reads nothing of B1''s log');
select throws_ok(
  format($$insert into public.workout_logs (id, workspace_id, client_id, name) values (gen_random_uuid(), %L, %L, 'Mine')$$,
    :'ws_a', :'a1'),
  '42501', null, 'A1 cannot insert into workout_logs directly');
select throws_ok(
  format($$insert into public.workout_log_comments (log_id, body) values (%L, 'Thanks coach')$$, :'log_a1'),
  '42501', null, 'A1 cannot comment');
delete from public.workout_log_comments where id = :'c_a';
reset role;
select is((select count(*)::int from public.workout_log_comments where id = :'c_a'), 1, 'A1 could not delete the coach''s comment');

-- A2's log is invisible to A1
select tests.create_log(:'ws_a', :'a2') as log_a2 \gset
select tests.act_as(:'a1');
select is(
  (select count(*)::int from public.workout_logs where id = :'log_a2')
  + (select count(*)::int from public.log_blocks where log_id = :'log_a2')
  + (select count(*)::int from public.log_exercises where log_id = :'log_a2')
  + (select count(*)::int from public.log_sets where log_id = :'log_a2'),
  0, 'A1 reads nothing of A2''s log');
reset role;

-- Coach A deletes their own comment
select tests.act_as(:'coach_a');
delete from public.workout_log_comments where id = :'c_a';
select is((select count(*)::int from public.workout_log_comments where id = :'c_a'), 0, 'coach A deletes their own comment');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Constraints (as postgres)
select tests.create_log(:'ws_a', :'a1', status => 'in_progress') as active_a1 \gset
select throws_ok(
  format($$select tests.create_log(%L, %L, status => 'in_progress')$$, :'ws_a', :'a1'),
  '23505', null, 'a second in_progress log for A1 is refused');
select lives_ok(
  format($$select tests.create_log(%L, %L, status => 'in_progress')$$, :'ws_a', :'a2'),
  'another client can have their own in_progress log');
select throws_ok(
  format($$update public.log_sets set actual_reps = 1001 where id = %L$$, :'log_a1_set'),
  '23514', null, 'actual_reps 1001 is refused');
select throws_ok(
  format($$update public.log_sets set actual_weight_kg = 1000.5 where id = %L$$, :'log_a1_set'),
  '23514', null, 'actual_weight_kg over 1000 is refused');
select throws_ok(
  format($$update public.workout_logs set finished_at = null where id = %L$$, :'log_a1'),
  '23514', null, 'a completed log needs finished_at');

-- updated_at advances on update
update public.log_sets set updated_at = '2000-01-01' where id = :'log_a1_set';
update public.log_sets set actual_reps = 9 where id = :'log_a1_set';
select ok((select updated_at > '2000-01-02' from public.log_sets where id = :'log_a1_set'), 'log_sets.updated_at advances on update');

-- Deleting the planned workout keeps the log and clears workout_id
delete from public.workouts where id = :'inst_a1';
select is((select workout_id from public.workout_logs where id = :'log_a1'), null::uuid,
  'deleting the planned workout keeps the log with workout_id null');

-- ---------------------------------------------------------------------------------------------
-- Removed client: A1 loses access, coach A keeps the history
select tests.act_as(:'coach_a');
select public.remove_client(:'ws_a', :'a1');
select is((select count(*)::int from public.workout_logs where id = :'log_a1'), 1, 'coach A still reads a removed client''s log');
select is((select count(*)::int from public.log_sets where log_id = :'log_a1'), 2, 'coach A still reads a removed client''s sets');
reset role;
select tests.act_as(:'a1');
select is(
  (select count(*)::int from public.workout_logs)
  + (select count(*)::int from public.log_blocks)
  + (select count(*)::int from public.log_exercises)
  + (select count(*)::int from public.log_sets)
  + (select count(*)::int from public.workout_log_comments),
  0, 'a removed client reads none of their logs');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Deleting a workspace whose logs use its custom exercise succeeds (restrict FK vs cascade order)
select tests.create_exercise(:'ws_b', 'WL B Custom') as ex_b \gset
update public.log_exercises set exercise_id = :'ex_b' where log_id = :'log_b1';
select lives_ok(format($$delete from public.workspaces where id = %L$$, :'ws_b'),
  'a workspace whose logs use its custom exercise can be deleted');
select is((select count(*)::int from public.workout_logs where id = :'log_b1'), 0, 'its logs are deleted with it');

select * from finish();
rollback;
