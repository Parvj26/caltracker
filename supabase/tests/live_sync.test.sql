begin;
select plan(52);

-- Live Sync runs at commit (a deferred trigger). A test never commits, so tests.flush() fires the queued syncs the
-- way a commit would: switching the trigger to immediate runs everything queued so far.
create or replace function tests.flush() returns void language plpgsql as $$
begin
  set constraints public.program_live_sync_queue_run immediate;
  set constraints public.program_live_sync_queue_run deferred;
end;
$$;
grant execute on function tests.flush() to authenticated, anon;

-- Fixtures (as postgres). Clients' time zone is UTC (the default), so their today is UTC's.
select (now() at time zone 'UTC')::date as today \gset
select tests.create_user('ls-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('ls-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('ls-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('ls-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('ls-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('LS Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('LS Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

select tests.create_workout(:'ws_a', 'Lib One') as lib1 \gset
select tests.create_workout(:'ws_a', 'Lib Two') as lib2 \gset
select tests.create_workout(:'ws_a', 'Lib Three') as lib3 \gset
select tests.create_workout(:'ws_b', 'Lib B') as lib_b \gset

select gen_random_uuid() as prog \gset
select gen_random_uuid() as prog_b \gset
select gen_random_uuid() as asg1 \gset
select gen_random_uuid() as asg2 \gset
select gen_random_uuid() as asg_b \gset
select gen_random_uuid() as slot_w2d5 \gset
select gen_random_uuid() as slot_w1d1 \gset
select gen_random_uuid() as slot_w1d3 \gset
select gen_random_uuid() as slot_w2d1 \gset
select gen_random_uuid() as slot_w2d2 \gset

-- Columns and defaults
select is((select column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'programs' and column_name = 'live_sync'), 'true',
  'new programs have Live Sync on by default');
select ok(not has_table_privilege('authenticated', 'public.program_live_sync_queue', 'select')
  and not has_table_privilege('authenticated', 'public.program_live_sync_queue', 'insert')
  and not has_table_privilege('anon', 'public.program_live_sync_queue', 'select'),
  'nobody signed in can read or write the sync queue');
select ok(not has_function_privilege('authenticated', 'public.live_sync_program(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.live_sync_program(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.queue_live_sync(uuid)', 'execute'),
  'nobody signed in can run or queue a sync directly');
select ok(not has_column_privilege('authenticated', 'public.workouts', 'customised_at', 'update')
  and not has_column_privilege('authenticated', 'public.workouts', 'source_revision', 'update')
  and not has_column_privilege('authenticated', 'public.workouts', 'revision', 'update')
  and not has_column_privilege('authenticated', 'public.programs', 'live_synced_at', 'update')
  and has_column_privilege('authenticated', 'public.programs', 'live_sync', 'update'),
  'only the switch itself is writable by coaches');

-- Coach A builds a two-week program (Live Sync off) and assigns it to A1 from two days ago.
--   w1d1 lib1 -> today-2 (past)    w1d3 lib2 -> today      w2d1 lib1 -> today+5 (will be completed)
--   w2d2 lib3 -> today+6 (customised)   w2d3 lib2 -> today+7 (in progress)   w2d5 lib1 -> today+9
select tests.act_as(:'coach_a');
insert into public.programs (id, workspace_id, name, weeks, live_sync) values (:'prog', :'ws_a', 'Strength', 2, false);
insert into public.program_workouts (id, program_id, week, day, position, workout_id) values
  (:'slot_w1d1', :'prog', 1, 1, 0, :'lib1'),
  (:'slot_w1d3', :'prog', 1, 3, 0, :'lib2'),
  (:'slot_w2d1', :'prog', 2, 1, 0, :'lib1'),
  (:'slot_w2d2', :'prog', 2, 2, 0, :'lib3'),
  (gen_random_uuid(), :'prog', 2, 3, 0, :'lib2'),
  (:'slot_w2d5', :'prog', 2, 5, 0, :'lib1');
select public.assign_program(:'asg1', :'prog', :'a1', (:'today'::date - 2));
select tests.flush();
reset role;

create temp view a1_days as
  select w.scheduled_on - :'today'::date as d, w.name, w.id
  from public.workouts w where w.assignment_id = :'asg1';
grant select on a1_days to authenticated;

select is((select array_agg(d || ' ' || name order by d, name) from a1_days),
  array['-2 Lib One', '0 Lib Two', '5 Lib One', '6 Lib Three', '7 Lib Two', '9 Lib One'],
  'assigning copies every slot');
select is((select count(*)::int from public.workouts where assignment_id = :'asg1' and source_revision is not null), 6,
  'copies remember the library revision they came from');

select (select id from a1_days where d = 5) as done_copy \gset
select (select id from a1_days where d = 6) as custom_copy \gset
select (select id from a1_days where d = 7) as started_copy \gset
select (select id from a1_days where d = -2) as past_copy \gset
select (select id from a1_days where d = 0) as today_copy \gset
select tests.create_log(:'ws_a', :'a1', :'done_copy', 'completed');
select tests.create_log(:'ws_a', :'a1', :'started_copy', 'in_progress');

-- The coach edits A1's copy on day 6 by hand: it becomes customised.
select tests.act_as(:'coach_a');
update public.workouts set notes = 'Just for A1' where id = :'custom_copy';
reset role;
select isnt((select customised_at from public.workouts where id = :'custom_copy'), null,
  'a coach edit of a client copy marks it customised');
select is((select customised_at from public.workouts where id = :'done_copy'), null, 'other copies are not customised');
select tests.act_as(:'coach_a');
select throws_ok(format($q$update public.workouts set customised_at = null where id = %L$q$, :'custom_copy'),
  '42501', null, 'a coach cannot clear the customised mark directly');

-- Live Sync off: a program edit doesn't reach the client.
update public.program_workouts set day = 6 where id = :'slot_w2d5';
select tests.flush();
reset role;
select is((select array_agg(d order by d) from a1_days where name = 'Lib One'), array[-2, 5, 9],
  'with Live Sync off, moving a slot leaves the client calendar alone');
select is((select live_synced_at from public.programs where id = :'prog'), null, 'and nothing synced');

-- Turning it on runs the catch-up sync: the moved slot reaches the client.
select tests.act_as(:'coach_a');
update public.programs set live_sync = true where id = :'prog';
select tests.flush();
reset role;
select is((select array_agg(d order by d) from a1_days where name = 'Lib One'), array[-2, 5, 10],
  'turning Live Sync on catches up: the day-9 copy moved to day 10');
select isnt((select live_synced_at from public.programs where id = :'prog'), null, 'the sync time is recorded');
select is((select id from a1_days where d = 0), :'today_copy'::uuid, 'an up-to-date copy keeps its id');

-- Add a slot: added from today on.
select tests.act_as(:'coach_a');
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 2, 4, 0, :'lib3');
select tests.flush();
reset role;
select is((select name from a1_days where d = 8), 'Lib Three', 'a new slot is added to the client''s future');

-- Adding a slot on a past day does nothing for the past.
select tests.act_as(:'coach_a');
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 1, 2, 0, :'lib3');
select tests.flush();
reset role;
select is((select count(*)::int from a1_days where d = -1), 0, 'a slot added on a past day is not copied');

-- Remove slots: today's untouched copy goes; the past, completed, customised and in-progress ones stay.
select tests.act_as(:'coach_a');
delete from public.program_workouts where id in (:'slot_w1d1', :'slot_w1d3', :'slot_w2d1', :'slot_w2d2');
delete from public.program_workouts where program_id = :'prog' and week = 2 and day = 3;
select tests.flush();
reset role;
select is((select count(*)::int from a1_days where d = 0), 0, 'removing a slot removes today''s untouched copy');
select is((select id from a1_days where d = -2), :'past_copy'::uuid, 'a past copy is never touched');
select is((select id from a1_days where d = 5), :'done_copy'::uuid, 'a completed copy is never touched');
select is((select id from a1_days where d = 6), :'custom_copy'::uuid, 'a customised copy is never touched');
select is((select id from a1_days where d = 7), :'started_copy'::uuid, 'an in-progress copy is never touched');
select is((select live_sync_skipped from public.programs where id = :'prog'), 1,
  'the customised copy that differs from the program is reported as skipped');

-- Editing a library workout the program uses refreshes untouched future copies (same id, new content) only.
select (select id from a1_days where d = 10) as future_lib1 \gset
select tests.act_as(:'coach_a');
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 2, 1, 0, :'lib1');
select tests.flush();
update public.workouts set name = 'Lib One v2', notes = 'Heavier' where id = :'lib1';
select tests.flush();
reset role;
select is((select row(name, notes)::text from public.workouts where id = :'future_lib1'), row('Lib One v2', 'Heavier')::text,
  'a library edit reaches the untouched future copy, which keeps its id');
select is((select source_revision from public.workouts where id = :'future_lib1'),
  (select revision from public.workouts where id = :'lib1'), 'the refreshed copy has the new revision');
select is((select name from public.workouts where id = :'done_copy'), 'Lib One', 'the completed copy keeps the old version');
select is((select name from public.workouts where id = :'past_copy'), 'Lib One', 'the past copy keeps the old version');
select is((select count(*)::int from public.workout_sets where workout_id = :'future_lib1'), 2,
  'the refreshed copy has the library workout''s sets');

-- Moving a slot: the untouched copy moves.
select tests.act_as(:'coach_a');
update public.program_workouts set day = 7 where id = :'slot_w2d5';
select tests.flush();
reset role;
select is((select array_agg(d order by d) from a1_days where name like 'Lib One%'), array[-2, 5, 11],
  'moving a slot moves the untouched copy (day 10 -> 11); the re-added day-5 slot is already covered by the done copy');

-- copy_program_week: week 2 copied onto a new week 3 (program length changed first).
select tests.act_as(:'coach_a');
select public.set_program_weeks(:'prog', 3::smallint);
select tests.flush();
reset role;
select is((select weeks::int from public.program_assignments where id = :'asg1'), 3,
  'a longer program lengthens the active assignment');
select tests.act_as(:'coach_a');
select count(*) from public.copy_program_week(:'prog', 2::smallint, '{3}'::smallint[],
  (select array_agg(gen_random_uuid()) from public.program_workouts where program_id = :'prog' and week = 2));
select tests.flush();
reset role;
select is((select array_agg(d || ' ' || name order by d, name) from a1_days where d >= 12),
  array['12 Lib One v2', '15 Lib Three', '18 Lib One v2'], 'copying a week adds its workouts to the client''s new week');

-- Shrinking the program removes untouched future copies past the new end; protected ones stay.
select tests.act_as(:'coach_a');
select public.set_program_weeks(:'prog', 1::smallint);
select tests.flush();
reset role;
select is((select array_agg(d order by d) from a1_days), array[-2, 5, 6, 7],
  'shrinking to one week removes the untouched future copies; past, done, customised and started ones stay');
select is((select weeks::int from public.program_assignments where id = :'asg1'), 1, 'the assignment is shortened too');

-- A cancelled assignment respects its cancel date.
select tests.act_as(:'coach_a');
select public.set_program_weeks(:'prog', 2::smallint);
select public.assign_program(:'asg2', :'prog', :'a2', :'today'::date);
select tests.flush();
select public.unassign_program(:'asg2', (:'today'::date + 3));
insert into public.program_workouts (id, program_id, week, day, position, workout_id) values
  (gen_random_uuid(), :'prog', 1, 3, 1, :'lib2'),
  (gen_random_uuid(), :'prog', 1, 6, 0, :'lib2');
select tests.flush();
reset role;
select is((select array_agg(scheduled_on - :'today'::date order by scheduled_on) from public.workouts
  where assignment_id = :'asg2' and source_workout_id = :'lib2'), array[2],
  'a cancelled assignment gets new workouts only before its cancel date');

-- A removed client is left alone.
select tests.act_as(:'coach_a');
select public.remove_client(:'ws_a', :'a2');
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 1, 1, 1, :'lib3');
select tests.flush();
reset role;
select is((select count(*)::int from public.workouts where assignment_id = :'asg2' and source_workout_id = :'lib3' and scheduled_on = :'today'::date), 0,
  'a removed client''s calendar is not synced');

