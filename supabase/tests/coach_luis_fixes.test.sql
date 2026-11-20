begin;
select plan(35);

-- create_client_workout ("+ New workout" on a client's calendar), untouched_library_copies (the ⋯ menu's "In
-- Library") and rename_invite (the pending-invite window). Nobody outside the workspace can use them on its data.

select (now() at time zone 'UTC')::date as today \gset
select (:'today'::date + 2) as d2, (:'today'::date + 4) as d4 \gset
select tests.create_user('clf-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('clf-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('clf-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('clf-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('CLF Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('CLF Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_b', :'b1');
select tests.create_exercise(null, 'CLF Builtin') as ex \gset

select gen_random_uuid() as w1 \gset
select gen_random_uuid() as b1blk \gset
select gen_random_uuid() as e1 \gset
select gen_random_uuid() as s1 \gset
select jsonb_build_object('id', :'w1', 'name', '  Vaishali Upper ', 'notes', null, 'blocks', jsonb_build_array(
  jsonb_build_object('id', :'b1blk', 'kind', 'straight', 'exercises', jsonb_build_array(
    jsonb_build_object('id', :'e1', 'exerciseId', :'ex', 'exerciseName', 'ignored', 'sets', jsonb_build_array(
      jsonb_build_object('id', :'s1', 'setType', 'normal', 'targetRepsMin', 10, 'targetRepsMax', 10, 'restSeconds', 90))))))) as doc \gset

-- ---------- create_client_workout ----------
select tests.act_as(:'coach_a');
select is(public.create_client_workout(:'ws_a', :'a1', :'today', :'doc'), :'w1'::uuid, 'the coach adds a new workout to A1''s day');
reset role;
select results_eq(
  format($$select client_id, scheduled_on, name, assignment_id, source_workout_id, source_hash from public.workouts where id = %L$$, :'w1'),
  format($$values (%L::uuid, %L::date, 'Vaishali Upper'::text, null::uuid, null::uuid, null::text)$$, :'a1', :'today'),
  'it is a single workout on that day, from no library workout or program');
select ok((select customised_at is not null from public.workouts where id = :'w1'), 'it counts as customised from the start');
select is((select count(*)::int from public.workout_sets where workout_id = :'w1'), 1, 'its sets are saved');
select is((select client_id from public.workout_sets where workout_id = :'w1'), :'a1'::uuid, 'and belong to the client');
select is((select count(*)::int from public.workouts where workspace_id = :'ws_a' and client_id is null and name = 'Vaishali Upper'), 0,
  'nothing is added to the library');
select is((select count(*)::int from public.push_outbox where type = 'workout_assigned' and group_key = 'workout_assigned:' || :'w1'), 1,
  'the client gets one new-workout push');
select is((select count(*)::int from public.push_outbox where group_key = 'workout_changed:' || :'w1'), 0,
  'and no changed-workout push for it');

select tests.act_as(:'coach_a');
select is(public.create_client_workout(:'ws_a', :'a1', :'today', :'doc'), :'w1'::uuid, 'a retry with the same id saves it again');
reset role;
select is((select count(*)::int from public.workouts where id = :'w1'), 1, 'without a second workout');

select tests.act_as(:'coach_a');
select throws_ok(format($$select public.create_client_workout(%L, %L, %L, %L)$$, :'ws_a', :'a1', :'d2', jsonb_set(:'doc'::jsonb, '{blocks}', '[]')),
  '23514', null, 'save_workout''s checks still apply (an empty workout is refused)');
reset role;
select tests.create_workout(:'ws_a', 'CLF Library', null, null, :'ex') as lib \gset
select tests.act_as(:'coach_a');
select throws_ok(format($$select public.create_client_workout(%L, %L, %L, %L)$$, :'ws_a', :'a1', :'d2', jsonb_set(:'doc'::jsonb, '{id}', to_jsonb(:'lib'::text))),
  '23505', null, 'a library workout''s id can''t be reused');
select throws_ok(format($$select public.create_client_workout(%L, %L, %L, %L)$$, :'ws_a', :'b1', :'d2', jsonb_set(:'doc'::jsonb, '{id}', to_jsonb(gen_random_uuid()::text))),
  '42501', null, 'coach A can''t add to another workspace''s client');
select throws_ok(format($$select public.create_client_workout(%L, %L, %L, %L)$$, :'ws_b', :'b1', :'d2', jsonb_set(:'doc'::jsonb, '{id}', to_jsonb(gen_random_uuid()::text))),
  '42501', null, 'or into another workspace');
-- Another workspace's custom exercise can't be put in (save_workout runs as the coach, under RLS).
reset role;
select tests.create_exercise(:'ws_b', 'CLF B custom') as ex_b \gset
select gen_random_uuid() as w_foreign \gset
select tests.act_as(:'coach_a');
select jsonb_build_object('id', :'w_foreign', 'name', 'Foreign', 'notes', null, 'blocks', jsonb_build_array(
  jsonb_build_object('id', gen_random_uuid(), 'kind', 'straight', 'exercises', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'exerciseId', :'ex_b', 'exerciseName', 'ignored', 'sets', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'setType', 'normal', 'targetRepsMin', 5, 'targetRepsMax', 5))))))) as doc_foreign \gset
