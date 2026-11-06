begin;
select plan(88);

-- Fixtures (as postgres)
select tests.create_user('as-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('as-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('as-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('as-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('as-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('AS Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('AS Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

select tests.create_workout(:'ws_a', 'Upper A') as up \gset
select tests.create_workout(:'ws_a', 'Lower A') as lo \gset
select tests.create_workout(:'ws_a', 'Full A') as ful \gset
select tests.create_workout(:'ws_b', 'B Lib') as lib_b \gset
select tests.create_workout(:'ws_a', 'A1 Day', :'a1', '2026-11-10') as inst_a1 \gset
-- Upper A sits in a section, so its copies must carry the section.
select gen_random_uuid() as up_sec \gset
update public.workout_blocks set section_id = :'up_sec', section_name = 'Upper' where workout_id = :'up';
-- Pick A: a pick-one group of two options in a Core section, for schedule_workout.
select tests.create_workout(:'ws_a', 'Pick A') as pick \gset
select gen_random_uuid() as pick_sec \gset
update public.workout_blocks set kind = 'choice', section_id = :'pick_sec', section_name = 'Core'
  where workout_id = :'pick';
insert into public.workout_exercises (block_id, position, exercise_id)
select b.id, 1, tests.create_exercise(null, 'Pick A option two') from public.workout_blocks b where b.workout_id = :'pick'
returning id as pick_opt2 \gset
insert into public.workout_sets (workout_exercise_id, position, set_type, target_reps_min, target_reps_max)
values (:'pick_opt2', 0, 'normal', 12, 12);
select gen_random_uuid() as sw_pick \gset

select gen_random_uuid() as prog \gset
select gen_random_uuid() as prog_b \gset
insert into public.programs (id, workspace_id, name, weeks) values
  (:'prog', :'ws_a', 'Strength 2', 2),
  (:'prog_b', :'ws_b', 'B Program', 1);
-- W1D1, W1D3, W2D1 x2 (positions 0 and 1). The week-3 slot lies beyond the program's 2 weeks and is not copied.
insert into public.program_workouts (program_id, week, day, position, workout_id) values
  (:'prog', 2, 1, 1, :'ful'),
  (:'prog', 1, 3, 0, :'lo'),
  (:'prog', 2, 1, 0, :'up'),
  (:'prog', 1, 1, 0, :'up'),
  (:'prog', 3, 1, 0, :'up');
insert into public.program_workouts (program_id, week, day, position, workout_id) values (:'prog_b', 1, 1, 0, :'lib_b');

select gen_random_uuid() as asg1 \gset
select gen_random_uuid() as asg2 \gset
select gen_random_uuid() as asg_x \gset
select gen_random_uuid() as sw1 \gset
select gen_random_uuid() as sw_x \gset

-- Privileges
select ok(not has_any_column_privilege('anon', 'public.program_assignments', 'select,insert,update')
  and not has_table_privilege('anon', 'public.program_assignments', 'delete'),
  'anon has no privileges on program_assignments');
select table_privs_are('public', 'program_assignments', 'authenticated', array['SELECT'],
  'authenticated can only select program_assignments (writes go through functions)');
select ok(not has_any_column_privilege('authenticated', 'public.program_assignments', 'insert,update'),
  'authenticated has no column insert/update privilege on program_assignments');
select ok(not has_function_privilege('anon', 'public.copy_workout(uuid, uuid, date, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.copy_workout(uuid, uuid, date, uuid, uuid)', 'execute'),
  'copy_workout is internal: neither anon nor authenticated can execute it');
select ok(not has_function_privilege('anon', 'public.assign_program(uuid, uuid, uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.schedule_workout(uuid, uuid, uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.unassign_program(uuid, date)', 'execute'),
  'anon cannot call assign_program, schedule_workout or unassign_program');
select ok(has_function_privilege('authenticated', 'public.assign_program(uuid, uuid, uuid, date)', 'execute')
  and has_function_privilege('authenticated', 'public.schedule_workout(uuid, uuid, uuid, date)', 'execute')
  and has_function_privilege('authenticated', 'public.unassign_program(uuid, date)', 'execute'),
  'authenticated can call assign_program, schedule_workout and unassign_program (they check the coach)');
select ok(not has_column_privilege('authenticated', 'public.workouts', 'assignment_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workouts', 'assignment_id', 'update'),
  'authenticated cannot set workouts.assignment_id directly');
select fk_ok('public', 'workouts', 'assignment_id', 'public', 'program_assignments', 'id',
  'workouts.assignment_id references program_assignments');
select has_trigger('public', 'program_assignments', 'program_assignments_touch_updated_at',
  'program_assignments maintains updated_at');

-- Anonymous
select tests.act_as_anon();
select throws_ok('select count(*) from public.program_assignments', '42501', null, 'anon cannot read program_assignments');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg_x', :'prog', :'a1', '2026-11-09'),
  '42501', null, 'anon cannot call assign_program');
reset role;

-- Coach A assigns the program to A1 (and to A2 for the unassign-everything case)
select tests.act_as(:'coach_a');
select is(public.assign_program(:'asg1', :'prog', :'a1', '2026-11-09'), :'asg1'::uuid,
  'assign_program returns the assignment id');
select is(public.assign_program(:'asg2', :'prog', :'a2', '2026-11-30'), :'asg2'::uuid,
  'coach A assigns the program to A2 as well');
reset role;

select is((select array_agg(scheduled_on order by scheduled_on, name) from public.workouts where assignment_id = :'asg1'),
  array['2026-11-09', '2026-11-11', '2026-11-16', '2026-11-16']::date[],
  'A1 gets 4 instances on 11-09, 11-11, 11-16, 11-16 (the week-3 slot is skipped)');
select is((select array_agg(name order by scheduled_on, name) from public.workouts where assignment_id = :'asg1'),
  array['Upper A', 'Lower A', 'Full A', 'Upper A'],
  'each instance has its template''s name');
select is((select count(*)::int from public.workouts where assignment_id = :'asg1'
    and client_id = :'a1' and workspace_id = :'ws_a' and source_workout_id is not null
    and created_by = :'coach_a'), 4,
  'every instance has client A1, workspace A, a source workout and created_by coach A');
select is((select count(*)::int from public.workouts w join public.workouts s on s.id = w.source_workout_id
    where w.assignment_id = :'asg1' and s.client_id is null and s.name = w.name), 4,
  'each instance points at its library template');
select results_eq(
  format($$select program_id, program_name, weeks::int, start_date, end_date, cancelled_on, client_id, workspace_id, created_by
    from public.program_assignments where id = %L$$, :'asg1'),
  format($$values (%L::uuid, 'Strength 2'::text, 2, '2026-11-09'::date, '2026-11-22'::date, null::date, %L::uuid, %L::uuid, %L::uuid)$$,
    :'prog', :'a1', :'ws_a', :'coach_a'),
  'the assignment snapshots name and weeks, end_date is 2026-11-22');
select is((select count(*)::int from public.workout_blocks b join public.workouts w on w.id = b.workout_id
    where w.assignment_id = :'asg1' and b.client_id = :'a1' and b.workspace_id = :'ws_a'), 4,
  'instances have 4 blocks, owned by A1');
select is((select count(*)::int from public.workout_exercises e join public.workouts w on w.id = e.workout_id
    where w.assignment_id = :'asg1' and e.client_id = :'a1'), 4, 'instances have 4 exercises, owned by A1');
select is((select count(*)::int from public.workout_sets s join public.workouts w on w.id = s.workout_id
    where w.assignment_id = :'asg1' and s.client_id = :'a1'), 8, 'instances have 8 sets, owned by A1');
select is((select count(*)::int from public.workout_sets s
    join public.workout_exercises e on e.id = s.workout_exercise_id
    join public.workout_blocks b on b.id = e.block_id
    join public.workouts w on w.id = b.workout_id
    where w.assignment_id = :'asg1' and s.workout_id = w.id and e.workout_id = w.id), 8,
  'every copied set hangs off a copied exercise and block of the same instance');
select is((select count(*)::int from public.workout_blocks b join public.workouts w on w.id = b.workout_id
    where w.assignment_id = :'asg1'
    and b.id in (select id from public.workout_blocks where workout_id in (:'up', :'lo', :'ful'))), 0,
  'copied blocks have fresh ids');
select is((select count(*)::int from public.workout_sets s join public.workouts w on w.id = s.workout_id
    where w.assignment_id = :'asg1'
    and s.id in (select id from public.workout_sets where workout_id in (:'up', :'lo', :'ful'))), 0,
  'copied sets have fresh ids');
-- Every copied set equals its template set at the same block/exercise/set position.
select is((select count(*)::int
  from public.workout_sets s
  join public.workout_exercises e on e.id = s.workout_exercise_id
  join public.workout_blocks b on b.id = e.block_id
  join public.workouts w on w.id = b.workout_id
  join public.workout_blocks tb on tb.workout_id = w.source_workout_id and tb.position = b.position and tb.kind = b.kind
  join public.workout_exercises te on te.block_id = tb.id and te.position = e.position and te.exercise_id = e.exercise_id
    and te.note is not distinct from e.note
  join public.workout_sets ts on ts.workout_exercise_id = te.id and ts.position = s.position
    and ts.set_type = s.set_type
    and ts.target_reps_min is not distinct from s.target_reps_min
    and ts.target_reps_max is not distinct from s.target_reps_max
    and ts.target_weight_kg is not distinct from s.target_weight_kg
    and ts.target_duration_s is not distinct from s.target_duration_s
    and ts.target_distance_m is not distinct from s.target_distance_m
    and ts.to_failure = s.to_failure and ts.rest_seconds = s.rest_seconds
    and ts.note is not distinct from s.note
  where w.assignment_id = :'asg1'), 8,
  'every copied set has the same positions and targets as its template');
select is((select count(*)::int from public.workouts where assignment_id = :'asg2'), 4, 'A2 also gets 4 instances');
select results_eq(
  format($$select b.kind::text, b.section_id, b.section_name from public.workout_blocks b
    join public.workouts w on w.id = b.workout_id where w.assignment_id = %L and w.name = 'Upper A'$$, :'asg1'),
  format($$values ('straight'::text, %L::uuid, 'Upper'::text), ('straight', %L::uuid, 'Upper')$$, :'up_sec', :'up_sec'),
  'assign_program copies each block''s section id and name');

-- Idempotency (Review Focus 4)
select tests.act_as(:'coach_a');
select is(public.assign_program(:'asg1', :'prog', :'a1', '2026-11-09'), :'asg1'::uuid,
  'assign_program again with the same id returns the id');
select is((select count(*)::int from public.workouts where assignment_id = :'asg1'), 4,
  'retrying assign_program still leaves 4 instances');
select is((select count(*)::int from public.workouts where client_id = :'a1'), 5,
  'A1 has 4 program instances plus the earlier one-off workout');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg1', :'prog', :'a2', '2026-11-09'),
  '23505', null, 'the same assignment id with another client is refused (23505)');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg1', :'prog', :'a1', '2026-11-10'),
  '23505', null, 'the same assignment id with another start date is refused (23505)');
reset role;
select is((select count(*)::int from public.workouts where assignment_id = :'asg1'), 4, 'still 4 instances after the refusals');

-- Authorization
select tests.act_as(:'coach_a');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg_x', :'prog', :'b1', '2026-11-09'),
  '42501', null, 'coach A cannot assign to B1 (a client of another workspace)');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg_x', :'prog_b', :'a1', '2026-11-09'),
  '42501', null, 'coach A cannot assign B''s program');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg_x', :'prog', :'coach_a', '2026-11-09'),
  '42501', null, 'coach A cannot assign to someone who is not a client (themselves)');