-- Customised copies stay as edited even when their own library workout changes.
select (select notes from public.workouts where id = :'custom_copy') as custom_notes \gset
select tests.act_as(:'coach_a');
update public.workouts set notes = 'Lib three v2' where id = :'lib3';
select tests.flush();
reset role;
select is((select notes from public.workouts where id = :'custom_copy'), :'custom_notes', 'a customised copy keeps the coach''s edit');

-- Live Sync off again: edits stop reaching clients.
select tests.act_as(:'coach_a');
update public.programs set live_sync = false where id = :'prog';
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 2, 6, 0, :'lib2');
select tests.flush();
reset role;
select is((select count(*)::int from a1_days where d = 10), 0, 'with Live Sync turned off, a new slot is not copied');

-- New and duplicated programs start with Live Sync on.
select tests.act_as(:'coach_a');
insert into public.programs (id, workspace_id, name) values (gen_random_uuid(), :'ws_a', 'Fresh') ;
select ok((select live_sync from public.programs where name = 'Fresh'), 'a new program has Live Sync on');
select public.duplicate_program(gen_random_uuid(), :'prog', 'Dup');
select ok((select live_sync from public.programs where name = 'Dup'), 'a duplicated program has Live Sync on');
update public.programs set live_sync = true where id = :'prog';
select tests.flush();
reset role;

