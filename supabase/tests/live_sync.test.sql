begin;
select plan(92);

-- Live Sync runs at commit (a deferred trigger). A test never commits, so tests.flush() fires the queued syncs the
-- way a commit would: switching the trigger to immediate runs everything queued so far.
create or replace function tests.flush() returns void language plpgsql as $$
begin
  set constraints public.program_live_sync_queue_run immediate;
  set constraints public.program_live_sync_queue_run deferred;
end;
$$;
grant execute on function tests.flush() to authenticated, anon;

-- Fixtures (as postgres). Clients' time zone is set to Etc/UTC, so their today is UTC's ('UTC' itself is the
-- column default, which counts as not set).
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
select tests.create_user('ls-a3@t.local', 'Client A3') as a3 \gset
select tests.add_client(:'ws_a', :'a3');
update public.profiles set time_zone = 'Etc/UTC' where id in (:'a1', :'a2', :'b1');

select tests.create_workout(:'ws_a', 'Lib One') as lib1 \gset
select tests.create_workout(:'ws_a', 'Lib Two') as lib2 \gset
select tests.create_workout(:'ws_a', 'Lib Three') as lib3 \gset
select tests.create_workout(:'ws_a', 'Lib Four') as lib4 \gset
select tests.create_workout(:'ws_b', 'Lib B') as lib_b \gset
select tests.create_workout(:'ws_a', 'Lib Five') as lib5 \gset

select gen_random_uuid() as prog \gset
select gen_random_uuid() as prog_b \gset
select gen_random_uuid() as asg1 \gset
select gen_random_uuid() as asg2 \gset
select gen_random_uuid() as asg_b \gset
select gen_random_uuid() as slot_today \gset
select gen_random_uuid() as slot_done \gset

-- Privileges
select is((select column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'programs' and column_name = 'live_sync'), 'true',
  'new programs have Live Sync on by default');
select ok(not has_table_privilege('authenticated', 'public.program_live_sync_queue', 'select')
  and not has_table_privilege('authenticated', 'public.program_live_sync_queue', 'insert')
  and not has_table_privilege('anon', 'public.program_live_sync_queue', 'select'),
  'nobody signed in can read or write the sync queue');
select ok(not has_table_privilege('authenticated', 'public.live_sync_tombstones', 'insert')
  and not has_table_privilege('authenticated', 'public.live_sync_tombstones', 'delete')
  and not has_table_privilege('anon', 'public.live_sync_tombstones', 'select'),
  'nobody signed in can write tombstones; anon cannot read them');
select ok(not has_function_privilege('authenticated', 'public.live_sync_program(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.live_sync_program(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.queue_live_sync(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.copy_workout_children(uuid, uuid)', 'execute'),
  'nobody signed in can run, queue or copy directly');
select ok(not has_column_privilege('authenticated', 'public.workouts', 'customised_at', 'update')
  and not has_column_privilege('authenticated', 'public.workouts', 'source_hash', 'update')
  and not has_column_privilege('authenticated', 'public.workouts', 'planned_on', 'update')
  and not has_column_privilege('authenticated', 'public.programs', 'live_synced_at', 'update')
  and has_column_privilege('authenticated', 'public.programs', 'live_sync', 'update'),
  'only the switch itself is writable by coaches');

