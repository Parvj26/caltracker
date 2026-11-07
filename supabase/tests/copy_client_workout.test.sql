begin;
select plan(25);

-- copy_client_workout: "Copy to…" on a client's calendar workout. It copies the workout as it is (the coach's changes
-- for that client included) onto another day, for the same or other current clients of the same workspace. The copy
-- is a customised single workout (no assignment, no program day), so Live Sync never touches it. Done workouts can be
-- copied as a fresh plan with no log. Nobody outside the workspace can copy in or out.

-- Live Sync runs at commit (a deferred trigger); a test never commits, so this fires the queued syncs.
create or replace function tests.cc_flush() returns void language plpgsql as $$
begin
  set constraints public.program_live_sync_queue_run immediate;
  set constraints public.program_live_sync_queue_run deferred;
end;
$$;

-- Fixtures (as postgres). Days are counted from UTC's today, so Live Sync's window (from the client's today on)
-- covers them.
select (now() at time zone 'UTC')::date as today \gset
select (:'today'::date + 2) as d_start, (:'today'::date + 13) as d20, (:'today'::date + 14) as d21,
  (:'today'::date + 15) as d22, (:'today'::date + 18) as d25 \gset
select tests.create_user('cc-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('cc-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('cc-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('cc-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('cc-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('CC Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('CC Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select tests.create_exercise(null, 'CC Builtin') as ex \gset

-- A1's program copy that the coach customised (a third set added by hand), and a done single workout.
select tests.create_workout(:'ws_a', 'CC Library', null, null, :'ex') as lib \gset
insert into public.programs (workspace_id, name, weeks) values (:'ws_a', 'CC Program', 1) returning id as prog \gset
insert into public.program_workouts (program_id, week, day, workout_id) values (:'prog', 1, 1, :'lib');
select tests.act_as(:'coach_a');
select public.assign_program(gen_random_uuid(), :'prog', :'a1', :'d_start') as asg \gset
reset role;
select id as orig from public.workouts where assignment_id = :'asg' \gset
select id as orig_we from public.workout_exercises where workout_id = :'orig' \gset
insert into public.workout_sets (workout_exercise_id, position, set_type, target_reps_min, target_reps_max, target_weight_kg)
values (:'orig_we', 2, 'normal', 5, 5, 80);
update public.workouts set notes = 'Go heavy today' where id = :'orig';
select tests.create_workout(:'ws_a', 'CC Done', :'a1', '2026-11-03', :'ex') as done \gset
select tests.create_log(:'ws_a', :'a1', :'done', 'completed') as done_log \gset
select tests.create_workout(:'ws_b', 'CC B workout', :'b1', '2026-11-03', :'ex') as b_workout \gset

select gen_random_uuid() as c1 \gset
select gen_random_uuid() as c2 \gset
select gen_random_uuid() as c3 \gset
select gen_random_uuid() as c4 \gset

-- ---------- Copying within the workspace ----------
select tests.act_as(:'coach_a');
select is(public.copy_client_workout(:'orig', :'c1', :'a2', :'d20'), :'c1'::uuid, 'the coach copies A1''s workout to A2');
select is(public.copy_client_workout(:'orig', :'c2', :'a1', :'d21'), :'c2'::uuid, 'and to another day for A1');

reset role;
select results_eq(
  format($$select client_id, scheduled_on, name, notes, assignment_id, planned_on, source_hash, source_workout_id from public.workouts where id = %L$$, :'c1'),
  format($$values (%L::uuid, %L::date, 'CC Library'::text, 'Go heavy today'::text, null::uuid, null::date, null::text, %L::uuid)$$, :'a2', :'d20', :'lib'),
  'the copy is a single workout with the original''s name and notes, no program day or hash, linked to the library workout');
select ok((select customised_at is not null from public.workouts where id = :'c1'), 'the copy is marked customised');
select is((select count(*)::int from public.workout_sets where workout_id = :'c1'), 3, 'it carries the hand-added set (3 sets, not the library''s 2)');
select is((select target_weight_kg::int from public.workout_sets where workout_id = :'c1' and position = 2), 80, 'with its target');
select is((select client_id from public.workout_sets where workout_id = :'c1' limit 1), :'a2'::uuid, 'its rows belong to the new client');
select isnt((select id from public.workout_blocks where workout_id = :'c1'), (select id from public.workout_blocks where workout_id = :'orig'), 'with fresh row ids');
select is((select count(*)::int from public.workouts where assignment_id = :'asg'), 1, 'the program''s own copies are unchanged');

-- ---------- Live Sync leaves the copy alone ----------
select tests.act_as(:'coach_a');
update public.programs set live_sync = true where id = :'prog';
update public.workouts set name = 'CC Library v2' where id = :'lib';
select tests.cc_flush();
reset role;
select is((select name from public.workouts where id = :'c1'), 'CC Library', 'a library change never reaches the copy');
select is((select count(*)::int from public.workouts where id in (:'c1', :'c2')), 2, 'and Live Sync never removes it');
select is((select assignment_id from public.workouts where id = :'c2'), null, 'the copy on A1''s calendar stays outside the program');

-- ---------- A done workout copies as a fresh plan ----------
select tests.act_as(:'coach_a');
select is(public.copy_client_workout(:'done', :'c3', :'a2', :'d22'), :'c3'::uuid, 'a done workout can be copied');
reset role;
select is((select count(*)::int from public.workout_sets where workout_id = :'c3'), 2, 'with its plan');
select is((select count(*)::int from public.workout_logs where workout_id = :'c3'), 0, 'and no log');
select lives_ok(format($$update public.workouts set name = 'Editable' where id = %L$$, :'c3'), 'the copy is not locked like the done original');

-- ---------- Retries ----------
select tests.act_as(:'coach_a');
select is(public.copy_client_workout(:'orig', :'c1', :'a2', :'d20'), :'c1'::uuid, 'a retry with the same id returns it');
reset role;
select is((select count(*)::int from public.workouts where client_id = :'a2' and scheduled_on = :'d20'), 1, 'without a second copy');
select tests.act_as(:'coach_a');
select throws_ok(format($$select public.copy_client_workout(%L, %L, %L, %L)$$, :'orig', :'c1', :'a2', :'d25'),
  '23505', null, 'the same id for a different day is refused');

-- ---------- Refusals ----------
select throws_ok(format($$select public.copy_client_workout(%L, %L, %L, %L)$$, :'orig', :'c4', :'b1', :'d20'),
  '42501', null, 'coach A can''t copy to another workspace''s client');
select throws_ok(format($$select public.copy_client_workout(%L, %L, %L, %L)$$, :'b_workout', :'c4', :'a1', :'d20'),
  '42501', null, 'coach A can''t copy another workspace''s workout');
select throws_ok(format($$select public.copy_client_workout(%L, %L, %L, %L)$$, :'lib', :'c4', :'a1', :'d20'),
  '42501', null, 'a library workout is not a client''s workout (Assign is for those)');
select tests.act_as(:'coach_b');
select throws_ok(format($$select public.copy_client_workout(%L, %L, %L, %L)$$, :'orig', :'c4', :'b1', :'d20'),
  '42501', null, 'coach B can''t copy workspace A''s workout to their own client');
select tests.act_as(:'a1');
select throws_ok(format($$select public.copy_client_workout(%L, %L, %L, %L)$$, :'orig', :'c4', :'a1', :'d20'),
  '42501', null, 'a client can''t copy workouts');
select tests.act_as_anon();
select throws_ok(format($$select public.copy_client_workout(%L, %L, %L, %L)$$, :'orig', :'c4', :'a1', :'d20'),
  '42501', null, 'anon can''t call it');

select * from finish();
rollback;