-- Cross-workspace: coach B can't switch, edit or sync A's program, and B's own sync never reaches A's clients.
select count(*) as a1_before from public.workouts where client_id = :'a1' \gset
select tests.act_as(:'coach_b');
with u as (update public.programs set live_sync = false where id = :'prog' returning 1) select is(count(*)::int, 0, 'coach B cannot switch Live Sync on A''s program') from u;
select throws_ok(format($q$insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), %L, 1, 4, 0, %L)$q$, :'prog', :'lib_b'), '42501', null, 'coach B cannot add a slot to A''s program');
with d as (delete from public.program_workouts where program_id = :'prog' returning 1) select is(count(*)::int, 0, 'coach B cannot remove A''s slots') from d;
with u as (update public.workouts set notes = 'hacked' where id = :'lib1' returning 1) select is(count(*)::int, 0, 'coach B cannot edit A''s library workout') from u;
select throws_ok(format($q$select public.live_sync_program(%L)$q$, :'prog'), '42501', null,
  'coach B cannot run a sync');
insert into public.programs (id, workspace_id, name, weeks) values (:'prog_b', :'ws_b', 'B Program', 1);
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog_b', 1, 1, 0, :'lib_b');
select public.assign_program(:'asg_b', :'prog_b', :'b1', :'today'::date);
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog_b', 1, 2, 0, :'lib_b');
select tests.flush();
reset role;
select is((select count(*)::int from public.workouts where assignment_id = :'asg_b'), 2, 'coach B''s own live program syncs B1');
select is((select count(*)::int from public.workouts where client_id = :'a1'), :'a1_before'::int,
  'nothing coach B did changed A1''s calendar');
select ok((select live_sync from public.programs where id = :'prog'), 'A''s program is still live');

-- A client can't trigger a sync: they can't change programs, slots or library workouts, or run it.
select count(*) as a1_before from public.workouts where client_id = :'a1' \gset
select tests.act_as(:'a1');
with u as (update public.programs set weeks = 4 where id = :'prog' returning 1) select is(count(*)::int, 0, 'a client cannot change the program') from u;
select throws_ok(format($q$insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), %L, 1, 4, 0, %L)$q$, :'prog', :'lib1'), '42501', null, 'a client cannot add a slot');
with u as (update public.workouts set notes = 'x' where id = :'lib1' returning 1) select is(count(*)::int, 0, 'a client cannot edit a library workout') from u;
select throws_ok(format($q$select public.live_sync_program(%L)$q$, :'prog'), '42501', null, 'a client cannot run a sync');
select throws_ok('select * from public.program_live_sync_queue', '42501', null, 'a client cannot read the sync queue');
select tests.flush();
reset role;
select is((select count(*)::int from public.workouts where client_id = :'a1'), :'a1_before'::int,
  'nothing the client tried changed their calendar');

select * from finish();
rollback;