select throws_ok(format('select public.copy_workout(%L, %L, %L, null, %L)', :'up', :'a1', '2026-11-20', :'sw_x'),
  '42501', null, 'coach A cannot call copy_workout (no execute)');
reset role;
select tests.act_as(:'coach_b');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg_x', :'prog', :'b1', '2026-11-09'),
  '42501', null, 'coach B cannot assign A''s program to B1');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg_x', :'prog', :'a1', '2026-11-09'),
  '42501', null, 'coach B cannot assign A''s program to A1');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg1', :'prog', :'a1', '2026-11-09'),
  '42501', null, 'coach B cannot replay A''s assignment id');
reset role;
select tests.act_as(:'a1');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg_x', :'prog', :'a1', '2026-11-09'),
  '42501', null, 'client A1 cannot call assign_program');
reset role;
select is((select count(*)::int from public.program_assignments where id = :'asg_x'), 0, 'no assignment was created by refused calls');
select is((select count(*)::int from public.workouts where client_id = :'b1'), 0, 'B1 got no workouts');

-- schedule_workout: one library workout onto a date
select tests.act_as(:'coach_a');
select is(public.schedule_workout(:'sw1', :'up', :'a1', '2026-11-12'), :'sw1'::uuid, 'schedule_workout returns the new id');
select is(public.schedule_workout(:'sw1', :'up', :'a1', '2026-11-12'), :'sw1'::uuid, 'schedule_workout again with the same id returns it');
select throws_ok(format('select public.schedule_workout(%L, %L, %L, %L)', :'sw1', :'up', :'a2', '2026-11-12'),
  '23505', null, 'the same new id with another client is refused (23505)');