-- Coach A builds a two-week program (Live Sync off) and assigns it to A1 from two days ago. Days from today:
--   w1d1 lib1 -2 (past)   w1d3 lib2 0 (today)   w1d4 lib3 1 (moved by the coach)
--   w2d1 lib1 5 (done)    w2d2 lib3 6 (notes edited)   w2d3 lib2 7 (in progress)   w2d4 lib1 8 (discarded log)
--   w2d5 lib1 9 (untouched)   w2d6 lib2 10 (deleted by the coach)   w2d7 lib3 11 (a set edited)
select tests.act_as(:'coach_a');
insert into public.programs (id, workspace_id, name, weeks, live_sync) values (:'prog', :'ws_a', 'Strength', 2, false);
insert into public.program_workouts (id, program_id, week, day, position, workout_id) values
  (gen_random_uuid(), :'prog', 1, 1, 0, :'lib1'),
  (:'slot_today', :'prog', 1, 3, 0, :'lib2'),
  (gen_random_uuid(), :'prog', 1, 4, 0, :'lib3'),
  (:'slot_done', :'prog', 2, 1, 0, :'lib1'),
  (gen_random_uuid(), :'prog', 2, 2, 0, :'lib3'),
  (gen_random_uuid(), :'prog', 2, 3, 0, :'lib2'),
  (gen_random_uuid(), :'prog', 2, 4, 0, :'lib1'),
  (gen_random_uuid(), :'prog', 2, 5, 0, :'lib1'),
  (gen_random_uuid(), :'prog', 2, 6, 0, :'lib2'),
  (gen_random_uuid(), :'prog', 2, 7, 0, :'lib3');
select public.assign_program(:'asg1', :'prog', :'a1', (:'today'::date - 2));
select tests.flush();
reset role;

create temp view a1_days as
  select w.planned_on - :'today'::date as d, w.scheduled_on - :'today'::date as s, w.name, w.notes, w.id,
    w.customised_at, w.source_workout_id
  from public.workouts w where w.assignment_id = :'asg1';
grant select on a1_days to authenticated;
create temp view a1_blocks as
  select w.planned_on - :'today'::date as d, b.id as block_id from public.workouts w
  join public.workout_blocks b on b.workout_id = w.id where w.assignment_id = :'asg1';

select is((select array_agg(d || ' ' || name order by d, name) from a1_days),
  array['-2 Lib One', '0 Lib Two', '1 Lib Three', '5 Lib One', '6 Lib Three', '7 Lib Two', '8 Lib One', '9 Lib One',
    '10 Lib Two', '11 Lib Three'], 'assigning copies every slot');
select is((select count(*)::int from a1_days where d = s), 10, 'each copy is planned for the day it is on');
select is((select count(*)::int from public.workouts where assignment_id = :'asg1' and source_hash is not null
  and customised_at is null), 10, 'copies remember the library content they came from and are not customised');

select (select id from a1_days where d = -2) as past_copy \gset
select (select id from a1_days where d = 0) as today_copy \gset
select (select id from a1_days where d = 1) as moved_copy \gset
select (select id from a1_days where d = 5) as done_copy \gset
select (select id from a1_days where d = 6) as noted_copy \gset
select (select id from a1_days where d = 7) as started_copy \gset
select (select id from a1_days where d = 8) as discarded_copy \gset
select (select id from a1_days where d = 9) as plain_copy \gset
select (select id from a1_days where d = 10) as deleted_copy \gset
select (select id from a1_days where d = 11) as set_copy \gset
select tests.create_log(:'ws_a', :'a1', :'done_copy', 'completed') as done_log \gset
select tests.create_log(:'ws_a', :'a1', :'started_copy', 'in_progress') as started_log \gset
select tests.create_log(:'ws_a', :'a1', :'discarded_copy', 'discarded') as discarded_log \gset

-- Hand edits by the coach
select tests.act_as(:'coach_a');
update public.workouts set notes = 'Just for A1' where id = :'noted_copy';
update public.workouts set scheduled_on = :'today'::date + 3 where id = :'moved_copy';
delete from public.workouts where id = :'deleted_copy';
update public.workout_sets set target_reps_min = 5, target_reps_max = 5 where workout_id = :'set_copy' and position = 0;
select throws_ok(format($q$update public.workouts set customised_at = null where id = %L$q$, :'noted_copy'),
  '42501', null, 'a coach cannot clear the customised mark directly');
reset role;
select isnt((select customised_at from public.workouts where id = :'noted_copy'), null, 'editing notes customises a copy');
select isnt((select customised_at from public.workouts where id = :'moved_copy'), null, 'moving a copy customises it');
select is((select planned_on - :'today'::date from public.workouts where id = :'moved_copy'), 1,
  'a moved copy keeps the program day it stands for');
