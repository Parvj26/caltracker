begin;
select plan(35);

select tests.create_user('ef-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('ef-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('ef-a1@t.local', 'Client A1') as a1 \gset
select tests.create_workspace('EF Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('EF Workspace B', :'coach_b') as ws_b \gset
select tests.create_user('ef-a2@t.local', 'Client A2') as a2 \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');

select tests.create_exercise(null, 'EF Built-in') as ex_builtin \gset
select tests.create_exercise(:'ws_a', 'EF Custom A') as ex_custom \gset
select tests.create_exercise(:'ws_a', 'EF Old') as ex_old \gset
select tests.create_exercise(:'ws_a', 'EF Mid') as ex_mid \gset
select tests.create_exercise(:'ws_a', 'EF New') as ex_new \gset
select tests.create_exercise(:'ws_b', 'EF Other WS') as ex_b \gset
select tests.create_exercise(null, 'EF A2 Only') as ex_a2 \gset

-- Structure and privileges
select has_table('public', 'exercise_favorites', 'exercise_favorites exists');
select ok((select relrowsecurity from pg_class where oid = 'public.exercise_favorites'::regclass), 'RLS enabled');
select ok(not has_table_privilege('anon', 'public.exercise_favorites', 'select,insert,update,delete')
  and not has_any_column_privilege('anon', 'public.exercise_favorites', 'select,insert,update'),
  'anon has no privileges on exercise_favorites');
select ok(not has_any_column_privilege('authenticated', 'public.exercise_favorites', 'update'),
  'authenticated cannot update favourites');
select ok(not has_function_privilege('anon', 'public.recent_exercises_for_coach(int)', 'execute')
  and not has_function_privilege('anon', 'public.recent_exercises_for_client(int)', 'execute'),
  'anon cannot run the recents functions');

-- Seed recents (as postgres). Coach A's workouts: old, mid, new (new used twice); coach B's workout in ws B.
insert into public.workouts (workspace_id, name, created_by, created_at) values
  (:'ws_a', 'W old', :'coach_a', now() - interval '3 days') returning id as w_old \gset
insert into public.workouts (workspace_id, name, created_by, created_at) values
  (:'ws_a', 'W mid', :'coach_a', now() - interval '2 days') returning id as w_mid \gset
insert into public.workouts (workspace_id, name, created_by, created_at) values
  (:'ws_a', 'W new', :'coach_a', now() - interval '1 day') returning id as w_new \gset
insert into public.workouts (workspace_id, name, created_by, created_at) values
  (:'ws_b', 'W other', :'coach_b', now()) returning id as w_b \gset
insert into public.workout_blocks (workout_id, position) values (:'w_old', 0) returning id as b_old \gset
insert into public.workout_blocks (workout_id, position) values (:'w_mid', 0) returning id as b_mid \gset
insert into public.workout_blocks (workout_id, position) values (:'w_new', 0) returning id as b_new \gset
insert into public.workout_blocks (workout_id, position) values (:'w_b', 0) returning id as b_b \gset
insert into public.workout_exercises (block_id, position, exercise_id) values
  (:'b_old', 0, :'ex_old'), (:'b_mid', 0, :'ex_mid'), (:'b_new', 0, :'ex_new'), (:'b_new', 1, :'ex_new'),
  (:'b_b', 0, :'ex_b');

-- Client A1 logs: ex_old completed 3 days ago, ex_new completed 1 day ago, ex_mid only in progress/discarded.
insert into public.workout_logs (workspace_id, client_id, name, status, started_at, finished_at)
  values (:'ws_a', :'a1', 'L1', 'completed', now() - interval '3 days', now() - interval '3 days')
  returning id as l1 \gset
insert into public.workout_logs (workspace_id, client_id, name, status, started_at, finished_at)
  values (:'ws_a', :'a1', 'L2', 'completed', now() - interval '1 day', now() - interval '1 day')
  returning id as l2 \gset
insert into public.workout_logs (workspace_id, client_id, name, status, started_at)
  values (:'ws_a', :'a1', 'L3', 'in_progress', now()) returning id as l3 \gset
insert into public.log_blocks (log_id, position) values (:'l1', 0) returning id as lb1 \gset
insert into public.log_blocks (log_id, position) values (:'l2', 0) returning id as lb2 \gset
insert into public.log_blocks (log_id, position) values (:'l3', 0) returning id as lb3 \gset
-- Client A2 (same workspace) has a completed log of a different exercise.
insert into public.workout_logs (workspace_id, client_id, name, status, started_at, finished_at)
  values (:'ws_a', :'a2', 'L4', 'completed', now(), now()) returning id as l4 \gset
insert into public.log_blocks (log_id, position) values (:'l4', 0) returning id as lb4 \gset
insert into public.log_exercises (block_id, position, exercise_id) values
  (:'lb1', 0, :'ex_old'), (:'lb2', 0, :'ex_new'), (:'lb2', 1, :'ex_new'), (:'lb3', 0, :'ex_mid'), (:'lb4', 0, :'ex_a2');
-- Client A3 did a pick-one group: picked ex_pick, never did ex_unpicked.
select tests.create_user('ef-a3@t.local', 'Client A3') as a3 \gset
select tests.add_client(:'ws_a', :'a3');
select tests.create_exercise(null, 'EF Picked') as ex_pick \gset
select tests.create_exercise(null, 'EF Unpicked') as ex_unpicked \gset
insert into public.workout_logs (workspace_id, client_id, name, status, started_at, finished_at)
  values (:'ws_a', :'a3', 'L5', 'completed', now(), now()) returning id as l5 \gset
insert into public.log_blocks (log_id, position, kind) values (:'l5', 0, 'choice') returning id as lb5 \gset
insert into public.log_exercises (block_id, position, exercise_id) values (:'lb5', 0, :'ex_pick') returning id as le_pick \gset
insert into public.log_exercises (block_id, position, exercise_id) values (:'lb5', 1, :'ex_unpicked');
update public.log_blocks set picked_exercise_id = :'le_pick' where id = :'lb5';

-- Coach A: star, list, unstar
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.exercise_favorites (exercise_id) values (%L)$$, :'ex_builtin'),
  'coach stars a built-in exercise');
