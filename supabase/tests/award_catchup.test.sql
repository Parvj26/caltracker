begin;
select plan(55);

-- Fixtures (as postgres)
select tests.create_user('ac-coach@t.local', 'Coach') as coach \gset
select tests.create_user('ac-1@t.local', 'Client 1') as c1 \gset
select tests.create_user('ac-2@t.local', 'Client 2') as c2 \gset
select tests.create_user('ac-3@t.local', 'Client 3') as c3 \gset
select tests.create_user('ac-4@t.local', 'Client 4') as c4 \gset
select tests.create_user('ac-5@t.local', 'Client 5') as c5 \gset
select tests.create_user('ac-gone@t.local', 'Client Gone') as gone \gset
select tests.create_workspace('AC Workspace', :'coach') as ws \gset
select tests.add_client(:'ws', :'c1');
select tests.add_client(:'ws', :'c2');
select tests.add_client(:'ws', :'c3');
select tests.add_client(:'ws', :'c4');
select tests.add_client(:'ws', :'c5');
select tests.add_client(:'ws', :'gone');
select tests.create_exercise(null, 'AC lift') as ex \gset

-- l1 and l_pending finished 10 minutes ago, l_recent 1 minute ago; l_open is still in progress.
select tests.create_log(:'ws', :'c1') as l1 \gset
select tests.create_log(:'ws', :'c1') as l_recent \gset
update public.workout_logs set finished_at = now() - interval '1 minute' where id = :'l_recent';
select tests.create_log(:'ws', :'c2', null, 'in_progress') as l_open \gset
select tests.create_log(:'ws', :'c2') as l_pending \gset
-- l_gone: its client was removed by the coach. l_maxed: the catch-up already tried it 8 times.
select tests.create_log(:'ws', :'gone') as l_gone \gset
delete from public.workspace_members where workspace_id = :'ws' and user_id = :'gone';
select tests.create_log(:'ws', :'c4') as l_maxed \gset
insert into public.award_catchup_attempts (log_id, attempts) values (:'l_maxed', 8);
-- c3 and c5: logs for the history, revision and recompute cases below.
select tests.create_log(:'ws', :'c3') as l3 \gset
select tests.create_log(:'ws', :'c5') as l5 \gset

-- Privileges: only the service role reads inputs and writes awards; nobody but the cron job runs the catch-up.
select ok(not has_function_privilege('authenticated', 'public.apply_award(uuid, jsonb)', 'execute'),
  'authenticated cannot run apply_award');
select ok(not has_function_privilege('anon', 'public.apply_award(uuid, jsonb)', 'execute'),
  'anon cannot run apply_award');
select ok(has_function_privilege('service_role', 'public.apply_award(uuid, jsonb)', 'execute'),
  'service_role can run apply_award');
select ok(not has_function_privilege('authenticated', 'public.award_inputs(uuid)', 'execute'),
  'authenticated cannot read award inputs');
select ok(not has_function_privilege('anon', 'public.award_inputs(uuid)', 'execute'), 'anon cannot read award inputs');
select ok(has_function_privilege('service_role', 'public.award_inputs(uuid)', 'execute'),
  'service_role can read award inputs');
select ok(not has_function_privilege('authenticated', 'public.award_catchup()', 'execute'),
  'authenticated cannot run the catch-up');
select ok(not has_function_privilege('service_role', 'public.award_catchup()', 'execute'),
  'service_role cannot run the catch-up');
select ok((select relrowsecurity from pg_class where oid = 'public.award_catchup_attempts'::regclass),
  'RLS is on for the catch-up attempts');

select tests.act_as(:'c1');
select throws_ok(format($q$select public.apply_award(%L, '{}'::jsonb)$q$, :'l1'), '42501', null,
  'a client calling apply_award is refused');
select throws_ok('select count(*) from public.award_catchup_attempts', '42501', null,
  'a client cannot read the catch-up attempts');
reset role;