select isnt((select customised_at from public.workouts where id = :'set_copy'), null, 'editing a set customises the copy');
select is((select count(*)::int from public.live_sync_tombstones where assignment_id = :'asg1'
  and planned_on = :'today'::date + 10 and source_workout_id = :'lib2'), 1, 'deleting a program copy leaves a tombstone');
update public.workouts set created_by = null where id = :'plain_copy';
select is((select customised_at from public.workouts where id = :'plain_copy'), null,
  'an update of link columns only does not customise a copy');

-- Live Sync off: a program edit doesn't reach the client.
select tests.act_as(:'coach_a');
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 1, 5, 0, :'lib2');
select tests.flush();
reset role;
select is((select count(*)::int from a1_days where d = 2), 0, 'with Live Sync off, a new slot is not copied');
select is((select live_synced_at from public.programs where id = :'prog'), null, 'and nothing synced');

-- Turning it on runs the catch-up sync.
select tests.act_as(:'coach_a');
update public.programs set live_sync = true where id = :'prog';
select tests.flush();
reset role;
select is((select name from a1_days where d = 2), 'Lib Two', 'turning Live Sync on catches up: the new slot is copied');
select is((select count(*)::int from a1_days where d = 1 or s = 1), 1, 'the moved copy is not duplicated on its old day');
select is((select s from a1_days where id = :'moved_copy'), 3, 'the moved copy stays where the coach put it');
select is((select count(*)::int from a1_days where d = 10), 0, 'a day the coach deleted is not filled again');
select is((select live_sync_skipped from public.programs where id = :'prog'), 0,
  'customised copies that still match the program are not reported as skipped');
select isnt((select live_synced_at from public.programs where id = :'prog'), null, 'the sync time is recorded');
select is((select count(*)::int from a1_days), 10, 'nothing else was added or removed');

-- A library edit refreshes untouched copies from tomorrow on, in place.
select (select block_id from a1_blocks where d = 9) as plain_block \gset
select tests.act_as(:'coach_a');
update public.workouts set notes = 'Heavier' where id = :'lib1';
select tests.flush();
reset role;
select is((select notes from public.workouts where id = :'plain_copy'), 'Heavier', 'an untouched copy gets the library edit');
select ok(not exists (select 1 from a1_blocks where block_id = :'plain_block') and exists (select 1 from a1_blocks where d = 9),
  'its content is copied in again');
select is((select notes from public.workouts where id = :'discarded_copy'), 'Heavier',
  'a copy with only a discarded log is refreshed too');
select is((select workout_id from public.workout_logs where id = :'discarded_log'), :'discarded_copy'::uuid,
  'it is refreshed in place: the same row, still linked to its log');
select is((select notes from public.workouts where id = :'done_copy'), null, 'a completed copy keeps the old version');
select is((select workout_id from public.workout_logs where id = :'done_log'), :'done_copy'::uuid, 'and its log stays linked');
select is((select notes from public.workouts where id = :'past_copy'), null, 'a past copy keeps the old version');
select is((select customised_at from public.workouts where id = :'plain_copy'), null, 'a refreshed copy is not customised');

-- A save that changes nothing changes nothing for clients.
select (select block_id from a1_blocks where d = 2) as two_block \gset
select tests.act_as(:'coach_a');
update public.workouts set notes = notes where id = :'lib2';
select tests.flush();
reset role;
select ok(exists (select 1 from a1_blocks where block_id = :'two_block'), 'a library save without changes refreshes nothing');

-- Today: never refreshed or removed, only added.
select tests.act_as(:'coach_a');
update public.workouts set notes = 'Lib two v2' where id = :'lib2';
select tests.flush();
reset role;
select is((select notes from public.workouts where id = :'today_copy'), null, 'today''s copy is not refreshed');
select is((select notes from a1_days where d = 2), 'Lib two v2', 'tomorrow-on copies are');
select tests.act_as(:'coach_a');
delete from public.program_workouts where id = :'slot_today';
select tests.flush();
reset role;
select is((select id from a1_days where d = 0), :'today_copy'::uuid, 'removing today''s slot leaves today''s copy');