select lives_ok(format($$insert into public.exercise_favorites (exercise_id) values (%L)$$, :'ex_custom'),
  'coach stars a custom exercise');
select results_eq($$select exercise_id from public.exercise_favorites order by exercise_id$$,
  format($$select x from (values (%L::uuid), (%L::uuid)) v(x) order by x$$, :'ex_builtin', :'ex_custom'),
  'coach lists own favourites');
select is((select coach_id from public.exercise_favorites limit 1), :'coach_a'::uuid, 'coach_id defaults to the caller');
select throws_ok(format($$insert into public.exercise_favorites (exercise_id) values (%L)$$, :'ex_builtin'),
  '23505', null, 'starring twice is refused');
select throws_ok(format($$insert into public.exercise_favorites (coach_id, exercise_id) values (%L, %L)$$,
  :'coach_b', :'ex_builtin'), '42501', null, 'coach cannot set coach_id (no column privilege)');
select throws_ok(format($$insert into public.exercise_favorites (exercise_id) values (%L)$$, :'ex_b'),
  '42501', null, 'coach cannot star another workspace''s custom exercise');
delete from public.exercise_favorites where exercise_id = :'ex_custom';
select is((select count(*)::int from public.exercise_favorites), 1, 'coach unstars an exercise');
select lives_ok(format($$insert into public.exercise_favorites (exercise_id) values (%L)$$, :'ex_custom'),
  'coach re-stars the custom exercise');

