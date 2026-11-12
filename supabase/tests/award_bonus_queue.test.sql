begin;
select plan(37);

-- The bonus queue (20261110008000): at most one bonus sticker per workout; the rest wait in award_bonus_queue.
-- Read like awards (the coach of the workspace, or the client while still a client there); only apply_award writes.
-- Fixtures as postgres.
select tests.create_user('bq-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('bq-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('bq-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('bq-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('bq-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('BQ Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('BQ Workspace B', :'coach_b') as ws_b \gset
-- a1 trained with coach B first (one coach at a time), then moved to workspace A.
select tests.add_client(:'ws_b', :'a1');
select tests.create_log(:'ws_b', :'a1') as l_a1_old \gset
delete from public.workspace_members where workspace_id = :'ws_b' and user_id = :'a1';
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select tests.create_log(:'ws_a', :'a2') as l_a2 \gset
select tests.create_log(:'ws_b', :'b1') as l_b1 \gset

insert into public.award_bonus_queue (client_id, workspace_id, earned_log_id, kind, sticker_key, value, earned_at) values
  (:'a1', :'ws_b', :'l_a1_old', 'landmark', 'petra', null, now() - interval '1 day'),
  (:'a2', :'ws_a', :'l_a2', 'rare', 'quokka', null, now() - interval '1 day'),
  (:'b1', :'ws_b', :'l_b1', 'milestone', null, 10, now() - interval '1 day');
select id as q_a2 from public.award_bonus_queue where client_id = :'a2' \gset

-- Structure and privileges
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.award_bonus_queue'::regclass),
  'RLS is enabled on award_bonus_queue');
select table_privs_are('public', 'award_bonus_queue', 'authenticated', array['SELECT'],
  'authenticated has exactly select on award_bonus_queue');
select ok(not has_table_privilege('anon', 'public.award_bonus_queue', 'select,insert,update,delete'),
  'anon has no privileges on award_bonus_queue');
select ok(not has_function_privilege('authenticated', 'public.award_bonus_queue_version(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.award_bonus_queue_version(uuid, uuid)', 'execute'),
  'nobody outside the award functions runs award_bonus_queue_version');
select throws_ok(format($$insert into public.award_bonus_queue (client_id, workspace_id, earned_log_id, kind, sticker_key, earned_at)
  values (%L, %L, %L, 'milestone', 'petra', now())$$, :'a2', :'ws_a', :'l_a2'), '23514', null,
  'a milestone carries a count, not a sticker');
select throws_ok(format($$insert into public.award_bonus_queue (client_id, workspace_id, earned_log_id, kind, earned_at)
  values (%L, %L, %L, 'rare', now())$$, :'a2', :'ws_a', :'l_a2'), '23514', null, 'a rare find carries its sticker');

-- A client reads only their own rows, in the workspace they are a client of now
select tests.act_as(:'a2');
select is((select count(*)::int from public.award_bonus_queue), 1, 'a client sees exactly their own queued bonus');
select tests.act_as(:'a1');
select is((select count(*)::int from public.award_bonus_queue), 0,
  'a client sees nothing of another client, nor their own rows from a coach they left');
select throws_ok(format($$insert into public.award_bonus_queue (client_id, workspace_id, earned_log_id, kind, sticker_key, earned_at)
  values (%L, %L, %L, 'rare', 'axolotl', now())$$, :'a1', :'ws_a', :'l_a2'), '42501', null, 'a client cannot queue a bonus');
select throws_ok($$update public.award_bonus_queue set value = 50$$, '42501', null, 'a client cannot change the queue');
select throws_ok($$delete from public.award_bonus_queue$$, '42501', null, 'a client cannot empty the queue');

-- A coach reads their workspace only
reset role;
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.award_bonus_queue where workspace_id = :'ws_a'), 1, 'coach A sees their client''s row');
select is((select count(*)::int from public.award_bonus_queue where workspace_id <> :'ws_a'), 0,
  'coach A sees nothing from another workspace');
select throws_ok($$delete from public.award_bonus_queue$$, '42501', null, 'a coach cannot change the queue either');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.award_bonus_queue), 2, 'coach B sees their workspace''s rows, a1''s old one too');
select is((select count(*)::int from public.award_bonus_queue where workspace_id = :'ws_a'), 0,
  'coach B sees nothing from workspace A');