-- Removing slots: protected copies stay; customised ones that now differ are reported.
select tests.act_as(:'coach_a');
delete from public.program_workouts where program_id = :'prog' and week = 2 and day in (2, 3, 4, 5);
select tests.flush();
reset role;
select is((select count(*)::int from a1_days where d in (8, 9)), 0, 'removing slots removes untouched future copies');
select is((select id from a1_days where d = 6), :'noted_copy'::uuid, 'a customised copy is never removed');
select is((select id from a1_days where d = 7), :'started_copy'::uuid, 'an in-progress copy is never removed');
select is((select workout_id from public.workout_logs where id = :'started_log'), :'started_copy'::uuid,
  'and its log stays linked');
select is((select live_sync_skipped from public.programs where id = :'prog'), 1,
  'the customised copy that no longer matches is reported as skipped');

-- Swapping the workout of a day the client already did: the new one is not added on that day.
select tests.act_as(:'coach_a');
delete from public.program_workouts where id = :'slot_done';
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 2, 1, 0, :'lib3');
select tests.flush();
reset role;
select is((select array_agg(name) from a1_days where d = 5), array['Lib One'],
  'no swapped-in workout on a day whose earlier workout is done');

-- Moving a slot: the untouched copy moves.
select tests.act_as(:'coach_a');
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 2, 5, 0, :'lib1');
select tests.flush();
update public.program_workouts set day = 6 where program_id = :'prog' and week = 2 and day = 5;
select tests.flush();
reset role;
select is((select array_agg(d order by d) from a1_days where name = 'Lib One' and d > 0), array[5, 10],
  'moving a slot moves the untouched copy (day 9 -> 10)');

-- Deleting a library workout removes its untouched future copies; past, logged and customised ones stay.
select tests.act_as(:'coach_a');
insert into public.program_workouts (id, program_id, week, day, position, workout_id) values
  (gen_random_uuid(), :'prog', 1, 1, 1, :'lib4'),
  (gen_random_uuid(), :'prog', 1, 6, 0, :'lib4'),
  (gen_random_uuid(), :'prog', 2, 2, 1, :'lib4'),
  (gen_random_uuid(), :'prog', 2, 4, 0, :'lib4');
select tests.flush();
reset role;
select (select id from a1_days where d = 3 and name = 'Lib Four') as lib4_plain \gset
select (select id from a1_days where d = 6 and name = 'Lib Four') as lib4_custom \gset
select (select id from a1_days where d = 8 and name = 'Lib Four') as lib4_done \gset
select tests.create_log(:'ws_a', :'a1', :'lib4_done', 'completed');
select tests.act_as(:'coach_a');
update public.workouts set notes = 'mine' where id = :'lib4_custom';
delete from public.workouts where id = :'lib4';
select tests.flush();
reset role;
select is((select count(*)::int from public.workouts where id = :'lib4_plain'), 0,
  'deleting a library workout removes its untouched future copy');
select is((select count(*)::int from public.workouts where id in (:'lib4_custom', :'lib4_done')), 2,
  'its customised and done copies stay');
select is((select customised_at from public.workouts where id = :'lib4_done'), null,
  'losing the library link does not customise a copy');

-- Program length: longer reaches the assignment; shorter removes untouched copies past the new end.
select tests.act_as(:'coach_a');
select public.set_program_weeks(:'prog', 3::smallint);
select tests.flush();
reset role;
select is((select weeks::int from public.program_assignments where id = :'asg1'), 3,
  'a longer program lengthens the active assignment');
select tests.act_as(:'coach_a');
select count(*) from public.copy_program_week(:'prog', 1::smallint, '{3}'::smallint[],
  (select array_agg(gen_random_uuid()) from public.program_workouts where program_id = :'prog' and week = 1));
select tests.flush();
reset role;
select is((select array_agg(d || ' ' || name order by d, name) from a1_days where d >= 12),
  array['12 Lib One', '15 Lib Three', '16 Lib Two'], 'copying a week adds its workouts to the client''s new week');
