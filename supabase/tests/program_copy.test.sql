begin;
select plan(33);

-- Fixtures (as postgres)
select tests.create_user('pc-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('pc-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('pc-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_workspace('PC Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('PC Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');

select tests.create_workout(:'ws_a', 'PC A Lib 1') as lib_a1 \gset
select tests.create_workout(:'ws_a', 'PC A Lib 2') as lib_a2 \gset
select tests.create_workout(:'ws_b', 'PC B Lib') as lib_b \gset

select gen_random_uuid() as prog_a \gset
select gen_random_uuid() as prog_b \gset
insert into public.programs (id, workspace_id, name, description, weeks) values
  (:'prog_a', :'ws_a', 'A Program', 'Four weeks', 4),
  (:'prog_b', :'ws_b', 'B Program', null, 3);
-- A: week 1 has day 1 (two workouts) and day 3; week 2 has day 5.
insert into public.program_workouts (id, program_id, week, day, position, workout_id) values
  (gen_random_uuid(), :'prog_a', 1, 1, 0, :'lib_a1'),
  (gen_random_uuid(), :'prog_a', 1, 1, 1, :'lib_a2'),
  (gen_random_uuid(), :'prog_a', 1, 3, 0, :'lib_a1'),
  (gen_random_uuid(), :'prog_a', 2, 5, 0, :'lib_a2'),
  (gen_random_uuid(), :'prog_b', 1, 2, 0, :'lib_b');

select gen_random_uuid() as copy_a \gset
select gen_random_uuid() as copy_x \gset
select gen_random_uuid() as copy_c \gset
select gen_random_uuid() as copy_y \gset
select gen_random_uuid() as n1 \gset
select gen_random_uuid() as n2 \gset
select gen_random_uuid() as n3 \gset
select gen_random_uuid() as n4 \gset
select gen_random_uuid() as n5 \gset
select gen_random_uuid() as n6 \gset

-- Privileges
select ok(not has_function_privilege('anon', 'public.duplicate_program(uuid, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.duplicate_program(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.copy_program_week(uuid, smallint, smallint[], uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.copy_program_week(uuid, smallint, smallint[], uuid[])', 'execute'),
  'anon cannot call the copy functions, authenticated can');

select tests.act_as_anon();
select throws_ok(format($q$select public.duplicate_program(%L, %L, 'x')$q$, :'copy_x', :'prog_a'),
  '42501', null, 'anon cannot duplicate a program');
select throws_ok(format($q$select * from public.copy_program_week(%L, 1::smallint, '{2}'::smallint[], array[%L]::uuid[])$q$, :'prog_a', :'n1'),
  '42501', null, 'anon cannot copy a program week');
reset role;

-- Coach A duplicates their own program
select tests.act_as(:'coach_a');
select is((select public.duplicate_program(:'copy_a', :'prog_a', '  A Program (copy) ')), :'copy_a'::uuid,
  'coach A can duplicate their program');
select is((select row(name, description, weeks::int, workspace_id)::text from public.programs where id = :'copy_a'),
  row('A Program (copy)', 'Four weeks', 4, :'ws_a'::uuid)::text, 'the copy has the trimmed new name, same details, same workspace');
select is((select count(*)::int from public.program_workouts where program_id = :'copy_a'), 4, 'the copy has all 4 slots');
select is(
  (select array_agg(row(week, day, position, workout_id)::text order by week, day, position) from public.program_workouts where program_id = :'copy_a'),
  (select array_agg(row(week, day, position, workout_id)::text order by week, day, position) from public.program_workouts where program_id = :'prog_a'),
  'the copy''s slots match the original''s weeks, days, order and workouts');
select is((select count(*)::int from public.program_workouts where program_id = :'copy_a' and workspace_id = :'ws_a'), 4,
  'the copied slots belong to workspace A');
select is((select count(*)::int from public.program_workouts where program_id = :'prog_a'), 4, 'the original keeps its 4 slots');

-- Cross-workspace duplicate is refused, both ways, and for a client of the same workspace
select throws_ok(format($q$select public.duplicate_program(%L, %L, 'stolen')$q$, :'copy_x', :'prog_b'),
  '42501', null, 'coach A cannot duplicate workspace B''s program');
reset role;
select is((select count(*)::int from public.programs where id = :'copy_x'), 0, 'no program was made from B''s program');

select tests.act_as(:'coach_b');
select throws_ok(format($q$select public.duplicate_program(%L, %L, 'stolen')$q$, :'copy_y', :'prog_a'),
  '42501', null, 'coach B cannot duplicate workspace A''s program');
reset role;
select is((select count(*)::int from public.programs where id = :'copy_y'), 0, 'no program was made from A''s program');

select tests.act_as(:'a1');
select throws_ok(format($q$select public.duplicate_program(%L, %L, 'mine')$q$, :'copy_c', :'prog_a'),
  '42501', null, 'a client cannot duplicate their coach''s program');
reset role;
select is((select count(*)::int from public.programs where id = :'copy_c'), 0, 'no program was made by the client');

-- Coach A copies week 1 (3 workouts) onto weeks 2 and 3 of the copy, replacing week 2's one workout
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.copy_program_week(:'copy_a', 1::smallint, '{2,3}'::smallint[],
    array[:'n1', :'n2', :'n3', :'n4', :'n5', :'n6']::uuid[])),
  6, 'copy_program_week returns the 6 new slots');