-- The catch-up job.
select is((select count(*)::int from cron.job where jobname = 'award-catchup'), 1, 'exactly one catch-up job');
select is((select schedule from cron.job where jobname = 'award-catchup'), '*/15 * * * *', 'it runs every 15 minutes');
select is((select command from cron.job where jobname = 'award-catchup'), 'select public.award_catchup()',
  'it runs award_catchup');

-- award_inputs
select is(public.award_inputs(gen_random_uuid()), null, 'no inputs for an unknown log');
select is(public.award_inputs(:'l1') -> 'log' ->> 'client_id', :'c1', 'inputs name the log owner');
select is(jsonb_array_length(public.award_inputs(:'l1') -> 'logs'), 2, 'inputs hold the client''s completed logs');
select is(jsonb_array_length(public.award_inputs(:'l1') -> 'logs' -> 0 -> 'log_blocks' -> 0 -> 'log_exercises' -> 0
  -> 'log_sets'), 1, 'only completed sets are sent');
select is(public.award_inputs(:'l1') ->> 'time_zone', 'UTC', 'inputs carry the time zone');
select is(public.award_inputs(:'l1') ->> 'history_version', public.award_history_version(:'c1', :'ws'),
  'inputs carry the history fingerprint');
select is(public.award_inputs(:'l_gone') -> 'log' ->> 'is_client', 'false', 'inputs say a removed client is not a client');

-- The fingerprint covers completed logs only: a log still in progress changing never makes an award retry.
select public.award_history_version(:'c2', :'ws') as fp_c2 \gset
update public.workout_logs set revision = revision + 1, last_activity_at = now() where id = :'l_open';
select is(public.award_history_version(:'c2', :'ws'), :'fp_c2', 'saving a log in progress keeps the fingerprint');
update public.workout_logs set status = 'completed', finished_at = now() where id = :'l_open';
select isnt(public.award_history_version(:'c2', :'ws'), :'fp_c2', 'finishing it changes the fingerprint');
update public.workout_logs set status = 'in_progress', finished_at = null where id = :'l_open';
select is(public.award_history_version(:'c2', :'ws'), :'fp_c2', 'reopening it changes it back');

-- apply_award
select format($j${
  "mode": "award", "owned_total": 0, "history_version": "%3$s",
  "award": {"ladder": {"key": "goat"}, "drop": null, "rare": [], "landmarks": ["chichen-itza"], "milestone": 1, "prs": []},
  "stickers": [{"key": "goat", "shiny": false}, {"key": "chichen-itza", "shiny": false}],
  "records": [
    {"exercise_id": "%1$s", "kind": "heaviest", "value_kg": 60, "reps": 8, "log_id": "%2$s", "achieved_at": "2026-11-05T10:00:00Z"},
    {"exercise_id": "%1$s", "kind": "reps_at_weight", "value_kg": 60, "reps": 8, "log_id": "%2$s", "achieved_at": "2026-11-05T10:00:00Z"},
    {"exercise_id": "%1$s", "kind": "reps_at_weight", "value_kg": 50, "reps": 9, "log_id": "%2$s", "achieved_at": "2026-11-05T10:00:00Z"}
  ],
  "stats": {"workouts": 1, "streak": 1, "streak_week": "2026-11-02", "best_streak": 1, "journey_week": 1, "pr_count": 0,
    "lifetime_volume_kg": 480}
}$j$, :'ex', :'l1', public.award_history_version(:'c1', :'ws')) as award1 \gset

select is(public.apply_award(:'l1', :'award1'::jsonb) ->> 'status', 'awarded', 'the first award is written');
select results_eq(format($q$select client_id, workspace_id from public.awards where log_id = %L$q$, :'l1'),
  format($q$values (%L::uuid, %L::uuid)$q$, :'c1', :'ws'), 'the award row takes its owner from the log');
select results_eq(format($q$select sticker_key, count, first_log_id from public.sticker_awards where client_id = %L order by 1$q$, :'c1'),
  format($q$values ('chichen-itza', 1, %1$L::uuid), ('goat', 1, %1$L::uuid)$q$, :'l1'), 'each sticker is granted once');
