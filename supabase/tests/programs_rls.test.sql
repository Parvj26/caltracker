begin;
select plan(36);

-- Fixtures (as postgres)
select tests.create_user('pg-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('pg-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('pg-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_workspace('PG Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('PG Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');

select tests.create_workout(:'ws_a', 'PG A Lib 1') as lib_a1 \gset
select tests.create_workout(:'ws_a', 'PG A Lib 2') as lib_a2 \gset
select tests.create_workout(:'ws_b', 'PG B Lib') as lib_b \gset
select tests.create_workout(:'ws_a', 'PG A1 Day', :'a1', '2026-11-10') as inst_a1 \gset

select gen_random_uuid() as prog_a \gset
select gen_random_uuid() as prog_b \gset
select gen_random_uuid() as prog_a6 \gset
insert into public.programs (id, workspace_id, name, weeks) values
  (:'prog_a', :'ws_a', 'A Program', 4),
  (:'prog_b', :'ws_b', 'B Program', 4),
  (:'prog_a6', :'ws_a', 'A Six Weeks', 6);
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog_b', 1, 1, 0, :'lib_b');
select gen_random_uuid() as slot_a \gset
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (:'slot_a', :'prog_a', 1, 1, 0, :'lib_a1');

-- Privileges
select ok(not has_any_column_privilege('anon', 'public.programs', 'select,insert,update')
  and not has_any_column_privilege('anon', 'public.program_workouts', 'select,insert,update')
  and not has_table_privilege('anon', 'public.programs', 'delete')
  and not has_table_privilege('anon', 'public.program_workouts', 'delete'),
  'anon has no privileges on programs or program_workouts');
select ok(not has_column_privilege('authenticated', 'public.programs', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.programs', 'created_by', 'update')
  and not has_column_privilege('authenticated', 'public.programs', 'created_by', 'insert')
  and has_column_privilege('authenticated', 'public.programs', 'weeks', 'update'),
  'authenticated cannot update programs.workspace_id/created_by or insert created_by, can update weeks');
select ok(not has_column_privilege('authenticated', 'public.program_workouts', 'workspace_id', 'insert')
  and not has_column_privilege('authenticated', 'public.program_workouts', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.program_workouts', 'program_id', 'update')
  and not has_column_privilege('authenticated', 'public.program_workouts', 'workout_id', 'update')
  and has_column_privilege('authenticated', 'public.program_workouts', 'day', 'update'),
  'authenticated cannot set or move program_workouts owner/parent columns');
select ok(not has_function_privilege('anon', 'public.is_library_workout_of(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.is_library_workout_of(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_program_weeks(uuid, smallint)', 'execute')
  and has_function_privilege('authenticated', 'public.set_program_weeks(uuid, smallint)', 'execute'),
  'anon cannot call the program functions, authenticated can');

-- Anonymous
select tests.act_as_anon();
select throws_ok('select count(*) from public.programs', '42501', null, 'anon cannot read programs');
select throws_ok('select count(*) from public.program_workouts', '42501', null, 'anon cannot read program_workouts');
select throws_ok(format($q$insert into public.programs (workspace_id, name) values (%L, 'x')$q$, :'ws_a'),
  '42501', null, 'anon cannot insert programs');
select throws_ok(format($q$select public.set_program_weeks(%L, 2::smallint)$q$, :'prog_a'),
  '42501', null, 'anon cannot call set_program_weeks');
reset role;

-- Coach A
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.programs), 2, 'coach A sees only workspace A programs (2)');
select is((select count(*)::int from public.programs where workspace_id = :'ws_b'), 0, 'coach A sees 0 of B programs');
select is((select count(*)::int from public.program_workouts where program_id = :'prog_b'), 0, 'coach A sees 0 of B slots');
select lives_ok(format($q$insert into public.programs (id, workspace_id, name, description) values (gen_random_uuid(), %L, 'New', 'desc')$q$, :'ws_a'),
  'coach A can create a program (weeks defaults to 4)');
select is((select weeks::int from public.programs where name = 'New'), 4, 'weeks defaults to 4');
select is((select created_by from public.programs where name = 'New'), :'coach_a'::uuid, 'created_by defaults to the caller');
select lives_ok(format($q$insert into public.program_workouts (id, program_id, week, day, position, workout_id) values (gen_random_uuid(), %L, 2, 3, 0, %L)$q$, :'prog_a', :'lib_a2'),
  'coach A can add a library workout to a program');
select is((select workspace_id from public.program_workouts where program_id = :'prog_a' and week = 2), :'ws_a'::uuid,
  'slot workspace_id is copied from the program');
select lives_ok(format($q$update public.program_workouts set day = 5, position = 1 where id = %L$q$, :'slot_a'),
  'coach A can move a slot');
select lives_ok(format($q$update public.programs set name = 'Renamed' where id = %L$q$, :'prog_a'), 'coach A can rename a program');
select throws_ok(format($q$insert into public.program_workouts (id, program_id, week, day, position, workout_id) values (gen_random_uuid(), %L, 1, 1, 0, %L)$q$, :'prog_a', :'lib_b'),
  '42501', null, 'coach A cannot add B library workout to A program');
select throws_ok(format($q$insert into public.program_workouts (id, program_id, week, day, position, workout_id) values (gen_random_uuid(), %L, 1, 1, 0, %L)$q$, :'prog_a', :'inst_a1'),
  '42501', null, 'coach A cannot add a client workout instance to a program');
select throws_ok(format($q$insert into public.program_workouts (id, program_id, week, day, position, workout_id) values (gen_random_uuid(), %L, 53, 1, 0, %L)$q$, :'prog_a', :'lib_a1'),
  '23514', null, 'week 53 is rejected');
select throws_ok(format($q$insert into public.program_workouts (id, program_id, week, day, position, workout_id) values (gen_random_uuid(), %L, 1, 0, 0, %L)$q$, :'prog_a', :'lib_a1'),
  '23514', null, 'day 0 is rejected');
select throws_ok(format($q$insert into public.programs (workspace_id, name) values (%L, 'x')$q$, :'ws_b'),
  '42501', null, 'coach A cannot create a program in workspace B');
select is((select count(*)::int from public.program_workouts where program_id = :'prog_a'), 2, 'prog_a holds 2 slots before delete');
select lives_ok(format($q$delete from public.program_workouts where id = %L$q$, :'slot_a'), 'coach A can remove a slot');
select is((select set_program_weeks(:'prog_b', 1::smallint)), 0, 'set_program_weeks on B program removes nothing (RLS)');
select is((select weeks::int from public.programs where id = :'prog_b'), null, 'B program stays invisible and unchanged to coach A');
reset role;
select is((select weeks::int from public.programs where id = :'prog_b'), 4, 'B program weeks still 4');

-- Client A1 sees nothing and writes nothing
select tests.act_as(:'a1');
select is((select count(*)::int from public.programs) + (select count(*)::int from public.program_workouts), 0,
  'client A1 sees no programs or slots');
select throws_ok(format($q$insert into public.programs (workspace_id, name) values (%L, 'x')$q$, :'ws_a'),
  '42501', null, 'client A1 cannot create a program');
with u as (update public.programs set name = 'hacked' returning 1)
select is((select count(*)::int from u), 0, 'client A1 updates 0 programs');
reset role;

-- set_program_weeks shrink
insert into public.program_workouts (program_id, week, day, position, workout_id) values
  (:'prog_a6', 2, 1, 0, :'lib_a1'), (:'prog_a6', 5, 1, 0, :'lib_a1'), (:'prog_a6', 6, 7, 0, :'lib_a2');
select tests.act_as(:'coach_a');
select is((select public.set_program_weeks(:'prog_a6', 4::smallint)), 2, 'set_program_weeks 6 -> 4 returns 2 removed');
reset role;
select is((select array_agg(week order by week) from public.program_workouts where program_id = :'prog_a6'), array[2::smallint],
  'only the week-2 slot remains');

-- Cascades
delete from public.workouts where id = :'lib_a2';
select is((select count(*)::int from public.program_workouts where workout_id = :'lib_a2'), 0, 'deleting a library workout removes its slots');
select is((select count(*)::int from public.programs where id = :'prog_a'), 1, '...but the program stays');
delete from public.programs where id = :'prog_a6';
select is((select count(*)::int from public.program_workouts where program_id = :'prog_a6'), 0, 'deleting a program cascades its slots');

select * from finish();
rollback;