select throws_ok(format('select public.schedule_workout(%L, %L, %L, %L)', :'sw_x', :'inst_a1', :'a1', '2026-11-13'),
  '42501', null, 'a client instance cannot be the source of schedule_workout');
select throws_ok(format('select public.schedule_workout(%L, %L, %L, %L)', :'sw_x', :'lib_b', :'a1', '2026-11-13'),
  '42501', null, 'coach A cannot schedule B''s library workout');
select throws_ok(format('select public.schedule_workout(%L, %L, %L, %L)', :'sw_x', :'up', :'b1', '2026-11-13'),
  '42501', null, 'coach A cannot schedule onto B1');
reset role;
select tests.act_as(:'coach_b');
select throws_ok(format('select public.schedule_workout(%L, %L, %L, %L)', :'sw_x', :'up', :'a1', '2026-11-13'),
  '42501', null, 'coach B cannot schedule A''s library workout for A1');
reset role;
select tests.act_as(:'a1');
select throws_ok(format('select public.schedule_workout(%L, %L, %L, %L)', :'sw_x', :'up', :'a1', '2026-11-13'),
  '42501', null, 'client A1 cannot call schedule_workout');
reset role;
select results_eq(
  format($$select client_id, scheduled_on, assignment_id, source_workout_id, name from public.workouts where id = %L$$, :'sw1'),
  format($$values (%L::uuid, '2026-11-12'::date, null::uuid, %L::uuid, 'Upper A'::text)$$, :'a1', :'up'),
  'the scheduled workout is a one-off instance of Upper A on 2026-11-12');