select is((select count(*)::int from public.personal_records where client_id = :'c1'), 3, 'the bests are stored');
select is((select workouts from public.client_stats where client_id = :'c1'), 1, 'the stats are stored');
select is((select streak_week from public.client_stats where client_id = :'c1'), '2026-11-02'::date,
  'with the Monday of the streak''s last week');

select is(public.apply_award(:'l1', jsonb_set(:'award1'::jsonb, '{award,ladder,key}', '"hippo"')),
  jsonb_build_object('status', 'existing', 'result', :'award1'::jsonb -> 'award'),
  'a second award returns the first result');
select is((select sum(count)::int from public.sticker_awards where client_id = :'c1'), 2, 'and grants nothing more');

select is(public.apply_award(:'l_recent', jsonb_set(:'award1'::jsonb, '{owned_total}', '0')) ->> 'status', 'conflict',
  'an award worked out from an old sticker count is refused');
select is((select count(*)::int from public.awards where log_id = :'l_recent'), 0, 'and writes nothing');

-- A recompute keeps stickers and rolls, replaces the PRs, the bests and the stats.
select is(public.apply_award(:'l1', format($j${
  "mode": "recompute", "owned_total": 99, "history_version": "%3$s",
  "award": {"ladder": {"key": "hippo"}, "drop": "kakapo", "rare": [], "landmarks": [], "milestone": null, "prs": [{"kind": "e1rm"}]},
  "stickers": [{"key": "hippo", "shiny": true}],
  "records": [{"exercise_id": "%1$s", "kind": "heaviest", "value_kg": 55, "reps": 8, "log_id": "%2$s", "achieved_at": "2026-11-05T10:00:00Z"}],
  "stats": {"workouts": 1, "streak": 1, "best_streak": 1, "journey_week": 1, "pr_count": 1, "lifetime_volume_kg": 440}
}$j$, :'ex', :'l1', public.award_history_version(:'c1', :'ws'))::jsonb) -> 'result',
  jsonb_set(:'award1'::jsonb -> 'award', '{prs}', '[{"kind": "e1rm"}]'),
  'a recompute returns the first award with the new PRs');
select results_eq(format($q$select sticker_key, count, shiny from public.sticker_awards where client_id = %L order by 1$q$, :'c1'),
  $q$values ('chichen-itza', 1, false), ('goat', 1, false)$q$, 'a recompute never touches stickers');
select results_eq(format($q$select kind, value_kg from public.personal_records where client_id = %L$q$, :'c1'),
  $q$values ('heaviest', 55.000::numeric(8,3))$q$, 'a recompute rewrites the bests, dropping those no longer held');

select throws_ok(format($q$select public.apply_award(%L, %L::jsonb)$q$, :'l_open', :'award1'), '23514', null,
  'an unfinished log gets no award');
select throws_ok(format($q$select public.apply_award(%L, %L::jsonb)$q$, :'l_gone', :'award1'), '42501',
  'You are no longer a client of this coach.', 'a removed client gets no award');

-- A history that changed between award_inputs and apply_award is refused, in both modes.
select jsonb_set(jsonb_set(:'award1'::jsonb, '{history_version}', to_jsonb(public.award_history_version(:'c3', :'ws'))),
  '{records}', '[]') as award3 \gset
update public.workout_logs set corrected_at = now() where id = :'l3';
select is(public.apply_award(:'l3', :'award3'::jsonb) ->> 'status', 'conflict',
  'an award from a history that changed (a correction) is refused');
select is((select count(*)::int from public.awards where log_id = :'l3'), 0, 'and writes nothing');
select is(public.apply_award(:'l3', jsonb_set(:'award3'::jsonb, '{mode}', '"recompute"')) ->> 'status', 'conflict',
  'so is a recompute from a changed history');

