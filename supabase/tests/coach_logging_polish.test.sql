-- Coach session logging follow-ups (20261107003000_coach_logging_polish.sql):
--   * the phone's final save after a take over (sets ticked but not uploaded yet) is applied once, and only until
--     the coach saves anything; a finish, another client, another workspace's coach can't use it;
--   * a coach can't start a session for a later day's workout; the client's phone still can.
begin;
select plan(38);

select tests.create_user('cp-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('cp-staff-a@t.local', 'Staff A') as staff_a \gset
select tests.create_user('cp-staff-c@t.local', 'Staff C') as staff_c \gset
select tests.create_user('cp-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('cp-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('cp-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_workspace('CP Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('CP Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws_a', :'staff_a', 'staff'), (:'ws_a', :'staff_c', 'staff');

select tests.create_exercise(null, 'CP Builtin') as ex \gset
select tests.create_workout(:'ws_a', 'A1 Today', :'a1', current_date, :'ex') as w_today \gset
select tests.create_workout(:'ws_a', 'A1 Missed', :'a1', current_date - 3, :'ex') as w_missed \gset
select tests.create_workout(:'ws_a', 'A2 Later', :'a2', current_date + 3, :'ex') as w_later \gset

-- A one-exercise doc with one set (rolled back with the test).
create function tests.cp_doc(id uuid, workout_id uuid, status text, revision int, done boolean, reps int default 8)
returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'workoutId', workout_id, 'name', 'Session', 'status', status,
    'startedAt', now() - interval '30 minutes',
    'finishedAt', case when status = 'completed' then to_jsonb(now()) else 'null'::jsonb end,
    'lastActivityAt', now() - interval '1 minute', 'autoFinished', false, 'revision', revision, 'notes', null,
    'blocks', jsonb_build_array(jsonb_build_object('id', ('7c' || substr(id::text, 3))::uuid, 'kind', 'straight',
      'exercises', jsonb_build_array(jsonb_build_object('id', ('7e' || substr(id::text, 3))::uuid,
        'exerciseId', (select e.id from public.exercises e where e.name = 'CP Builtin'),
        'exerciseName', 'CP Builtin', 'trackingType', 'weight_reps', 'plannedWorkoutExerciseId', null,
        'swappedFromExerciseId', null, 'note', null,
        'sets', jsonb_build_array(jsonb_build_object('id', ('75' || substr(id::text, 3))::uuid, 'setType', 'normal',
          'target', jsonb_build_object('repsMin', 8, 'repsMax', 8, 'weightKg', 60, 'durationS', null,
            'distanceM', null, 'toFailure', false, 'restSeconds', 90),
          'actualReps', reps, 'actualWeightKg', 60, 'actualDurationS', null, 'actualDistanceM', null,
          'completedAt', case when done then to_jsonb(now() - interval '2 minutes') else 'null'::jsonb end)))))));
$$;
create function tests.cp_error(sql text) returns text language plpgsql as $$
declare
  v_state text;
  v_hint text;
begin
  execute sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || ' ' || coalesce(nullif(v_hint, ''), '-');
end;
$$;

\set l1 '6d000000-0000-4000-8000-000000000001'
\set l2 '6d000000-0000-4000-8000-000000000002'
\set l3 '6d000000-0000-4000-8000-000000000003'

select has_column('public', 'workout_logs', 'taken_over_from', 'workout_logs remembers who held a log before a take over');

-- ---------------------------------------------------------------------------------------------
-- The client ticks a set on the phone; the coach takes over before the phone has uploaded it.
select tests.act_as(:'a1');
select is(public.save_workout_log(tests.cp_doc(:'l1', :'w_today', 'in_progress', 3, false))->>'applied', 'true',
  'the client logs on the phone');
select tests.act_as(:'coach_a');
select is(public.take_over_workout_log(:'l1'), '{"revision": 3, "status": "in_progress"}'::jsonb, 'the coach takes over');
reset role;
select is((select taken_over_from from public.workout_logs where id = :'l1'), :'a1'::uuid,
  'the take over remembers the client held it');
-- Another client and another workspace's coach can't use the final save.
select tests.act_as(:'a2');
select is(tests.cp_error(format('select public.save_workout_log(%L::jsonb)', tests.cp_doc(:'l1', :'w_today', 'in_progress', 4, true))),
  '42501 -', 'another client can''t save it');
select tests.act_as(:'coach_b');
select is(tests.cp_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cp_doc(:'l1', :'w_today', 'in_progress', 4, true))), '42501 -', 'another workspace''s coach can''t save it');
-- A finish is not a final save: the coach decides when the session ends.
select tests.act_as(:'a1');
select is(public.save_workout_log(tests.cp_doc(:'l1', :'w_today', 'completed', 4, true)),
  '{"applied": false, "revision": 3, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'a finish from the phone after the take over is refused');
-- The phone uploads the set it ticked: applied once, 1000 above the take over's revision (as hand back does), and the
-- answer says the coach logs it now.
select is(public.save_workout_log(tests.cp_doc(:'l1', :'w_today', 'in_progress', 4, true, 12)),
  '{"applied": true, "revision": 1003, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'the phone''s final save is applied, above any revision the coach''s page can hold');
reset role;
select results_eq(format($$select s.actual_reps, s.completed_at is not null, l.logged_by, l.taken_over_from
    from public.log_sets s join public.workout_logs l on l.id = s.log_id where l.id = %L$$, :'l1'),
  format($$values (12::smallint, true, %L::uuid, null::uuid)$$, :'coach_a'),
  'the client''s ticked set is kept, the coach still logs it, and the window is closed');
select tests.act_as(:'a1');
select is(public.save_workout_log(tests.cp_doc(:'l1', :'w_today', 'in_progress', 1004, true, 13)),
  '{"applied": false, "revision": 1003, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'only one final save: the next one is refused');
-- The coach's page counted up from the take over (3) on its own: two edits make 5, above the phone's own 4. Its save
-- is still stale, so it never replaces the log; the page reloads the server copy and re-applies its edits on top.
select tests.act_as(:'coach_a');
select is(public.coach_save_workout_log(:'a1', tests.cp_doc(:'l1', :'w_today', 'in_progress', 5, false, 10)),
  '{"applied": false, "revision": 1003, "status": "in_progress"}'::jsonb,
  'the coach''s copy is stale even with a revision above the phone''s final save');
select is((select actual_reps from public.log_sets where log_id = :'l1'), 12::smallint, 'so the client''s set survives');
select is(public.coach_save_workout_log(:'a1', tests.cp_doc(:'l1', :'w_today', 'in_progress', 1004, true, 10))->>'applied',
  'true', 'the coach''s edit re-applied on top of the client''s final save is applied');

-- ---------------------------------------------------------------------------------------------
-- Once the coach has saved, the phone's queued copy can never overwrite the coach's sets.
select is(public.hand_back_workout_log(:'l1')->>'revision', '2004', 'the coach hands it back');
select is(public.take_over_workout_log(:'l1')->>'revision', '2004', 'and takes it again');
select is(public.coach_save_workout_log(:'a1', tests.cp_doc(:'l1', :'w_today', 'in_progress', 2005, true, 20))->>'applied',
  'true', 'the coach saves first this time');
select tests.act_as(:'a1');
select is(public.save_workout_log(tests.cp_doc(:'l1', :'w_today', 'in_progress', 2500, true, 30)),
  '{"applied": false, "revision": 2005, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'the phone''s copy is refused after the coach saved');
select is((select actual_reps from public.log_sets where log_id = :'l1'), 20::smallint, 'the coach''s numbers stay');

-- The coach who held it (and saved) before another coach took over has the same one final save.
select tests.act_as(:'staff_a');
select lives_ok(format('select public.take_over_workout_log(%L)', :'l1'), 'a staff coach takes it over');
select tests.act_as(:'coach_a');
select is(public.coach_save_workout_log(:'a1', tests.cp_doc(:'l1', :'w_today', 'in_progress', 2006, true, 21)),
  '{"applied": true, "revision": 3005, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'the previous coach''s final save is applied once');
-- ---------------------------------------------------------------------------------------------
-- Only today's and missed workouts can be started by the coach.
select is(tests.cp_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a2',
  tests.cp_doc(:'l2', :'w_later', 'in_progress', 1, false))), '22023 future_workout',
  'the coach can''t start a later day''s workout, even from a direct link');
select tests.act_as(:'a2');
select is(public.save_workout_log(tests.cp_doc(:'l2', :'w_later', 'in_progress', 1, false))->>'applied', 'true',
  'the client can still start it early on the phone');
reset role;
update public.workout_logs set status = 'completed', finished_at = now() where id = :'l1';
select tests.act_as(:'coach_a');
select is(public.coach_save_workout_log(:'a1', tests.cp_doc(:'l3', :'w_missed', 'in_progress', 1, false))->>'applied',
  'true', 'the coach can log a missed workout');

-- ---------------------------------------------------------------------------------------------
-- Coach B takes over from coach A before A saved anything: the client's unsent sets keep their final save.
select lives_ok(format('select public.take_over_workout_log(%L)', :'l2'), 'coach A takes over the client''s workout');
select tests.act_as(:'staff_a');
select lives_ok(format('select public.take_over_workout_log(%L)', :'l2'), 'coach B takes it from A before A saved');
reset role;
select is((select taken_over_from from public.workout_logs where id = :'l2'), :'a2'::uuid,
  'the window still belongs to the client, not to coach A who changed nothing');
select tests.act_as(:'a2');
select is(public.save_workout_log(tests.cp_doc(:'l2', :'w_later', 'in_progress', 2, true, 9)),
  '{"applied": true, "revision": 1001, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'the client''s final save is applied after the second take over');

-- ---------------------------------------------------------------------------------------------
-- Hand back and reclaim close the window: coach A saves, B takes over (window: A), B hands back, the client ticks
-- offline, then C takes over. The window is the client's again, so their final save applies.
select tests.act_as(:'staff_a');
select lives_ok(format('select public.take_over_workout_log(%L)', :'l3'), 'coach B takes over A''s saved session');
reset role;
select is((select taken_over_from from public.workout_logs where id = :'l3'), :'coach_a'::uuid, 'the window is A''s');
select tests.act_as(:'staff_a');
select is(public.hand_back_workout_log(:'l3')->>'revision', '1001', 'coach B hands it back to the client');
reset role;
select is((select taken_over_from from public.workout_logs where id = :'l3'), null::uuid, 'the hand back closes the window');
select tests.act_as(:'staff_c');
select lives_ok(format('select public.take_over_workout_log(%L)', :'l3'), 'coach C takes over before the phone uploaded');
reset role;
select is((select taken_over_from from public.workout_logs where id = :'l3'), :'a1'::uuid, 'the new window is the client''s');
select tests.act_as(:'a1');
select is(public.save_workout_log(tests.cp_doc(:'l3', :'w_missed', 'in_progress', 1002, true, 11)),
  '{"applied": true, "revision": 2001, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'the client''s offline sets get their final save');
select is((select actual_reps from public.log_sets where log_id = :'l3'), 11::smallint, 'and are kept');
-- Reclaim closes it too.
select tests.act_as(:'coach_a');
select lives_ok(format('select public.take_over_workout_log(%L)', :'l3'), 'coach A takes it from coach C');
reset role;
update public.workout_logs set last_activity_at = now() - interval '30 minutes' where id = :'l3';
select tests.act_as(:'a1');
select lives_ok(format('select public.reclaim_workout_log(%L)', :'l3'), 'the client takes it back after 20 minutes');
reset role;
select is((select taken_over_from from public.workout_logs where id = :'l3'), null::uuid, 'the reclaim closes the window');

select * from finish();
rollback;