-- Recents for coach A: new, mid, old, newest first; only own items
select results_eq($$select exercise_id from public.recent_exercises_for_coach()$$,
  format($$values (%L::uuid), (%L::uuid), (%L::uuid)$$, :'ex_new', :'ex_mid', :'ex_old'),
  'coach recents are distinct and newest first');
select results_eq($$select exercise_id from public.recent_exercises_for_coach(2)$$,
  format($$values (%L::uuid), (%L::uuid)$$, :'ex_new', :'ex_mid'), 'coach recents honour p_limit');
select is((select count(*)::int from public.recent_exercises_for_coach() where exercise_id = :'ex_b'), 0,
  'coach recents never include another workspace''s workouts');
select is((select count(*)::int from public.recent_exercises_for_client()), 0, 'a coach has no client recents');
select is((select count(*)::int from public.recent_exercises_for_coach(-5)), 0, 'a negative limit returns nothing');
select is((select count(*)::int from public.recent_exercises_for_coach(null)), 3, 'a null limit uses the default');

-- Coach B sees nothing of A's favourites and cannot delete them
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.exercise_favorites), 0, 'another coach sees none of the favourites');
delete from public.exercise_favorites where coach_id = :'coach_a';
reset role;
select is((select count(*)::int from public.exercise_favorites where coach_id = :'coach_a'), 2,
  'another coach cannot delete the favourites');
select tests.act_as(:'coach_b');
select results_eq($$select exercise_id from public.recent_exercises_for_coach()$$,
  format($$values (%L::uuid)$$, :'ex_b'), 'coach B recents contain only coach B''s own items');

-- A coach of one workspace who is only a client of another cannot star that other workspace's custom exercise
reset role;
select tests.add_client(:'ws_a', :'coach_b');
select tests.act_as(:'coach_b');
select throws_ok(format($$insert into public.exercise_favorites (exercise_id) values (%L)$$, :'ex_custom'),
  '42501', null, 'cannot star a custom exercise of a workspace the caller does not coach');

-- Client
select tests.act_as(:'a1');
select throws_ok(format($$insert into public.exercise_favorites (exercise_id) values (%L)$$, :'ex_builtin'),
  '42501', null, 'a client cannot insert a favourite');
select is((select count(*)::int from public.exercise_favorites), 0, 'a client sees no favourites');
select results_eq($$select exercise_id from public.recent_exercises_for_client()$$,
  format($$values (%L::uuid), (%L::uuid)$$, :'ex_new', :'ex_old'),
  'client recents are completed logs only, newest first');
select is((select count(*)::int from public.recent_exercises_for_client() where exercise_id = :'ex_a2'), 0,
  'client recents never include another client''s logs');
select results_eq($$select exercise_id from public.recent_exercises_for_client(1)$$,
  format($$values (%L::uuid)$$, :'ex_new'), 'client recents honour p_limit');
select is((select count(*)::int from public.recent_exercises_for_coach()), 0, 'a client has no coach recents');

select tests.act_as(:'a2');
select results_eq($$select exercise_id from public.recent_exercises_for_client()$$,
  format($$values (%L::uuid)$$, :'ex_a2'), 'client A2 recents contain only A2''s own log');

select tests.act_as(:'a3');
select results_eq($$select exercise_id from public.recent_exercises_for_client()$$,
  format($$values (%L::uuid)$$, :'ex_pick'), 'client recents hold the picked option of a pick-one group');
select is((select count(*)::int from public.recent_exercises_for_client() where exercise_id = :'ex_unpicked'), 0,
  'client recents leave out a pick-one option that was not picked');

-- Anonymous
select tests.act_as_anon();
select throws_ok($$select * from public.exercise_favorites$$, '42501', null, 'anon cannot read favourites');
reset role;

-- Cascade: deleting a custom exercise removes its favourites (no workout uses ex_custom)
delete from public.exercises where id = :'ex_custom';
select is((select count(*)::int from public.exercise_favorites where exercise_id = :'ex_custom'), 0,
  'deleting a custom exercise removes its favourites');

select * from finish();
rollback;
