begin;
select plan(33);

-- Fixtures (as postgres)
select tests.create_user('ac-coach@t.local', 'Coach') as coach \gset
select tests.create_user('ac-1@t.local', 'Client 1') as c1 \gset
select tests.create_user('ac-2@t.local', 'Client 2') as c2 \gset
select tests.create_workspace('AC Workspace', :'coach') as ws \gset
select tests.add_client(:'ws', :'c1');
select tests.add_client(:'ws', :'c2');
select tests.create_exercise(null, 'AC lift') as ex \gset

-- l1 and l_pending finished 10 minutes ago, l_recent 1 minute ago; l_open is still in progress.
select tests.create_log(:'ws', :'c1') as l1 \gset
select tests.create_log(:'ws', :'c1') as l_recent \gset
update public.workout_logs set finished_at = now() - interval '1 minute' where id = :'l_recent';
select tests.create_log(:'ws', :'c2', null, 'in_progress') as l_open \gset
select tests.create_log(:'ws', :'c2') as l_pending \gset

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

select tests.act_as(:'c1');
select throws_ok(format($q$select public.apply_award(%L, '{}'::jsonb)$q$, :'l1'), '42501', null,
  'a client calling apply_award is refused');
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

-- apply_award
select format($j${
  "mode": "award", "owned_total": 0,
  "award": {"ladder": {"key": "goat"}, "drop": null, "rare": [], "landmarks": ["chichen-itza"], "milestone": 1, "prs": []},
  "stickers": [{"key": "goat", "shiny": false}, {"key": "chichen-itza", "shiny": false}],
  "records": [
    {"exercise_id": "%1$s", "kind": "heaviest", "value_kg": 60, "reps": 8, "log_id": "%2$s", "achieved_at": "2026-11-05T10:00:00Z"},
    {"exercise_id": "%1$s", "kind": "reps_at_weight", "value_kg": 60, "reps": 8, "log_id": "%2$s", "achieved_at": "2026-11-05T10:00:00Z"},
    {"exercise_id": "%1$s", "kind": "reps_at_weight", "value_kg": 50, "reps": 9, "log_id": "%2$s", "achieved_at": "2026-11-05T10:00:00Z"}
  ],
  "stats": {"workouts": 1, "streak": 1, "best_streak": 1, "journey_week": 1, "pr_count": 0, "lifetime_volume_kg": 480}
}$j$, :'ex', :'l1') as award1 \gset

select is(public.apply_award(:'l1', :'award1'::jsonb) ->> 'status', 'awarded', 'the first award is written');
select results_eq(format($q$select client_id, workspace_id from public.awards where log_id = %L$q$, :'l1'),
  format($q$values (%L::uuid, %L::uuid)$q$, :'c1', :'ws'), 'the award row takes its owner from the log');
select results_eq(format($q$select sticker_key, count, first_log_id from public.sticker_awards where client_id = %L order by 1$q$, :'c1'),
  format($q$values ('chichen-itza', 1, %1$L::uuid), ('goat', 1, %1$L::uuid)$q$, :'l1'), 'each sticker is granted once');
select is((select count(*)::int from public.personal_records where client_id = :'c1'), 3, 'the bests are stored');
select is((select workouts from public.client_stats where client_id = :'c1'), 1, 'the stats are stored');

select is(public.apply_award(:'l1', jsonb_set(:'award1'::jsonb, '{award,ladder,key}', '"hippo"')),
  jsonb_build_object('status', 'existing', 'result', :'award1'::jsonb -> 'award'),
  'a second award returns the first result');
select is((select sum(count)::int from public.sticker_awards where client_id = :'c1'), 2, 'and grants nothing more');

select is(public.apply_award(:'l_recent', jsonb_set(:'award1'::jsonb, '{owned_total}', '0')) ->> 'status', 'conflict',
  'an award worked out from an old sticker count is refused');
select is((select count(*)::int from public.awards where log_id = :'l_recent'), 0, 'and writes nothing');

-- A recompute keeps stickers and rolls, replaces the PRs, the bests and the stats.
select is(public.apply_award(:'l1', format($j${
  "mode": "recompute", "owned_total": 99,
  "award": {"ladder": {"key": "hippo"}, "drop": "kakapo", "rare": [], "landmarks": [], "milestone": null, "prs": [{"kind": "e1rm"}]},
  "stickers": [{"key": "hippo", "shiny": true}],
  "records": [{"exercise_id": "%1$s", "kind": "heaviest", "value_kg": 55, "reps": 8, "log_id": "%2$s", "achieved_at": "2026-11-05T10:00:00Z"}],
  "stats": {"workouts": 1, "streak": 1, "best_streak": 1, "journey_week": 1, "pr_count": 1, "lifetime_volume_kg": 440}
}$j$, :'ex', :'l1')::jsonb) -> 'result',
  jsonb_set(:'award1'::jsonb -> 'award', '{prs}', '[{"kind": "e1rm"}]'),
  'a recompute returns the first award with the new PRs');
select results_eq(format($q$select sticker_key, count, shiny from public.sticker_awards where client_id = %L order by 1$q$, :'c1'),
  $q$values ('chichen-itza', 1, false), ('goat', 1, false)$q$, 'a recompute never touches stickers');
select results_eq(format($q$select kind, value_kg from public.personal_records where client_id = %L$q$, :'c1'),
  $q$values ('heaviest', 55.000::numeric(8,3))$q$, 'a recompute rewrites the bests, dropping those no longer held');

select throws_ok(format($q$select public.apply_award(%L, %L::jsonb)$q$, :'l_open', :'award1'), '23514', null,
  'an unfinished log gets no award');

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
      and (convert_from(q.body, 'utf8')::jsonb ->> 'logId')::uuid in (%L, %L, %L, %L)$q$,
    :'l1', :'l_recent', :'l_open', :'l_pending'),
  format($q$values (%L::uuid)$q$, :'l_pending'),
  'only the finished, unawarded, older-than-2-minutes log is called');
select is((select q.headers ->> 'x-award-secret' from net.http_request_queue q
  where convert_from(q.body, 'utf8')::jsonb ->> 'logId' = :'l_pending'), 'pgtap-secret', 'with the secret from Vault');

select * from finish();
rollback;