reset role;
select tests.act_as_anon();
select throws_ok($$select * from public.award_bonus_queue$$, '42501', null, 'anon cannot read award_bonus_queue');
reset role;

-- apply_award applies the queue changes on a first award only
create function pg_temp.payload(p_log uuid, p_bonus jsonb) returns jsonb language sql as $$
  select jsonb_build_object('mode', 'award',
    'owned_total', (select coalesce(sum(s.count), 0) from public.sticker_awards s
      where s.client_id = l.client_id and s.workspace_id = l.workspace_id),
    'history_version', public.award_history_version(l.client_id, l.workspace_id),
    'award', jsonb_build_object('ladder', jsonb_build_object('key', 'goat', 'multiple', 1, 'isNew', true, 'count', 1,
      'shiny', false), 'drop', null, 'rare', '[]'::jsonb, 'landmarks', '[]'::jsonb, 'milestone', 1, 'prs', '[]'::jsonb),
    'stickers', '[{"key": "goat", "shiny": false}]'::jsonb, 'records', '[]'::jsonb,
    'stats', jsonb_build_object('workouts', 1, 'streak', 1, 'best_streak', 1, 'journey_week', 1, 'pr_count', 0,
      'lifetime_volume_kg', 100))
    || case when p_bonus is null then '{}'::jsonb else jsonb_build_object('bonus', p_bonus) end
  from public.workout_logs l where l.id = p_log;
$$;
create function pg_temp.version(p_client uuid, p_ws uuid) returns text language sql security definer as $$
  select public.award_bonus_queue_version(p_client, p_ws);
$$;
create function pg_temp.queue(p_client uuid, p_ws uuid) returns table (kind text, sticker_key text, value int)
language sql as $$
  select q.kind, q.sticker_key, q.value from public.award_bonus_queue q
  where q.client_id = p_client and q.workspace_id = p_ws order by q.seq;
$$;

select tests.create_log(:'ws_a', :'a1') as l1 \gset
select tests.create_log(:'ws_a', :'a1') as l2 \gset
select tests.create_log(:'ws_a', :'a1') as l3 \gset
update public.workout_logs set finished_at = now() - interval '30 minutes' where id = :'l1';
update public.workout_logs set finished_at = now() - interval '20 minutes' where id = :'l2';
update public.workout_logs set finished_at = now() - interval '5 minutes' where id = :'l3';

-- award_inputs hands over this client's queue in this workspace only, with its fingerprint.
select is(public.award_inputs(:'l1') -> 'bonus_queue', '[]'::jsonb, 'a1 has nothing waiting in workspace A');
select is(public.award_inputs(:'l1') ->> 'bonus_queue_version', pg_temp.version(:'a1', :'ws_a'), 'with its fingerprint');
select is(jsonb_array_length(public.award_inputs(:'l_a2') -> 'bonus_queue'), 1, 'a2 has their own row only');

select is(public.apply_award(:'l1', pg_temp.payload(:'l1', jsonb_build_object('queue_version', pg_temp.version(:'a1', :'ws_a'),
    'from_queue', null, 'discard', '[]'::jsonb, 'enqueue',
    '[{"kind": "landmark", "key": "chichen-itza", "value": null}, {"kind": "rare", "key": "axolotl", "value": null}]'::jsonb)))
  ->> 'status', 'awarded', 'the first workout is awarded');
select results_eq(format($q$select * from pg_temp.queue(%L, %L)$q$, :'a1', :'ws_a'),
  $q$values ('landmark', 'chichen-itza', null::int), ('rare', 'axolotl', null::int)$q$,
  'what it earned but does not give waits, in priority order');
select is((select array_agg(distinct q.earned_at = l.finished_at) from public.award_bonus_queue q
    join public.workout_logs l on l.id = q.earned_log_id where q.client_id = :'a1' and q.workspace_id = :'ws_a'),
  array[true], 'stamped with when the workout that earned it finished');
select id as q_landmark from public.award_bonus_queue where client_id = :'a1' and sticker_key = 'chichen-itza' \gset