select throws_ok(format($$select public.create_client_workout(%L, %L, %L, %L)$$, :'ws_a', :'a1', :'d2', :'doc_foreign'),
  '42501', null, 'another workspace''s custom exercise is refused');
reset role;
select is((select count(*)::int from public.workouts where id = :'w_foreign'), 0, 'and nothing is left behind');
select is((select count(*)::int from public.workout_exercises where exercise_id = :'ex_b'), 0, 'the foreign exercise is not used anywhere');
select is((select prosecdef from pg_proc where proname = 'create_client_workout'), false, 'create_client_workout runs as the caller');
select tests.act_as(:'coach_b');
select throws_ok(format($$select public.create_client_workout_row(%L, %L, %L, %L, 'x', null)$$, :'ws_a', :'a1', :'d2', gen_random_uuid()),
  '42501', null, 'another coach can''t add a calendar row to workspace A');
select tests.act_as(:'a1');
select throws_ok(format($$select public.create_client_workout(%L, %L, %L, %L)$$, :'ws_a', :'a1', :'d2', jsonb_set(:'doc'::jsonb, '{id}', to_jsonb(gen_random_uuid()::text))),
  '42501', null, 'a client can''t add workouts');
select tests.act_as_anon();
select throws_ok(format($$select public.create_client_workout(%L, %L, %L, %L)$$, :'ws_a', :'a1', :'today', :'doc'),
  '42501', null, 'anon can''t call it');

-- ---------- untouched_library_copies ----------
select gen_random_uuid() as c1 \gset
select gen_random_uuid() as c2 \gset
select gen_random_uuid() as c3 \gset
select tests.act_as(:'coach_a');
select public.schedule_workout(:'c1', :'lib', :'a1', :'d2');
select public.schedule_workout(:'c2', :'lib', :'a1', :'d4');
select public.schedule_workout(:'c3', :'lib', :'a1', :'d4');
update public.workouts set notes = 'Just for A1' where id = :'c2';
select set_eq(format($$select public.untouched_library_copies(array[%L, %L, %L, %L]::uuid[])$$, :'c1', :'c2', :'c3', :'w1'),
  format($$values (%L::uuid), (%L::uuid)$$, :'c1', :'c3'),
  'untouched copies are in the library; an edited copy and a workout made for the client are not');
update public.workouts set name = 'CLF Library v2' where id = :'lib';
select is((select count(*)::int from public.untouched_library_copies(array[:'c1', :'c3']::uuid[])), 0,
  'once the library workout changes, its old copies no longer match it');
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.untouched_library_copies(array[:'c1', :'c2', :'c3']::uuid[])), 0,
  'another workspace''s coach learns nothing');
select tests.act_as(:'a1');
select is((select count(*)::int from public.untouched_library_copies(array[:'c1', :'c3']::uuid[])), 0, 'nor does the client');

-- ---------- rename_invite ----------
reset role;
select tests.create_invite(:'ws_a', 'ana@t.local', 'Ana Torres', :'coach_a', 'clf-token-1') as inv \gset
select tests.create_invite(:'ws_b', 'bo@t.local', 'Bo B', :'coach_b', 'clf-token-2') as inv_b \gset
select tests.act_as(:'coach_a');
select lives_ok(format($$select public.rename_invite(%L, '  Ana ', ' Maria Torres ')$$, :'inv'), 'the coach renames an invite');
select results_eq(format($$select first_name, last_name, full_name from public.client_invites where id = %L$$, :'inv'),
  $$values ('Ana'::text, 'Maria Torres'::text, 'Ana Maria Torres'::text)$$, 'trimmed, with the full name following');
select throws_ok(format($$select public.rename_invite(%L, '  ', 'X')$$, :'inv'), '22023', null, 'a first name is needed');
select throws_ok(format($$select public.rename_invite(%L, %L, 'X')$$, :'inv', repeat('a', 101)), '22023', null, 'of at most 100 characters');
select throws_ok(format($$select public.rename_invite(%L, 'Bo', 'X')$$, :'inv_b'), '42501', null, 'coach A can''t rename another workspace''s invite');
select tests.act_as(:'a1');
select throws_ok(format($$select public.rename_invite(%L, 'Me', 'X')$$, :'inv'), '42501', null, 'a client can''t rename invites');
select tests.act_as_anon();
select throws_ok(format($$select public.rename_invite(%L, 'Me', 'X')$$, :'inv'), '42501', null, 'nor can anon');
reset role;
update public.client_invites set accepted_at = now(), accepted_by = :'a1' where id = :'inv';
select tests.act_as(:'coach_a');
select throws_ok(format($$select public.rename_invite(%L, 'Ana', 'T')$$, :'inv'), '55000', null, 'an accepted invite can''t be renamed');
reset role;
select is((select first_name from public.client_invites where id = :'inv_b'), 'Bo', 'workspace B''s invite is unchanged');
select is((select count(*)::int from public.client_invites where workspace_id = :'ws_a'), 1, 'renaming never adds invites');

select * from finish();
rollback;