select tests.act_as(:'coach_a');
select public.set_program_weeks(:'prog', 1::smallint);
select tests.flush();
reset role;
select is((select count(*)::int from a1_days where d >= 12), 0, 'shrinking removes the untouched future copies');
select is((select count(*)::int from a1_days where id in (:'noted_copy', :'started_copy', :'done_copy', :'moved_copy')), 4,
  'customised, started and done copies stay');
select is((select weeks::int from public.program_assignments where id = :'asg1'), 1, 'the assignment is shortened too');

-- A cancelled assignment respects its cancel date.
select tests.act_as(:'coach_a');
select public.set_program_weeks(:'prog', 2::smallint);
select public.assign_program(:'asg2', :'prog', :'a2', :'today'::date);
select tests.flush();
select public.unassign_program(:'asg2', (:'today'::date + 4));
insert into public.program_workouts (id, program_id, week, day, position, workout_id) values
  (gen_random_uuid(), :'prog', 1, 3, 1, :'lib3'),
  (gen_random_uuid(), :'prog', 1, 7, 1, :'lib3');
select tests.flush();
reset role;
select is((select array_agg(scheduled_on - :'today'::date order by scheduled_on) from public.workouts
  where assignment_id = :'asg2' and source_workout_id = :'lib3' and planned_on - :'today'::date in (2, 6)), array[2],
  'a cancelled assignment gets new workouts only before its cancel date');

-- A removed client is left alone.
select tests.act_as(:'coach_a');
select public.remove_client(:'ws_a', :'a2');
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 1, 2, 1, :'lib3');
select tests.flush();
reset role;
select is((select count(*)::int from public.workouts where assignment_id = :'asg2' and planned_on = :'today'::date + 1
  and source_workout_id = :'lib3'), 0, 'a removed client''s calendar is not synced');

-- Live Sync off again: edits stop reaching clients.
select tests.act_as(:'coach_a');
update public.programs set live_sync = false where id = :'prog';
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog', 2, 7, 1, :'lib2');
select tests.flush();
reset role;
select is((select count(*)::int from a1_days where d = 11 and name like 'Lib Two%'), 0,
  'with Live Sync turned off, a new slot is not copied');

-- New and duplicated programs start with Live Sync on.
select tests.act_as(:'coach_a');
insert into public.programs (id, workspace_id, name) values (gen_random_uuid(), :'ws_a', 'Fresh');
select ok((select live_sync from public.programs where name = 'Fresh'), 'a new program has Live Sync on');
select public.duplicate_program(gen_random_uuid(), :'prog', 'Dup');
select ok((select live_sync from public.programs where name = 'Dup'), 'a duplicated program has Live Sync on');
update public.programs set live_sync = true where id = :'prog';
select tests.flush();
select is((select count(*)::int from public.live_sync_tombstones where assignment_id = :'asg1'), 1,
  'coach A sees their workspace''s tombstones');
reset role;

-- Cross-workspace: coach B can't switch, edit or sync A's program, can't see A's tombstones, and B's own sync never
-- reaches A's clients.
select count(*) as a1_before from public.workouts where client_id = :'a1' \gset
select tests.act_as(:'coach_b');
with u as (update public.programs set live_sync = false where id = :'prog' returning 1)
  select is(count(*)::int, 0, 'coach B cannot switch Live Sync on A''s program') from u;
select throws_ok(format($q$insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), %L, 1, 4, 0, %L)$q$, :'prog', :'lib_b'), '42501', null, 'coach B cannot add a slot to A''s program');
with d as (delete from public.program_workouts where program_id = :'prog' returning 1)
  select is(count(*)::int, 0, 'coach B cannot remove A''s slots') from d;
with u as (update public.workouts set notes = 'hacked' where id = :'lib1' returning 1)
  select is(count(*)::int, 0, 'coach B cannot edit A''s library workout') from u;
with d as (delete from public.workouts where id = :'noted_copy' returning 1)
  select is(count(*)::int, 0, 'coach B cannot delete A''s client copy (no tombstone either)') from d;