select is((select array_agg(id order by week, day, position) from public.program_workouts where program_id = :'copy_a' and week in (2, 3)),
  array[:'n1', :'n2', :'n3', :'n4', :'n5', :'n6']::uuid[], 'the new slots keep the ids the browser made, in week, day, position order');
select is(
  (select array_agg(row(day, position, workout_id)::text order by day, position) from public.program_workouts where program_id = :'copy_a' and week = 3),
  (select array_agg(row(day, position, workout_id)::text order by day, position) from public.program_workouts where program_id = :'copy_a' and week = 1),
  'week 3 now holds week 1''s workouts on the same days, in the same order');
select is((select count(*)::int from public.program_workouts where program_id = :'copy_a' and week = 2 and day = 5), 0,
  'week 2''s old workout is gone');
select is((select count(*)::int from public.program_workouts where program_id = :'copy_a' and week = 1), 3, 'week 1 is untouched');

-- Bounds and stale pages
select throws_ok(format($q$select * from public.copy_program_week(%L, 1::smallint, '{5}'::smallint[], array[%L, %L, %L]::uuid[])$q$, :'copy_a', :'n1', :'n2', :'n3'),
  '23514', null, 'a week past the end of the program is refused');
select throws_ok(format($q$select * from public.copy_program_week(%L, 1::smallint, '{1}'::smallint[], array[%L, %L, %L]::uuid[])$q$, :'copy_a', :'n1', :'n2', :'n3'),
  '23514', null, 'copying a week onto itself is refused');
select throws_ok(format($q$select * from public.copy_program_week(%L, 1::smallint, '{3,2}'::smallint[], array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()])$q$, :'copy_a'),
  '23514', null, 'target weeks out of order are refused');
select throws_ok(format($q$select * from public.copy_program_week(%L, 1::smallint, '{2,2}'::smallint[], array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()])$q$, :'copy_a'),
  '23514', null, 'a repeated target week is refused');
select throws_ok(format($q$select * from public.copy_program_week(%L, 1::smallint, '{4}'::smallint[], array[gen_random_uuid(), gen_random_uuid()])$q$, :'copy_a'),
  '23514', null, 'a number of ids that does not match the source week is refused');
select throws_ok(format($q$select * from public.copy_program_week(%L, 4::smallint, '{2}'::smallint[], array[gen_random_uuid()])$q$, :'copy_a'),
  '23514', null, 'an empty source week is refused');
select is((select array_agg(id order by day, position) from public.program_workouts where program_id = :'copy_a' and week = 2),
  array[:'n1', :'n2', :'n3']::uuid[], 'refused copies leave week 2 as it was');

-- Cross-workspace copies are refused, both ways, and for a client of the same workspace
select throws_ok(format($q$select * from public.copy_program_week(%L, 1::smallint, '{2}'::smallint[], array[gen_random_uuid()])$q$, :'prog_b'),
  '42501', null, 'coach A cannot copy a week of workspace B''s program');
reset role;
select is((select count(*)::int from public.program_workouts where program_id = :'prog_b'), 1, 'B''s program keeps its one slot');

select tests.act_as(:'coach_b');
select throws_ok(format($q$select * from public.copy_program_week(%L, 1::smallint, '{4}'::smallint[], array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()])$q$, :'copy_a'),
  '42501', null, 'coach B cannot copy a week of workspace A''s program');
select is((select count(*)::int from public.programs where id = :'copy_a'), 0, 'coach B cannot see A''s copied program');
reset role;

select tests.act_as(:'a1');
select throws_ok(format($q$select * from public.copy_program_week(%L, 1::smallint, '{4}'::smallint[], array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()])$q$, :'copy_a'),
  '42501', null, 'a client cannot copy a week of their coach''s program');
reset role;
select is((select count(*)::int from public.program_workouts where program_id = :'copy_a' and week = 4), 0,
  'week 4 of A''s copy is still empty after the refused copies');

select * from finish();
rollback;