-- A recompute of a log with no award yet is a full award.
select jsonb_set(jsonb_set(:'award1'::jsonb, '{history_version}', to_jsonb(public.award_history_version(:'c5', :'ws'))),
  '{records}', '[]') as award5 \gset
select is(public.apply_award(:'l5', jsonb_set(:'award5'::jsonb, '{mode}', '"recompute"')) ->> 'status', 'awarded',
  'a recompute of a log with no award yet awards it');
select is((select sum(count)::int from public.sticker_awards where client_id = :'c5'), 2, 'with its stickers');

-- A reopened and re-finished log (new revision) is recomputed by a plain award call: PRs only, no stickers.
update public.workout_logs set revision = revision + 1 where id = :'l5';
select is(public.apply_award(:'l5', jsonb_set(jsonb_set(:'award5'::jsonb, '{history_version}',
    to_jsonb(public.award_history_version(:'c5', :'ws'))), '{award,prs}', '[{"kind": "heaviest"}]')),
  jsonb_build_object('status', 'recomputed', 'result',
    jsonb_set(:'award5'::jsonb -> 'award', '{prs}', '[{"kind": "heaviest"}]')),
  'a re-finished log is recomputed');
select is((select sum(count)::int from public.sticker_awards where client_id = :'c5'), 2, 'its stickers stay');
select is((select log_revision from public.awards where log_id = :'l5'),
  (select revision from public.workout_logs where id = :'l5'), 'the award remembers the new revision');

-- award_catchup: without its Vault secrets it fails loudly.
do $$
declare
  v_id uuid;
begin
  for v_id in select id from vault.secrets where name in ('award_workout_url', 'award_workout_secret') loop
    perform vault.update_secret(v_id, '');
  end loop;
end;
$$;
select throws_ok('select public.award_catchup()', '55000', null, 'the catch-up fails without its Vault secrets');

-- award_catchup: queue a call for each completed log older than 2 minutes without an award.
do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'award_workout_url';
  if v_id is null then
    perform vault.create_secret('http://award.test/functions/v1/award-workout', 'award_workout_url');
  else
    perform vault.update_secret(v_id, 'http://award.test/functions/v1/award-workout');
  end if;
  select id into v_id from vault.secrets where name = 'award_workout_secret';
  if v_id is null then
    perform vault.create_secret('pgtap-secret', 'award_workout_secret');
  else
    perform vault.update_secret(v_id, 'pgtap-secret');
  end if;
end;
$$;

select ok(public.award_catchup() >= 1, 'the catch-up queues calls');
select results_eq(
  format($q$select (convert_from(q.body, 'utf8')::jsonb ->> 'logId')::uuid from net.http_request_queue q
    where q.url = 'http://award.test/functions/v1/award-workout'
      and (convert_from(q.body, 'utf8')::jsonb ->> 'logId')::uuid in (%L, %L, %L, %L, %L, %L)$q$,
    :'l1', :'l_recent', :'l_open', :'l_pending', :'l_gone', :'l_maxed'),
  format($q$values (%L::uuid)$q$, :'l_pending'),
  'only the finished, unawarded, older-than-2-minutes log of a current client, tried under 8 times, is called');
select is((select q.headers ->> 'x-award-secret' from net.http_request_queue q
  where convert_from(q.body, 'utf8')::jsonb ->> 'logId' = :'l_pending'), 'pgtap-secret', 'with the secret from Vault');
select is((select attempts from public.award_catchup_attempts where log_id = :'l_pending'), 1, 'the call is counted');
update public.award_catchup_attempts set attempts = 7 where log_id = :'l_pending';
select ok(public.award_catchup() >= 1, 'a log is tried again until its 8th call');
select is((select attempts from public.award_catchup_attempts where log_id = :'l_pending'), 8, 'that makes 8 tries');
select is((select count(*)::int from public.award_catchup_attempts where log_id = :'l_maxed' and attempts = 8), 1,
  'a log tried 8 times is left alone');

select * from finish();
rollback;