-- The same workout again never queues or hands out anything twice.
select is(public.apply_award(:'l1', pg_temp.payload(:'l1', jsonb_build_object('queue_version', pg_temp.version(:'a1', :'ws_a'),
    'from_queue', :'q_landmark', 'enqueue', '[{"kind": "milestone", "key": null, "value": 1}]'::jsonb))) ->> 'status',
  'existing', 'a retry returns the stored award');
update public.workout_logs set revision = revision + 1 where id = :'l1';
select is(public.apply_award(:'l1', pg_temp.payload(:'l1', jsonb_build_object('queue_version', pg_temp.version(:'a1', :'ws_a'),
    'from_queue', :'q_landmark', 'enqueue', '[{"kind": "milestone", "key": null, "value": 1}]'::jsonb))) ->> 'status',
  'recomputed', 'a re-finished workout is recomputed');
select is(public.apply_award(:'l1', jsonb_set(pg_temp.payload(:'l1', jsonb_build_object('queue_version',
    pg_temp.version(:'a1', :'ws_a'), 'from_queue', :'q_landmark', 'enqueue', '[{"kind": "milestone", "key": null, "value": 1}]'::jsonb)),
    '{mode}', '"recompute"')) ->> 'status', 'recomputed', 'and so is a coach correction');
select results_eq(format($q$select * from pg_temp.queue(%L, %L)$q$, :'a1', :'ws_a'),
  $q$values ('landmark', 'chichen-itza', null::int), ('rare', 'axolotl', null::int)$q$,
  'none of them touched the queue');

-- A queue that changed since it was read is refused, and nothing is written.
select is(public.apply_award(:'l2', pg_temp.payload(:'l2', jsonb_build_object('queue_version', md5('stale'),
    'from_queue', :'q_landmark', 'enqueue', '[]'::jsonb))) ->> 'status', 'conflict', 'a stale queue is a conflict');
select is((select count(*)::int from public.awards where log_id = :'l2'), 0, 'and no award was written');

-- The next workout hands out the waiting landmark; a row of another client named by mistake is left alone.
select is(public.apply_award(:'l2', pg_temp.payload(:'l2', jsonb_build_object('queue_version', pg_temp.version(:'a1', :'ws_a'),
    'from_queue', :'q_landmark', 'discard', jsonb_build_array(:'q_a2'),
    'enqueue', '[{"kind": "landmark", "key": "christ-the-redeemer", "value": null}]'::jsonb))) ->> 'status', 'awarded',
  'the second workout is awarded');
select results_eq(format($q$select * from pg_temp.queue(%L, %L)$q$, :'a1', :'ws_a'),
  $q$values ('rare', 'axolotl', null::int), ('landmark', 'christ-the-redeemer', null::int)$q$,
  'the handed-out row is gone and the new one waits');
select is((select count(*)::int from public.award_bonus_queue where id = :'q_a2'), 1, 'another client''s row is untouched');
select is((select count(*)::int from public.award_bonus_queue where client_id = :'a1' and workspace_id = :'ws_b'), 1,
  'and so is the client''s row with their old coach');

-- An award-workout from before the queue (no bonus) works as before; a malformed bonus is refused.
select throws_ok(format($q$select public.apply_award(%L, %L::jsonb)$q$, :'l3',
    pg_temp.payload(:'l3', '{"queue_version": "x", "enqueue": {}}'::jsonb)), '22023', null, 'a malformed bonus is refused');
select is(public.apply_award(:'l3', pg_temp.payload(:'l3', null)) ->> 'status', 'awarded', 'a call without a bonus is awarded');
select is((select count(*)::int from public.award_bonus_queue where client_id = :'a1' and workspace_id = :'ws_a'), 2,
  'and leaves the queue alone');

-- A deleted workout takes what it was still owed with it.
delete from public.workout_logs where id = :'l2';
select results_eq(format($q$select * from pg_temp.queue(%L, %L)$q$, :'a1', :'ws_a'),
  $q$values ('rare', 'axolotl', null::int)$q$, 'deleting a workout removes the bonuses it queued');

select * from finish();
rollback;