select is((select count(*)::int from public.workouts where id = :'sw1') * 100
    + (select count(*)::int from public.workout_sets where workout_id = :'sw1'), 102,
  'schedule_workout twice made 1 workout with its 2 sets');
select is((select count(*)::int from public.workouts where id = :'sw_x'), 0, 'refused schedule calls created nothing');
select tests.act_as(:'coach_a');
select is(public.schedule_workout(:'sw_pick', :'pick', :'a1', '2026-11-13'), :'sw_pick'::uuid,
  'schedule_workout copies a workout with a pick-one group');
reset role;
select results_eq(
  format($$select kind::text, section_id, section_name from public.workout_blocks where workout_id = %L$$, :'sw_pick'),
  format($$values ('choice'::text, %L::uuid, 'Core'::text)$$, :'pick_sec'),
  'the copy keeps the pick-one kind and the section id and name');
select is((select count(*)::int from public.workout_exercises where workout_id = :'sw_pick') * 100
    + (select count(*)::int from public.workout_sets where workout_id = :'sw_pick'), 203,
  'the copy keeps both options and their 3 sets');

-- Template edited or deleted after assignment (Review Focus 1)
update public.workout_sets set target_weight_kg = 100 where workout_id = :'up' and position = 0;
update public.workouts set name = 'Upper A v2' where id = :'up';
select is((select array_agg(distinct target_weight_kg) from public.workout_sets s join public.workouts w on w.id = s.workout_id
    where w.client_id = :'a1' and w.source_workout_id = :'up' and s.position = 0), array[60::numeric(7,3)],
  'editing the template''s weight leaves A1''s copies at 60 kg');
select is((select count(*)::int from public.workouts where client_id = :'a1' and source_workout_id = :'up' and name = 'Upper A'), 3,
  'renaming the template leaves A1''s copies named Upper A');
update public.workout_sets set target_weight_kg = 75
  where workout_id = (select id from public.workouts where assignment_id = :'asg1' and scheduled_on = '2026-11-09') and position = 0;
select is((select target_weight_kg from public.workout_sets where workout_id = :'up' and position = 0), 100::numeric(7,3),
  'editing a client copy leaves the template alone');
delete from public.workouts where id = :'lo';
select is((select count(*)::int from public.workouts where assignment_id = :'asg1' and scheduled_on = '2026-11-11'
    and source_workout_id is null and name = 'Lower A'), 1,
  'deleting the template keeps A1''s copy, with source_workout_id null');
select is((select count(*)::int from public.workout_sets s join public.workouts w on w.id = s.workout_id
    where w.assignment_id = :'asg1' and w.scheduled_on = '2026-11-11'), 2, '...and the copy keeps its sets');
