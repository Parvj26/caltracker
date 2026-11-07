begin;
select plan(35);

-- Plan at invite: set_invite_plan keeps a program or single workouts with an open invite (coaches of the workspace
-- only, its own library only), and accepting the invite (accept_invite_for or claim_invites) puts them on the new
-- client's calendar. Nobody outside the workspace can read or write another workspace's plans.

-- Live Sync runs at commit (a deferred trigger); a test never commits, so this fires the queued syncs.
create or replace function tests.ip_flush() returns void language plpgsql as $$
begin
  set constraints public.program_live_sync_queue_run immediate;
  set constraints public.program_live_sync_queue_run deferred;
end;
$$;

select (now() at time zone 'UTC')::date as today \gset
select (:'today'::date + 3) as d3, (:'today'::date + 5) as d5, (:'today'::date - 3) as past3 \gset

select tests.create_user('ip-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('ip-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('ip-a1@t.local', 'Client A1') as a1 \gset
select tests.create_workspace('IP Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('IP Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.create_exercise(null, 'IP Builtin') as ex \gset

select tests.create_workout(:'ws_a', 'IP Lib 1', null, null, :'ex') as lib1 \gset
select tests.create_workout(:'ws_a', 'IP Lib 2', null, null, :'ex') as lib2 \gset
select tests.create_workout(:'ws_b', 'IP B Lib', null, null, :'ex') as lib_b \gset
select tests.create_workout(:'ws_a', 'IP A1 copy', :'a1', :'d3', :'ex') as a1_copy \gset
insert into public.programs (workspace_id, name, weeks) values (:'ws_a', 'IP Program', 2) returning id as prog \gset
insert into public.program_workouts (program_id, week, day, workout_id)
values (:'prog', 1, 1, :'lib1'), (:'prog', 1, 3, :'lib2'), (:'prog', 2, 1, :'lib1');
insert into public.programs (workspace_id, name, weeks) values (:'ws_b', 'IP B Program', 1) returning id as prog_b \gset

select tests.create_invite(:'ws_a', 'ip-new1@t.local', 'New One', :'coach_a', 'tok-ip-new1-000000000000') as inv1 \gset
select tests.create_invite(:'ws_a', 'ip-new2@t.local', 'New Two', :'coach_a', 'tok-ip-new2-000000000000') as inv2 \gset
select tests.create_invite(:'ws_a', 'ip-new3@t.local', 'New Three', :'coach_a', 'tok-ip-new3-000000000000') as inv3 \gset
select tests.create_invite(:'ws_b', 'ip-bnew@t.local', 'B New', :'coach_b', 'tok-ip-bnew-000000000000') as inv_b \gset

-- ---------- Table and privileges ----------
select ok((select relrowsecurity from pg_class where oid = 'public.client_invite_plan_items'::regclass), 'plan items have RLS on');
select table_privs_are('public', 'client_invite_plan_items', 'authenticated', array['SELECT'],
  'authenticated can only read plan items (writes go through set_invite_plan)');
select table_privs_are('public', 'client_invite_plan_items', 'anon', array[]::text[], 'anon has no access to plan items');
select ok(not has_function_privilege('anon', 'public.set_invite_plan(uuid, uuid, date, uuid[], date[])', 'execute'),
  'anon cannot call set_invite_plan');
select ok(not has_function_privilege('authenticated', 'public.apply_invite_plan()', 'execute'),
  'nobody can call apply_invite_plan directly');

-- ---------- set_invite_plan ----------
select tests.act_as(:'coach_a');
select is(public.set_invite_plan(:'inv1', :'prog', :'d3'), 1, 'the coach keeps a program with their invite');
select is((select count(*)::int from public.client_invite_plan_items where invite_id = :'inv1'), 1, 'and can read it back');
select is(public.set_invite_plan(:'inv2', null, null, array[:'lib1', :'lib2']::uuid[], array[:'d3', :'d5']::date[]), 2,
  'or single workouts, each on its day');
select is(public.set_invite_plan(:'inv2', null, null, array[:'lib2']::uuid[], array[:'d5']::date[]), 1,
  'a new plan replaces the old one');
select results_eq(format('select workout_id, start_on from public.client_invite_plan_items where invite_id = %L', :'inv2'),
  format('values (%L::uuid, %L::date)', :'lib2', :'d5'), 'only the new plan is kept');
select is(public.set_invite_plan(:'inv3', null, null, array[:'lib1']::uuid[], array[:'d3']::date[]), 1, 'a third invite with a workout');
select is(public.set_invite_plan(:'inv3'), 0, 'nothing clears the plan');
select is(public.set_invite_plan(:'inv3', null, null, array[:'lib1']::uuid[], array[:'d3']::date[]), 1, 'and it can be set again');

select throws_ok(format('select public.set_invite_plan(%L, %L, %L)', :'inv1', :'prog_b', :'d3'), '42501', null,
  'a program from another workspace is refused');
select throws_ok(format('select public.set_invite_plan(%L, null, null, array[%L]::uuid[], array[%L]::date[])', :'inv1', :'lib_b', :'d3'),
  '42501', null, 'a library workout from another workspace is refused');
select throws_ok(format('select public.set_invite_plan(%L, null, null, array[%L]::uuid[], array[%L]::date[])', :'inv1', :'a1_copy', :'d3'),
  '42501', null, 'a client''s calendar workout (not the library) is refused');
select throws_ok(format('select public.set_invite_plan(%L, %L, %L)', :'inv1', :'prog', :'past3'), '22023', null,
  'a start day in the past is refused');
select throws_ok(format('select public.set_invite_plan(%L, %L, %L, array[%L]::uuid[], array[%L]::date[])', :'inv1', :'prog', :'d3', :'lib1', :'d3'),
  '22023', null, 'a program and workouts together are refused');
select throws_ok(format('select public.set_invite_plan(%L, null, null, array[%L, %L]::uuid[], array[%L]::date[])', :'inv1', :'lib1', :'lib2', :'d3'),
  '22023', null, 'a workout without a day is refused');
select throws_ok(format($q$insert into public.client_invite_plan_items (invite_id, workspace_id, workout_id, start_on)
  values (%L, %L, %L, %L)$q$, :'inv1', :'ws_a', :'lib1', :'d3'), '42501', null, 'coaches cannot write plan items directly');

-- ---------- Other workspaces and clients ----------
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.client_invite_plan_items where workspace_id = :'ws_a'), 0,
  'another workspace''s coach sees none of these plans');
