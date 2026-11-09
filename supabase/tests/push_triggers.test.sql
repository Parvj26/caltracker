-- Push notifications: what puts a push in the outbox (plan Task 5).
begin;
select plan(36);

-- Live Sync runs at commit; fire queued syncs the way a commit would (see live_sync.test.sql).
create or replace function tests.flush() returns void language plpgsql as $$
begin
  set constraints public.program_live_sync_queue_run immediate;
  set constraints public.program_live_sync_queue_run deferred;
end;
$$;
grant execute on function tests.flush() to authenticated, anon;

-- The caller for triggers, staying postgres (for inserts the API would make through RPCs or the phone).
create or replace function tests.claims(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;

create or replace function tests.pending(u uuid, t text) returns integer language sql as $$
  select count(*)::int from public.push_outbox o where o.user_id = u and o.type = t and o.sent_at is null;
$$;

select (now() at time zone 'UTC')::date as today \gset
select tests.create_user('pg-coach@t.local', 'Luis Bueno') as coach \gset
select tests.create_workspace('Luis Bueno Coaching', :'coach') as ws \gset
select tests.create_user('pg-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('pg-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws', :'kim');
select tests.create_user('pg-ana@t.local', 'Ana Ruiz') as ana \gset
select tests.add_client(:'ws', :'ana');
select tests.create_user('pg-coach2@t.local', 'Other Coach') as coach2 \gset
select tests.create_workspace('PG Other', :'coach2') as ws2 \gset
select tests.create_user('pg-lee@t.local', 'Lee Other') as lee \gset
select tests.add_client(:'ws2', :'lee');
-- Their today is UTC's ('UTC' itself is the column default, which counts as not set).
update public.profiles set time_zone = 'Etc/UTC' where id in (:'sam', :'kim', :'ana', :'lee');

select tests.create_workout(:'ws', 'Upper A') as lib \gset
select gen_random_uuid() as prog \gset
insert into public.programs (id, workspace_id, name, weeks, live_sync) values (:'prog', :'ws', 'Strength Block', 2, true);
-- Upper A on day 1 and day 2 of both weeks.
insert into public.program_workouts (program_id, week, day, position, workout_id) values
  (:'prog', 1, 1, 0, :'lib'), (:'prog', 1, 2, 0, :'lib'), (:'prog', 2, 1, 0, :'lib'), (:'prog', 2, 2, 0, :'lib');

-- Assigning -----------------------------------------------------------------------------------------------------------
select gen_random_uuid() as asg_sam \gset
select gen_random_uuid() as asg_kim \gset
select tests.act_as(:'coach');
select public.assign_program(:'asg_sam', :'prog', :'sam', :'today');
select public.assign_program(:'asg_kim', :'prog', :'kim', :'today');
reset role;
select tests.flush();
select results_eq(format($$select group_key, data->>'name', data->>'actorName' from public.push_outbox
  where user_id = %L and type = 'workout_assigned'$$, :'sam'),
  format($$values ('workout_assigned:' || %L, 'Strength Block', 'Luis')$$, :'asg_sam'),
  'assign_program enqueues exactly one row');

select gen_random_uuid() as single \gset
select tests.act_as(:'coach');
select public.schedule_workout(:'single', :'lib', :'sam', (:'today'::date + 5));
reset role;
select is((select array_agg(group_key) from public.push_outbox where user_id = :'sam' and type = 'workout_assigned'
  and group_key <> 'workout_assigned:' || :'asg_sam'), array['workout_assigned:' || :'single'],
  'schedule_workout enqueues one row');

select tests.claims(:'sam');
insert into public.workouts (workspace_id, client_id, scheduled_on, name) values (:'ws', :'sam', :'today'::date + 6, 'My own');
select set_config('request.jwt.claims', '', true);
select is(tests.pending(:'sam', 'workout_assigned'), 2, 'a client creating a workout enqueues nothing');

-- Changing today's workout ------------------------------------------------------------------------------------------
select id as sam_today from public.workouts where assignment_id = :'asg_sam' and scheduled_on = :'today' \gset
select id as sam_tomorrow from public.workouts where assignment_id = :'asg_sam' and scheduled_on = :'today'::date + 1 \gset
select id as kim_today from public.workouts where assignment_id = :'asg_kim' and scheduled_on = :'today' \gset

select tests.act_as(:'coach');
update public.workouts set notes = 'Go heavier' where id = :'sam_today';
update public.workouts set notes = 'Go heavier still', name = 'Upper A+' where id = :'sam_today';
reset role;
select results_eq(format($$select count(*)::int, max(data->>'workoutName'), bool_and(not_before = now() + interval '2 minutes')
  from public.push_outbox where user_id = %L and type = 'workout_changed'$$, :'sam'),
  $$values (1, 'Upper A+', true)$$, 'editing today''s workout enqueues once, 2 minutes out, with the latest name');

select tests.act_as(:'coach');
update public.workouts set notes = 'Tomorrow' where id = :'sam_tomorrow';
reset role;
select is(tests.pending(:'sam', 'workout_changed'), 1, 'editing tomorrow''s workout enqueues nothing');

-- Today's workout moved to another day, or deleted, before its pending change went out: the push is dropped.
select tests.act_as(:'coach');
update public.workouts set scheduled_on = :'today'::date + 3 where id = :'sam_today';
reset role;
select is(tests.pending(:'sam', 'workout_changed'), 0, 'moving today''s workout off today drops its pending change');
select tests.act_as(:'coach');
update public.workouts set scheduled_on = :'today' where id = :'sam_today';
reset role;
select is(tests.pending(:'sam', 'workout_changed'), 1, 'moving a workout onto today is a change of today''s plan');
select tests.act_as(:'coach');
insert into public.workouts (workspace_id, client_id, scheduled_on, name) values (:'ws', :'sam', :'today', 'Extra')
  returning id as sam_extra \gset
update public.workouts set notes = 'Changed' where id = :'sam_extra';
delete from public.workouts where id = :'sam_extra';
reset role;
select is((select count(*)::int from public.push_outbox where group_key = 'workout_changed:' || :'sam_extra'), 0,
  'deleting today''s workout drops its pending change');

-- Links only (the library workout's deletion sets source_workout_id null): nothing.
select tests.claims(:'coach');
update public.workouts set source_workout_id = null where id = :'kim_today';
select set_config('request.jwt.claims', '', true);
select is(tests.pending(:'kim', 'workout_changed'), 0, 'an update that only moves links enqueues nothing');
update public.workouts set source_workout_id = :'lib' where id = :'kim_today';

-- Live Sync: a library edit refreshes the copies after today and leaves today's as the clients have them.
select count(*)::int as changed_before from public.push_outbox where type = 'workout_changed' \gset
select tests.act_as(:'coach');
update public.workouts set notes = 'Library v2' where id = :'lib';
reset role;
select tests.flush();
select is((select notes from public.workouts where assignment_id = :'asg_kim' and scheduled_on = :'today'::date + 1), 'Library v2',
  '(Live Sync refreshed kim''s copy for tomorrow)');
select is((select count(*)::int from public.push_outbox where type = 'workout_changed'), :changed_before,
  'live sync adds no "Today''s workout changed" (today''s copy is left alone, other days never push)');

-- A done workout: its plan can't change; a save that only stamps it pushes nothing.
select tests.create_log(:'ws', :'kim', :'kim_today', 'completed') as kim_log \gset
alter table public.workouts disable trigger workouts_touch_updated_at;
update public.workouts set updated_at = now() - interval '1 hour' where id = :'kim_today';
alter table public.workouts enable trigger workouts_touch_updated_at;
select tests.claims(:'coach');
update public.workouts set updated_at = updated_at where id = :'kim_today';
select set_config('request.jwt.claims', '', true);
select is(tests.pending(:'kim', 'workout_changed'), 0, 'a done workout does not enqueue a change');

-- Logs ----------------------------------------------------------------------------------------------------------------
select gen_random_uuid() as coach_log \gset
select tests.claims(:'coach');
insert into public.workout_logs (id, workspace_id, client_id, workout_id, name, status, logged_by)
values (:'coach_log', :'ws', :'sam', :'sam_today', 'Upper A', 'in_progress', :'coach');
select is(tests.pending(:'sam', 'coach_logged'), 0, 'a coach log in progress enqueues nothing yet');
update public.workout_logs set status = 'completed', finished_at = now() where id = :'coach_log';
update public.workout_logs set notes = 'corrected' where id = :'coach_log';
select set_config('request.jwt.claims', '', true);
select results_eq(format($$select data->>'logId', data->>'actorName', group_key from public.push_outbox
  where user_id = %L and type = 'coach_logged'$$, :'sam'),
  format($$values (%L, 'Luis', 'coach_logged:' || %L)$$, :'coach_log', :'coach_log'),
  'coach finishing a log enqueues coach_logged once');

-- A stale coach-held log the hourly job finishes.
select gen_random_uuid() as stale_log \gset
insert into public.workout_logs (id, workspace_id, client_id, name, status, logged_by, started_at, last_activity_at)
values (:'stale_log', :'ws', :'ana', 'Forgotten', 'in_progress', :'coach', now() - interval '5 hours', now() - interval '4 hours');
insert into public.log_blocks (id, log_id, position, kind) values (gen_random_uuid(), :'stale_log', 0, 'straight');
insert into public.log_exercises (block_id, position, exercise_id)
select b.id, 0, tests.create_exercise(null, 'Stale ex') from public.log_blocks b where b.log_id = :'stale_log';
insert into public.log_sets (log_exercise_id, position, set_type, actual_reps, completed_at)
select e.id, 0, 'normal', 5, now() - interval '4 hours' from public.log_exercises e
join public.log_blocks b on b.id = e.block_id where b.log_id = :'stale_log';
select public.auto_finish_stale_logs();
select is((select status::text from public.workout_logs where id = :'stale_log'), 'completed', '(the job finished it)');
select is(tests.pending(:'ana', 'coach_logged'), 0, 'auto-finished logs do not enqueue');

select tests.claims(:'ana');
select tests.create_log(:'ws', :'ana', null, 'completed');
select set_config('request.jwt.claims', '', true);
select is(tests.pending(:'ana', 'coach_logged'), 0, 'the client finishing their own log does not enqueue');

-- Comments
select tests.claims(:'coach');
insert into public.workout_log_comments (log_id, body, author_id) values (:'coach_log', 'Great depth on those squats', :'coach');
select set_config('request.jwt.claims', '', true);
select tests.claims(:'sam');
insert into public.workout_log_comments (log_id, body, author_id) values (:'coach_log', 'Thanks!', :'sam');
select set_config('request.jwt.claims', '', true);
select results_eq(format($$select data->>'workoutName', data->>'logId', data ? 'body' from public.push_outbox
  where user_id = %L and type = 'workout_comment'$$, :'sam'),
  format($$values ('Upper A', %L, false)$$, :'coach_log'),
  'coach comment enqueues workout_comment (the client''s own does not), without the text');

-- Messages ----------------------------------------------------------------------------------------------------------
select tests.act_as(:'coach');
select public.get_or_create_conversation(:'sam') as conv \gset
insert into public.messages (conversation_id, body) values (:'conv', 'Your weigh-in looked great: 82 kg');
reset role;
select is(tests.pending(:'sam', 'message'), 1, 'coach message enqueues');
select tests.act_as(:'sam');
insert into public.messages (conversation_id, body) values (:'conv', 'Thanks coach');
reset role;
select is((select count(*)::int from public.push_outbox where type = 'message'), 1, 'client message does not enqueue');
select tests.act_as(:'coach');
insert into public.messages (conversation_id, body) values (:'conv', 'See you Tuesday');
reset role;
select results_eq(format($$select count(*)::int, count(distinct group_key)::int, min(group_key) from public.push_outbox
  where user_id = %L and type = 'message'$$, :'sam'),
  format($$values (2, 1, 'message:' || %L)$$, :'conv'), 'two messages share one group');
select is((select count(*)::int from public.push_outbox where type = 'message' and (data ? 'body' or data::text like '%82 kg%')), 0,
  'message data carries no body');

-- Food targets --------------------------------------------------------------------------------------------------------
select tests.act_as(:'coach');
select public.set_nutrition_targets(:'ws', :'sam', 2200, 160, 250, 70);
select public.set_nutrition_targets(:'ws', :'sam', 2100, 160, 240, 70);
reset role;
select results_eq(format($$select count(*)::int, max(data->>'actorName') from public.push_outbox
  where user_id = %L and type = 'food_targets'$$, :'sam'), $$values (1, 'Luis')$$, 'targets set by coach enqueue once');
update public.push_outbox set sent_at = now(), outcome = 'sent' where type = 'food_targets';
select tests.act_as(:'coach');
select public.set_nutrition_targets(:'ws', :'sam', 2100, 160, 240, 70);
reset role;
select is((select count(*)::int from public.push_outbox where type = 'food_targets'), 1, 'targets saved unchanged do not enqueue');

-- Community -----------------------------------------------------------------------------------------------------------
select id as comm from public.communities where workspace_id = :'ws' \gset
select gen_random_uuid() as coach_post \gset
select tests.act_as(:'coach');
select public.create_community_post(:'coach_post', :'comm', 'Welcome to the group');
reset role;
select set_eq(format($$select user_id from public.push_outbox where type = 'community_coach_post' and data->>'postId' = %L$$, :'coach_post'),
  format($$values (%L::uuid), (%L::uuid), (%L::uuid)$$, :'sam', :'kim', :'ana'), 'coach post reaches clients, not the coach');
select is((select distinct data->>'communityName' from public.push_outbox where type = 'community_coach_post'), 'Luis Bueno Coaching',
  'the coach post names the workspace');

select gen_random_uuid() as sam_post \gset
select tests.act_as(:'sam');
select public.create_community_post(:'sam_post', :'comm', 'Squat PR today');
reset role;
select tests.act_as(:'kim');
insert into public.community_reactions (post_id, reaction) values (:'sam_post', 'fire');
reset role;
select results_eq(format($$select data->>'activity', data->>'actorName', data->>'actorId', not_before = now() + interval '5 minutes'
  from public.push_outbox where user_id = %L and type = 'community_activity'$$, :'sam'),
  format($$values ('reaction', 'Kim', %L, true)$$, :'kim'), 'reaction on sam''s post: one row, 5 minutes out');

update public.push_outbox set not_before = now() + interval '3 minutes' where type = 'community_activity';
select tests.act_as(:'ana');
insert into public.community_reactions (post_id, reaction) values (:'sam_post', 'heart');
reset role;
select results_eq(format($$select count(*)::int, count(distinct not_before)::int from public.push_outbox
  where user_id = %L and type = 'community_activity'$$, :'sam'), $$values (2, 1)$$, 'second reaction joins the send time');

select tests.act_as(:'kim');
insert into public.community_comments (post_id, body) values (:'sam_post', 'Huge!');
reset role;
select id as kim_comment from public.community_comments where post_id = :'sam_post' and author_id = :'kim' \gset
select is((select count(*)::int from public.push_outbox where user_id = :'sam' and type = 'community_activity'
  and group_key = 'community_activity:comment:' || :'sam_post'), 1, 'a comment on sam''s post enqueues in its own group');

select tests.act_as(:'sam');
insert into public.community_reactions (post_id, comment_id, reaction) values (:'sam_post', :'kim_comment', 'heart');
reset role;
select is(tests.pending(:'kim', 'community_activity'), 0, 'a reaction on a comment is not pushed');

select id as kim_notif from public.community_notifications where actor_id = :'kim' and kind = 'reaction' and comment_id is null \gset
select tests.act_as(:'kim');
delete from public.community_reactions where post_id = :'sam_post' and user_id = :'kim' and comment_id is null;
reset role;
select is((select count(*)::int from public.push_outbox where data->>'notificationId' = :'kim_notif'), 0,
  'un-reacting removes the pending push');
select is((select count(*)::int from public.push_outbox where user_id = :'sam' and type = 'community_activity'), 2,
  '... and leaves the others');

-- Workspaces and removal ----------------------------------------------------------------------------------------------
select is((select count(*)::int from public.push_outbox where user_id = :'lee' or workspace_id = :'ws2'), 0, 'nothing crosses workspaces');
select is((select count(*)::int from public.push_outbox where user_id in (:'coach', :'coach2')), 0, 'coaches get no client pushes');

select tests.act_as(:'coach');
select public.remove_client(:'ws', :'kim');
reset role;
select is((select count(*)::int from public.push_outbox where user_id = :'kim' and sent_at is null), 0,
  'removing a client drops their pending pushes');
select gen_random_uuid() as coach_post2 \gset
select tests.act_as(:'coach');
select public.create_community_post(:'coach_post2', :'comm', 'Second post');
reset role;
select is((select count(*)::int from public.push_outbox where user_id = :'kim' and data->>'postId' = :'coach_post2'), 0,
  'removed client gets nothing');

select * from finish();
rollback;
