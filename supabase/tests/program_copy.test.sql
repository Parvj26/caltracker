begin;
select plan(23);

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

-- Privileges
select ok(not has_function_privilege('anon', 'public.duplicate_program(uuid, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.duplicate_program(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.replace_program_weeks(uuid, smallint[], jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.replace_program_weeks(uuid, smallint[], jsonb)', 'execute'),
  'anon cannot call the copy functions, authenticated can');

select tests.act_as_anon();
select throws_ok(format($q$select public.duplicate_program(%L, %L, 'x')$q$, :'copy_x', :'prog_a'),
  '42501', null, 'anon cannot duplicate a program');
select throws_ok(format($q$select public.replace_program_weeks(%L, '{2}'::smallint[], '[]'::jsonb)$q$, :'prog_a'),
  '42501', null, 'anon cannot replace program weeks');
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

-- Cross-workspace duplicate is refused
select throws_ok(format($q$select public.duplicate_program(%L, %L, 'stolen')$q$, :'copy_x', :'prog_b'),
  '42501', null, 'coach A cannot duplicate workspace B''s program');
reset role;
select is((select count(*)::int from public.programs where id = :'copy_x'), 0, 'no program was made from B''s program');

-- A client of workspace A cannot duplicate A's program
select tests.act_as(:'a1');
select throws_ok(format($q$select public.duplicate_program(%L, %L, 'mine')$q$, :'copy_c', :'prog_a'),
  '42501', null, 'a client cannot duplicate their coach''s program');
reset role;
select is((select count(*)::int from public.programs where id = :'copy_c'), 0, 'no program was made by the client');

-- Coach A copies week 1 onto weeks 2 and 3 of the copy (replacing week 2's slot)
select tests.act_as(:'coach_a');
select is((select public.replace_program_weeks(:'copy_a', '{2,3}'::smallint[], jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'week', 2, 'day', 1, 'position', 0, 'workoutId', :'lib_a1'),
    jsonb_build_object('id', gen_random_uuid(), 'week', 2, 'day', 3, 'position', 0, 'workoutId', :'lib_a2'),
    jsonb_build_object('id', gen_random_uuid(), 'week', 3, 'day', 1, 'position', 0, 'workoutId', :'lib_a1')))),
  3, 'replace_program_weeks returns how many slots it added');
select is((select array_agg(row(week, day)::text order by week, day) from public.program_workouts where program_id = :'copy_a' and week in (2, 3)),
  array[row(2, 1)::text, row(2, 3)::text, row(3, 1)::text], 'weeks 2 and 3 hold exactly the new slots (week 2''s old slot is gone)');
select is((select count(*)::int from public.program_workouts where program_id = :'copy_a' and week = 1), 3, 'week 1 is untouched');

select throws_ok(format($q$select public.replace_program_weeks(%L, '{5}'::smallint[], '[]'::jsonb)$q$, :'copy_a'),
  '23514', null, 'a week past the end of the program is refused');
select throws_ok(format($q$select public.replace_program_weeks(%L, '{2}'::smallint[], %L::jsonb)$q$, :'copy_a',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'week', 4, 'day', 1, 'position', 0, 'workoutId', :'lib_a1'))),
  '23514', null, 'a slot outside the replaced weeks is refused');
select throws_ok(format($q$select public.replace_program_weeks(%L, '{2}'::smallint[], %L::jsonb)$q$, :'copy_a',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'week', 2, 'day', 1, 'position', 0, 'workoutId', :'lib_b'))),
  '42501', null, 'a slot pointing at workspace B''s workout is refused');
select is((select count(*)::int from public.program_workouts where program_id = :'copy_a' and week = 2), 2,
  'a refused replace leaves the week as it was');

-- Cross-workspace replace is refused
select throws_ok(format($q$select public.replace_program_weeks(%L, '{1}'::smallint[], '[]'::jsonb)$q$, :'prog_b'),
  '42501', null, 'coach A cannot replace weeks of workspace B''s program');
reset role;
select is((select count(*)::int from public.program_workouts where program_id = :'prog_b'), 1, 'B''s program keeps its slot');

-- Coach B cannot see A's copy
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.programs where id = :'copy_a'), 0, 'coach B cannot see A''s copied program');
reset role;

select * from finish();
rollback;