select is((select count(*)::int from public.live_sync_tombstones), 0, 'coach B sees none of A''s tombstones');
select throws_ok($q$insert into public.live_sync_tombstones (assignment_id, planned_on, source_workout_id, workspace_id)
  values (gen_random_uuid(), current_date, gen_random_uuid(), gen_random_uuid())$q$, '42501', null,
  'coach B cannot write a tombstone');
select throws_ok(format($q$select public.live_sync_program(%L)$q$, :'prog'), '42501', null,
  'coach B cannot run a sync');
insert into public.programs (id, workspace_id, name, weeks) values (:'prog_b', :'ws_b', 'B Program', 1);
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog_b', 1, 2, 0, :'lib_b');
select public.assign_program(:'asg_b', :'prog_b', :'b1', :'today'::date);
insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), :'prog_b', 1, 3, 0, :'lib_b');
select tests.flush();
reset role;
select is((select count(*)::int from public.workouts where assignment_id = :'asg_b'), 2, 'coach B''s own live program syncs B1');
select is((select count(*)::int from public.workouts where client_id = :'a1'), :'a1_before'::int,
  'nothing coach B did changed A1''s calendar');
select ok((select live_sync from public.programs where id = :'prog'), 'A''s program is still live');
select is((select count(*)::int from public.live_sync_tombstones where assignment_id = :'asg1'), 1, 'A''s tombstone is intact');

-- A day the client already worked out gets no new workout: a done copy moved onto that day, or an unplanned log.
select tests.create_log(:'ws_a', :'a1', :'moved_copy', 'completed');
select tests.create_log(:'ws_a', :'a1', null, 'completed') as adhoc_log \gset
update public.workout_logs set started_at = (:'today'::date + 9) + time '11:00', finished_at = (:'today'::date + 9) + time '12:00'
  where id = :'adhoc_log';
select tests.act_as(:'coach_a');
insert into public.program_workouts (id, program_id, week, day, position, workout_id) values
  (gen_random_uuid(), :'prog', 1, 6, 1, :'lib2'),
  (gen_random_uuid(), :'prog', 2, 5, 1, :'lib2');
select tests.flush();
reset role;
select is((select count(*)::int from a1_days where d = 3 and name = 'Lib Two'), 0,
  'no new workout on a day a done copy was moved to');
select is((select count(*)::int from a1_days where d = 9), 0, 'no new workout on a day with an unplanned log');

-- Copies made before Live Sync (planned_on null): untouched only if identical to the library and on a slot day.
select gen_random_uuid() as prog5 \gset
select gen_random_uuid() as asg5 \gset
select tests.act_as(:'coach_a');
insert into public.programs (id, workspace_id, name, weeks, live_sync) values (:'prog5', :'ws_a', 'Old one', 1, false);
insert into public.program_workouts (id, program_id, week, day, position, workout_id) values
  (gen_random_uuid(), :'prog5', 1, 3, 0, :'lib5'),
  (gen_random_uuid(), :'prog5', 1, 4, 0, :'lib5'),
  (gen_random_uuid(), :'prog5', 1, 5, 0, :'lib5');
select public.assign_program(:'asg5', :'prog5', :'a1', :'today'::date);
select tests.flush();
reset role;
select (select id from public.workouts where assignment_id = :'asg5' and scheduled_on = :'today'::date + 2) as old_same \gset
select (select id from public.workouts where assignment_id = :'asg5' and scheduled_on = :'today'::date + 3) as old_edited \gset
select (select id from public.workouts where assignment_id = :'asg5' and scheduled_on = :'today'::date + 4) as old_moved \gset
-- Make them look like pre-Live Sync copies: edited and moved without any record of it.
select set_config('caltracker.system_write', 'on', true);
update public.workouts set planned_on = null, source_hash = null, customised_at = null where assignment_id = :'asg5';
update public.workout_sets set target_reps_min = 3, target_reps_max = 3 where workout_id = :'old_edited';
update public.workouts set scheduled_on = :'today'::date + 6 where id = :'old_moved';
select set_config('caltracker.system_write', '', true);
select is(public.live_sync_backfill_copies(), 3, 'the backfill fills in the old copies');
select ok((select customised_at is null and source_hash = public.workout_content_hash(:'lib5') and planned_on = scheduled_on
  from public.workouts where id = :'old_same'), 'an identical old copy on its slot day counts as untouched');
