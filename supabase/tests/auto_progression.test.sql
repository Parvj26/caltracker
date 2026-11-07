-- Automatic progression (20261107001000_auto_progression.sql): the programs.auto_progression switch and
-- progression_history, which serves a client's last two completed sessions of each exercise for one planned workout.
begin;
select plan(30);

-- Fixtures (as postgres). A client belongs to one workspace; A1 also has an old log from workspace B (a former
-- coach), which must never count in workspace A.
select tests.create_user('ap-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('ap-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('ap-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('ap-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('ap-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('AP Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('AP Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

select tests.create_exercise(null, 'AP Bench') as bench \gset
select tests.create_exercise(null, 'AP Squat') as squat \gset
update public.exercises set primary_muscles = '{chest}' where id = :'bench';
update public.exercises set primary_muscles = '{quadriceps}' where id = :'squat';

select gen_random_uuid() as prog_on \gset
select gen_random_uuid() as prog_off \gset
select gen_random_uuid() as prog_b \gset
select gen_random_uuid() as asg_on \gset
select gen_random_uuid() as asg_off \gset
select gen_random_uuid() as asg_a2 \gset
select gen_random_uuid() as asg_b \gset
insert into public.programs (id, workspace_id, name, weeks, live_sync) values (:'prog_on', :'ws_a', 'On', 4, false);
insert into public.programs (id, workspace_id, name, weeks, live_sync, auto_progression)
  values (:'prog_off', :'ws_a', 'Off', 4, false, false);
insert into public.programs (id, workspace_id, name, weeks, live_sync) values (:'prog_b', :'ws_b', 'B', 4, false);
insert into public.program_assignments (id, workspace_id, client_id, program_id, program_name, weeks, start_date) values
  (:'asg_on', :'ws_a', :'a1', :'prog_on', 'On', 4, '2026-11-01'),
  (:'asg_off', :'ws_a', :'a1', :'prog_off', 'Off', 4, '2026-11-01'),
  (:'asg_a2', :'ws_a', :'a2', :'prog_on', 'On', 4, '2026-11-01'),
  (:'asg_b', :'ws_b', :'b1', :'prog_b', 'B', 4, '2026-11-01');

select tests.create_workout(:'ws_a', 'Today', :'a1', '2026-11-10', :'bench') as w_on \gset
select tests.create_workout(:'ws_a', 'Off Today', :'a1', '2026-11-10', :'bench') as w_off \gset
select tests.create_workout(:'ws_a', 'A2 Today', :'a2', '2026-11-10', :'bench') as w_a2 \gset
select tests.create_workout(:'ws_a', 'Unplanned day', :'a1', '2026-11-10', :'bench') as w_free \gset
select tests.create_workout(:'ws_b', 'B Today', :'b1', '2026-11-10', :'bench') as w_b \gset
update public.workouts set assignment_id = :'asg_on' where id = :'w_on';
update public.workouts set assignment_id = :'asg_off' where id = :'w_off';
update public.workouts set assignment_id = :'asg_a2' where id = :'w_a2';
update public.workouts set assignment_id = :'asg_b' where id = :'w_b';

-- A completed log of one exercise: one working set per reps entry (null = not done), all at one weight.
create function tests.ap_log(ws uuid, client uuid, workout uuid, ex uuid, finished timestamptz, reps int[], kg numeric,
  status text default 'completed')
returns uuid language plpgsql as $$
declare
  l uuid;
  b uuid;
  le uuid;
  i int;
begin
  insert into public.workout_logs (workspace_id, client_id, workout_id, name, status, started_at, finished_at,
    last_activity_at, logged_by)
  values (ws, client, workout, 'Log', status::public.log_status, finished - interval '1 hour', finished, finished, client)
  returning id into l;
  insert into public.log_blocks (log_id, position, kind) values (l, 0, 'straight') returning id into b;
  insert into public.log_exercises (block_id, position, exercise_id) values (b, 0, ex) returning id into le;
  for i in 1 .. array_length(reps, 1) loop
    insert into public.log_sets (log_exercise_id, position, set_type, target_reps_min, target_reps_max,
      actual_reps, actual_weight_kg, completed_at)
    values (le, i - 1, 'normal', 8, 10, reps[i], case when reps[i] is null then null else kg end,
      case when reps[i] is null then null else finished end);
  end loop;
  return l;
end;
$$;

-- A1's bench history in workspace A: three sessions (only the last two count), the newest with an undone set.
select tests.ap_log(:'ws_a', :'a1', null, :'bench', now() - interval '9 days', array[10, 10], 50) as l_old \gset
select tests.ap_log(:'ws_a', :'a1', null, :'bench', now() - interval '5 days', array[8, 7], 60) as l_mid \gset
select tests.ap_log(:'ws_a', :'a1', null, :'bench', now() - interval '2 days', array[10, null], 60) as l_new \gset
-- Not counted: nothing done, a log of this very workout, a discarded log, and workspace B.
select tests.ap_log(:'ws_a', :'a1', null, :'bench', now() - interval '1 day', array[null]::int[], 70) as l_empty \gset
select tests.ap_log(:'ws_a', :'a1', :'w_on', :'bench', now() - interval '1 hour', array[12], 80) as l_self \gset
select tests.ap_log(:'ws_a', :'a1', null, :'bench', now() - interval '3 hours', array[12], 90, 'discarded') as l_discarded \gset
select tests.ap_log(:'ws_b', :'a1', null, :'bench', now() - interval '2 hours', array[12], 100) as l_former \gset
-- B1's bench in workspace B.
select tests.ap_log(:'ws_b', :'b1', null, :'bench', now() - interval '2 days', array[9], 30) as l_b \gset
-- A1's squat (one session) and A2's bench.
select tests.ap_log(:'ws_a', :'a1', null, :'squat', now() - interval '3 days', array[10], 100) as l_squat \gset
select tests.ap_log(:'ws_a', :'a2', null, :'bench', now() - interval '2 days', array[10], 40) as l_a2 \gset

create function tests.ap_rows(workout uuid, ex uuid[]) returns int language sql as $$
  select count(*)::int from public.progression_history(workout, ex);
$$;

-- Schema and privileges
select col_not_null('public', 'programs', 'auto_progression', 'programs.auto_progression is not null');
select is((select column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'programs' and column_name = 'auto_progression'), 'true',
  'new programs have Auto progression on by default');
select is((select auto_progression from public.programs where id = :'prog_b'), true, 'a program inserted without it is on');
select ok(has_column_privilege('authenticated', 'public.programs', 'auto_progression', 'update')
  and has_column_privilege('authenticated', 'public.programs', 'auto_progression', 'insert'),
  'signed-in users may write the switch (RLS decides whose programs)');
select is((select prosecdef from pg_proc where oid = 'public.progression_history(uuid, uuid[])'::regprocedure), true,
  'progression_history is security definer');
select ok(not has_function_privilege('anon', 'public.progression_history(uuid, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.progression_history(uuid, uuid[])', 'execute'),
  'anon cannot run progression_history; signed-in users can');

-- The client's own history
select tests.act_as(:'a1');
select results_eq(
  format($q$select session, completed, actual_reps::int, actual_weight_kg::numeric(7,1)
    from public.progression_history(%L, array[%L]::uuid[])$q$, :'w_on', :'bench'),
  $$values (1, true, 10, 60.0::numeric(7,1)), (1, false, null::int, null::numeric(7,1)),
    (2, true, 8, 60.0::numeric(7,1)), (2, true, 7, 60.0::numeric(7,1))$$,
  'the client gets their last two sessions, newest first, with undone sets; older, empty, own-workout, discarded and other-workspace logs are left out');
select is((select array_agg(distinct primary_muscles[1]) from public.progression_history(:'w_on', array[:'bench', :'squat']::uuid[])),
  array['chest', 'quadriceps'], 'each row carries the exercise''s primary muscles');
select is((select count(distinct session)::int from public.progression_history(:'w_on', array[:'squat']::uuid[])), 1,
  'an exercise with one session returns one');
select is(tests.ap_rows(:'w_on', array[]::uuid[]), 0, 'no exercises asked, no rows');
select is(tests.ap_rows(:'w_off', array[:'bench']::uuid[]), 0, 'nothing when the program has Auto progression off');
select is(tests.ap_rows(:'w_free', array[:'bench']::uuid[]), 0, 'nothing for a workout not from a program');
select is(tests.ap_rows(gen_random_uuid(), array[:'bench']::uuid[]), 0, 'nothing for an unknown workout');
-- Cross-client: A1 asks about A2's workout.
select is(tests.ap_rows(:'w_a2', array[:'bench']::uuid[]), 0, 'a client gets nothing for another client''s workout');
-- Cross-workspace: A1 asks about workspace B's workout.
select is(tests.ap_rows(:'w_b', array[:'bench']::uuid[]), 0, 'a client gets nothing for another workspace''s workout');
select is((select count(*)::int from public.progression_history(:'w_on', array[:'bench']::uuid[]) where actual_weight_kg = 100), 0,
  'a log from a former workspace never shows');
-- The client can't change the switch.
update public.programs set auto_progression = false where id = :'prog_on';
reset role;
select is((select auto_progression from public.programs where id = :'prog_on'), true, 'a client cannot switch Auto progression');

-- A2 sees their own.
select tests.act_as(:'a2');
select is((select array_agg(actual_weight_kg::int) from public.progression_history(:'w_a2', array[:'bench']::uuid[])),
  array[40], 'another client gets only their own history');
select is(tests.ap_rows(:'w_on', array[:'bench']::uuid[]), 0, 'and nothing for A1''s workout');
reset role;

-- The coach of workspace A
select tests.act_as(:'coach_a');
select is(tests.ap_rows(:'w_on', array[:'bench']::uuid[]), 4, 'the coach gets the same rows as the client');
select is(tests.ap_rows(:'w_b', array[:'bench']::uuid[]), 0, 'coach A gets nothing for a workspace B workout');
update public.programs set auto_progression = false where id = :'prog_on';
select is((select auto_progression from public.programs where id = :'prog_on'), false, 'the coach can switch it off');
select is(tests.ap_rows(:'w_on', array[:'bench']::uuid[]), 0, 'switched off, there is no history to suggest from');
update public.programs set auto_progression = true where id = :'prog_on';
select is((select auto_progression from public.programs where id = :'prog_on'), true, 'and back on');
update public.programs set auto_progression = false where id = :'prog_b';
reset role;
select is((select auto_progression from public.programs where id = :'prog_b'), true,
  'coach A cannot switch workspace B''s program');

-- The coach of workspace B
select tests.act_as(:'coach_b');
select is(tests.ap_rows(:'w_on', array[:'bench']::uuid[]), 0, 'coach B gets nothing for a workspace A workout');
select is((select array_agg(actual_weight_kg::int) from public.progression_history(:'w_b', array[:'bench']::uuid[])),
  array[30], 'coach B gets only their own client''s history');
reset role;

-- Anon
select tests.act_as_anon();
select throws_ok(format('select * from public.progression_history(%L, array[%L]::uuid[])', :'w_on', :'bench'), '42501',
  null, 'anon cannot run progression_history');
reset role;

-- A removed client gets nothing; their coach still can.
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'a1';
select tests.act_as(:'a1');
select is(tests.ap_rows(:'w_on', array[:'bench']::uuid[]), 0, 'a removed client gets nothing');
reset role;
select tests.act_as(:'coach_a');
select is(tests.ap_rows(:'w_on', array[:'bench']::uuid[]), 4, 'the coach still sees a removed client''s history');
reset role;

select * from finish();
rollback;