select throws_ok(format('select public.set_invite_plan(%L, %L, %L)', :'inv1', :'prog', :'d3'), '42501', null,
  'another workspace''s coach cannot plan for this invite');
select throws_ok(format('select public.set_invite_plan(%L, %L, %L)', :'inv_b', :'prog', :'d3'), '42501', null,
  'nor put this workspace''s program on their own invite');
select tests.act_as(:'a1');
select is((select count(*)::int from public.client_invite_plan_items), 0, 'a client sees no plans');
select throws_ok(format('select public.set_invite_plan(%L, %L, %L)', :'inv1', :'prog', :'d3'), '42501', null,
  'a client cannot plan for an invite');
reset role;

-- ---------- Accepting puts the plan on the calendar ----------
-- A program (accept-invite Edge Function path).
select tests.create_user('ip-new1@t.local', 'New One') as new1 \gset
select is(public.accept_invite_for(:'inv1', :'new1'), 'ok', 'the invite with a program is accepted');
select tests.ip_flush();
select results_eq(format('select program_id, start_date, created_by from public.program_assignments where client_id = %L', :'new1'),
  format('values (%L::uuid, %L::date, %L::uuid)', :'prog', :'d3', :'coach_a'), 'the program is assigned from its start day, by the coach');
select results_eq(format('select scheduled_on, name from public.workouts where client_id = %L order by scheduled_on', :'new1'),
  format($q$values (%L::date, 'IP Lib 1'::text), (%L::date + 2, 'IP Lib 2'::text), (%L::date + 7, 'IP Lib 1'::text)$q$, :'d3', :'d3', :'d3'),
  'its workouts are on the calendar');
select is((select count(*)::int from public.workouts where client_id = :'new1' and created_by is distinct from :'coach_a'::uuid), 0,
  'the copies count as the coach''s');
select is((select count(*)::int from public.client_invite_plan_items where invite_id = :'inv1'), 0, 'the plan is used up');

-- Single workouts, one of them on a day that has passed (claim_invites path: the user signs in themselves).
insert into public.client_invite_plan_items (invite_id, workspace_id, workout_id, start_on, position)
values (:'inv2', :'ws_a', :'lib1', :'past3', 1);
select tests.create_user('ip-new2@t.local', 'New Two') as new2 \gset
select tests.act_as(:'new2');
select is((select count(*)::int from public.claim_invites()), 1, 'the invited user joins by signing in');
reset role;
select results_eq(format('select scheduled_on, name, assignment_id is null from public.workouts where client_id = %L order by scheduled_on', :'new2'),
  format($q$values (%L::date, 'IP Lib 1'::text, true), (%L::date, 'IP Lib 2'::text, true)$q$, :'today', :'d5'),
  'single workouts land on their days, and a passed day moves to the day they join');

-- A plan item that can't be applied (its program belongs to another workspace) is skipped; joining still works.
delete from public.client_invite_plan_items where invite_id = :'inv3';
insert into public.client_invite_plan_items (invite_id, workspace_id, program_id, start_on) values (:'inv3', :'ws_a', :'prog_b', :'d3');
select tests.create_user('ip-new3@t.local', 'New Three') as new3 \gset
select is(public.accept_invite_for(:'inv3', :'new3'), 'ok', 'an unusable plan never blocks joining');
select is((select count(*)::int from public.program_assignments where client_id = :'new3'), 0, 'and nothing is assigned from it');

-- An accepted invite can't get a plan any more.
select tests.act_as(:'coach_a');
select throws_ok(format('select public.set_invite_plan(%L, %L, %L)', :'inv1', :'prog', :'d3'), '55000', null,
  'an accepted invite takes no new plan');
reset role;

select * from finish();
rollback;