select isnt((select customised_at from public.workouts where id = :'old_edited'), null, 'an edited old copy counts as customised');
select ok((select customised_at is not null and planned_on = :'today'::date + 4 from public.workouts where id = :'old_moved'),
  'a moved old copy counts as customised and stands for the slot day it left');
select tests.act_as(:'coach_a');
update public.programs set live_sync = true where id = :'prog5';
update public.workouts set notes = 'Lib five v2' where id = :'lib5';
select tests.flush();
reset role;
select is((select notes from public.workouts where id = :'old_same'), 'Lib five v2', 'the identical old copy is refreshed normally');
select is((select count(*)::int from public.workouts where id in (:'old_edited', :'old_moved') and notes is null), 2,
  'the edited and moved old copies survive turning Live Sync on');
select is((select count(*)::int from public.workouts where assignment_id = :'asg5'), 3, 'no slot day is filled twice');

-- The queue is per transaction, so two transactions never wait on each other's queue rows.
select col_is_pk('public', 'program_live_sync_queue', array['xact', 'program_id'], 'the queue is keyed by transaction');

-- Today without a known zone: the coach's zone, else the day after UTC's today.
select is(public.client_today(:'a3', :'ws_a'), (now() at time zone 'UTC')::date + 1,
  'no client or coach zone: today is the day after UTC''s');
update public.profiles set time_zone = 'Pacific/Kiritimati' where id = :'coach_a';
select is(public.client_today(:'a3', :'ws_a'), (now() at time zone 'Pacific/Kiritimati')::date,
  'no client zone: the coach''s zone decides');
update public.profiles set time_zone = 'America/Los_Angeles' where id = :'a3';
select is(public.client_today(:'a3', :'ws_a'), (now() at time zone 'America/Los_Angeles')::date,
  'the client''s own zone comes first');
update public.profiles set time_zone = 'Not/AZone' where id = :'a3';
select is(public.client_today(:'a3', :'ws_a'), (now() at time zone 'Pacific/Kiritimati')::date,
  'an unknown client zone falls back to the coach''s');
update public.profiles set time_zone = 'UTC' where id in (:'coach_a', :'a3');

-- A client can't trigger a sync or touch tombstones.
select count(*) as a1_before from public.workouts where client_id = :'a1' \gset
select tests.act_as(:'a1');
with u as (update public.programs set weeks = 4 where id = :'prog' returning 1)
  select is(count(*)::int, 0, 'a client cannot change the program') from u;
select throws_ok(format($q$insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  values (gen_random_uuid(), %L, 1, 4, 0, %L)$q$, :'prog', :'lib1'), '42501', null, 'a client cannot add a slot');
with u as (update public.workouts set notes = 'x' where id = :'lib1' returning 1)
  select is(count(*)::int, 0, 'a client cannot edit a library workout') from u;
with d as (delete from public.workouts where id = :'plain_copy' returning 1)
  select is(count(*)::int, 0, 'a client cannot delete their own copy (so no tombstone)') from d;
select throws_ok(format($q$select public.live_sync_program(%L)$q$, :'prog'), '42501', null, 'a client cannot run a sync');
select throws_ok('select * from public.program_live_sync_queue', '42501', null, 'a client cannot read the sync queue');
select is((select count(*)::int from public.live_sync_tombstones), 0, 'a client sees no tombstones');
select throws_ok($q$insert into public.live_sync_tombstones (assignment_id, planned_on, source_workout_id, workspace_id)
  values (gen_random_uuid(), current_date, gen_random_uuid(), gen_random_uuid())$q$, '42501', null,
  'a client cannot write a tombstone');
select tests.flush();
reset role;
select is((select count(*)::int from public.workouts where client_id = :'a1'), :'a1_before'::int,
  'nothing the client tried changed their calendar');

select * from finish();
rollback;