delete from public.programs where id = :'prog';
select is((select program_id from public.program_assignments where id = :'asg1'), null::uuid,
  'deleting the program sets the assignment''s program_id to null');
select is((select program_name from public.program_assignments where id = :'asg1'), 'Strength 2',
  '...and keeps the snapshotted name');
select is((select count(*)::int from public.workouts where assignment_id in (:'asg1', :'asg2')), 8,
  '...and all instances survive');

-- Reading assignments
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.program_assignments), 2, 'coach A sees both assignments');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.program_assignments), 0, 'coach B sees no assignments of workspace A');
select throws_ok(format('select public.unassign_program(%L, %L)', :'asg1', '2026-11-01'),
  '42501', null, 'coach B cannot unassign A''s assignment');
reset role;
select tests.act_as(:'a1');
select is((select array_agg(id) from public.program_assignments), array[:'asg1'::uuid], 'A1 sees only their own assignment');
select is((select count(*)::int from public.program_assignments where id = :'asg2'), 0, 'A1 cannot see A2''s assignment');
select throws_ok(format($q$update public.program_assignments set start_date = '2026-12-01' where id = %L$q$, :'asg1'),
  '42501', null, 'A1 cannot change their assignment''s start date');
select throws_ok(format($q$delete from public.program_assignments where id = %L$q$, :'asg1'),
  '42501', null, 'A1 cannot delete their assignment');
select throws_ok(format('select public.unassign_program(%L, %L)', :'asg1', '2026-11-01'),
  '42501', null, 'A1 cannot unassign');
reset role;
select is((select count(*)::int from public.workouts where assignment_id = :'asg1'), 4, 'refused unassigns deleted nothing');

-- Unassign
select tests.act_as(:'coach_a');
select is(public.unassign_program(:'asg1', '2026-11-16'), 2, 'unassign from 2026-11-16 deletes 2 workouts');
reset role;
select is((select array_agg(scheduled_on order by scheduled_on) from public.workouts where assignment_id = :'asg1'),
  array['2026-11-09', '2026-11-11']::date[], 'the 11-09 and 11-11 instances remain');
select is((select cancelled_on from public.program_assignments where id = :'asg1'), '2026-11-16'::date,
  'cancelled_on is 2026-11-16');
select is((select count(*)::int from public.workouts where id in (:'sw1', :'inst_a1')), 2,
  'A1''s one-off workouts are not touched by unassign');
select is((select count(*)::int from public.workouts where assignment_id = :'asg2'), 4, 'A2''s instances are not touched');
select tests.act_as(:'coach_a');
select is(public.unassign_program(:'asg2', '2026-11-01'), 4, 'unassign A2 from 2026-11-01 deletes all 4 workouts');
reset role;
select is((select count(*)::int from public.program_assignments where id = :'asg2'), 0,
  'with no workouts left the assignment row is deleted');
select is((select count(*)::int from public.workouts where client_id = :'a2'), 0, 'A2 has no workouts left');

-- A removed client sees none of their assignments; the coach still does
select gen_random_uuid() as prog2 \gset
insert into public.programs (id, workspace_id, name, weeks) values (:'prog2', :'ws_a', 'Another', 1);
insert into public.program_workouts (program_id, week, day, position, workout_id) values (:'prog2', 1, 1, 0, :'up');
select tests.act_as(:'coach_a');
select lives_ok(format('select public.remove_client(%L, %L)', :'ws_a', :'a1'), 'coach A removes A1');
select is((select count(*)::int from public.program_assignments where id = :'asg1'), 1, 'coach A still sees A1''s assignment');
select throws_ok(format('select public.assign_program(%L, %L, %L, %L)', :'asg_x', :'prog2', :'a1', '2026-12-07'),
  '42501', null, 'coach A cannot assign to removed A1');
select lives_ok(format('select public.assign_program(gen_random_uuid(), %L, %L, %L)', :'prog2', :'a2', '2026-12-07'),
  '...while the same program can still be assigned to current client A2');
select throws_ok(format('select public.schedule_workout(%L, %L, %L, %L)', :'sw_x', :'up', :'a1', '2026-12-07'),
  '42501', null, 'coach A cannot schedule onto removed A1');
reset role;
select tests.act_as(:'a1');
select is((select count(*)::int from public.program_assignments), 0, 'removed A1 sees none of their assignments');
reset role;

select * from finish();
rollback;
