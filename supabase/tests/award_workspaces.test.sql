-- Award data is per workspace: a client who leaves one coach and joins another starts fresh there.
-- The new coach sees nothing earned with the old one, the old coach's rows stay as they were, and the new
-- workspace's awards are worked out from its own logs only.
begin;
select plan(30);

-- Fixtures (as postgres)
select tests.create_user('awx-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('awx-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('awx-client@t.local', 'Mover') as c \gset
select tests.create_workspace('AWX Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('AWX Workspace B', :'coach_b') as ws_b \gset
select tests.create_exercise(null, 'AWX lift') as ex \gset

-- 1. The client trains with coach A and earns a sticker, a best and stats there.
select tests.add_client(:'ws_a', :'c');
select tests.create_log(:'ws_a', :'c') as la \gset
select format($j${
  "mode": "award", "owned_total": 0, "history_version": "%3$s",
  "award": {"ladder": {"key": "goat"}, "drop": null, "rare": [], "landmarks": ["chichen-itza"], "milestone": 1, "prs": []},
  "stickers": [{"key": "goat", "shiny": true}, {"key": "chichen-itza", "shiny": false}],
  "records": [{"exercise_id": "%1$s", "kind": "heaviest", "value_kg": 100, "reps": 5, "log_id": "%2$s", "achieved_at": "2026-11-02T10:00:00Z"}],
  "stats": {"workouts": 1, "streak": 1, "streak_week": "2026-11-02", "best_streak": 1, "journey_week": 1, "pr_count": 0,
    "lifetime_volume_kg": 500}
}$j$, :'ex', :'la', public.award_history_version(:'c', :'ws_a')) as award_a \gset
select is(public.apply_award(:'la', :'award_a'::jsonb) ->> 'status', 'awarded', 'the client earns with coach A');

-- 2. Coach A removes them; they join coach B and finish a workout there.
select tests.act_as(:'coach_a');
select lives_ok(format($q$select public.remove_client(%L, %L)$q$, :'ws_a', :'c'), 'coach A removes the client');
reset role;
select tests.add_client(:'ws_b', :'c');
select tests.create_log(:'ws_b', :'c') as lb \gset

-- award_inputs for the B log: only B's logs, no stickers, B's own fingerprint.
select is(public.award_inputs(:'lb') -> 'log' ->> 'is_client', 'true', 'the client is a client of B');
select results_eq(
  format($q$select (e ->> 'id')::uuid from jsonb_array_elements(public.award_inputs(%L) -> 'logs') e$q$, :'lb'),
  format($q$values (%L::uuid)$q$, :'lb'), 'B''s award inputs hold only B''s logs');
select is(public.award_inputs(:'lb') -> 'owned', '[]'::jsonb, 'B''s award inputs own no stickers from A');
select is((public.award_inputs(:'lb') ->> 'owned_total')::int, 0, 'and count none');
select is(public.award_inputs(:'lb') ->> 'history_version', public.award_history_version(:'c', :'ws_b'),
  'B''s inputs carry B''s fingerprint');
select isnt(public.award_history_version(:'c', :'ws_b'), public.award_history_version(:'c', :'ws_a'),
  'the two workspaces have their own fingerprints');

-- A change to the A log does not disturb an award in B.
select public.award_history_version(:'c', :'ws_b') as fp_b \gset
update public.workout_logs set corrected_at = now(), revision = revision + 1 where id = :'la';
select is(public.award_history_version(:'c', :'ws_b'), :'fp_b', 'a change to an A log keeps B''s fingerprint');

-- 3. B awards the same sticker and a best on the same exercise: a fresh start, not a second copy.
select format($j${
  "mode": "award", "owned_total": 0, "history_version": "%3$s",
  "award": {"ladder": {"key": "goat"}, "drop": null, "rare": [], "landmarks": ["chichen-itza"], "milestone": 1, "prs": []},
  "stickers": [{"key": "goat", "shiny": false}, {"key": "chichen-itza", "shiny": false}],
  "records": [{"exercise_id": "%1$s", "kind": "heaviest", "value_kg": 50, "reps": 5, "log_id": "%2$s", "achieved_at": "2026-11-05T10:00:00Z"}],
  "stats": {"workouts": 1, "streak": 1, "streak_week": "2026-11-02", "best_streak": 1, "journey_week": 1, "pr_count": 0,
    "lifetime_volume_kg": 250}
}$j$, :'ex', :'lb', :'fp_b') as award_b \gset
select is(public.apply_award(:'lb', :'award_b'::jsonb) ->> 'status', 'awarded',
  'B''s first award is worked out from a zero sticker count');

select results_eq(
  format($q$select workspace_id, sticker_key, count, shiny, first_log_id from public.sticker_awards
    where client_id = %L order by workspace_id = %L desc, sticker_key$q$, :'c', :'ws_a'),
  format($q$values (%1$L::uuid, 'chichen-itza', 1, false, %3$L::uuid), (%1$L::uuid, 'goat', 1, true, %3$L::uuid),
    (%2$L::uuid, 'chichen-itza', 1, false, %4$L::uuid), (%2$L::uuid, 'goat', 1, false, %4$L::uuid)$q$,
    :'ws_a', :'ws_b', :'la', :'lb'),
  'A''s sticker rows are unchanged and B has its own');
select results_eq(
  format($q$select workspace_id, value_kg, log_id from public.personal_records where client_id = %L
    order by workspace_id = %L desc$q$, :'c', :'ws_a'),
  format($q$values (%L::uuid, 100.000::numeric(8,3), %L::uuid), (%L::uuid, 50.000::numeric(8,3), %L::uuid)$q$,
    :'ws_a', :'la', :'ws_b', :'lb'),
  'each workspace keeps its own best for the same exercise');
select results_eq(
  format($q$select workspace_id, workouts, lifetime_volume_kg from public.client_stats where client_id = %L
    order by workspace_id = %L desc$q$, :'c', :'ws_a'),
  format($q$values (%L::uuid, 1, 500.000::numeric(14,3)), (%L::uuid, 1, 250.000::numeric(14,3))$q$, :'ws_a', :'ws_b'),
  'each workspace keeps its own stats');

-- A recompute in B with no bests left drops B's best only.
select is(public.apply_award(:'lb', jsonb_set(jsonb_set(:'award_b'::jsonb, '{mode}', '"recompute"'), '{records}', '[]'))
  ->> 'status', 'recomputed', 'a recompute in B');
select is((select count(*)::int from public.personal_records where client_id = :'c' and workspace_id = :'ws_b'), 0,
  'drops B''s best');
select is((select value_kg from public.personal_records where client_id = :'c' and workspace_id = :'ws_a'),
  100.000::numeric(8,3), 'and leaves A''s best alone');

-- 4. What each person can read.
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.sticker_awards where client_id = :'c'), 2, 'coach B sees B''s two stickers');
select is((select count(*)::int from public.sticker_awards where workspace_id = :'ws_a')
  + (select count(*)::int from public.awards where workspace_id = :'ws_a')
  + (select count(*)::int from public.personal_records where workspace_id = :'ws_a')
  + (select count(*)::int from public.client_stats where workspace_id = :'ws_a'), 0,
  'coach B sees nothing the client earned with coach A');
select is((select count(*)::int from public.awards where client_id = :'c'), 1, 'coach B sees B''s award only');
select is((select count(*)::int from public.client_stats where client_id = :'c'), 1, 'coach B sees B''s stats only');
reset role;

select tests.act_as(:'c');
select is((select count(*)::int from public.sticker_awards where workspace_id = :'ws_a')
  + (select count(*)::int from public.client_stats where workspace_id = :'ws_a'), 0,
  'the client no longer reads A''s rows');
select is((select count(*)::int from public.sticker_awards), 2, 'the client reads B''s stickers');
select is((select streak_week from public.client_stats), '2026-11-02'::date, 'and B''s stats');
reset role;

select tests.act_as(:'coach_a');
select is((select count(*)::int from public.sticker_awards where client_id = :'c'), 2, 'coach A still sees A''s stickers');
select is((select count(*)::int from public.awards where client_id = :'c'), 1, 'and A''s award');
select is((select count(*)::int from public.sticker_awards where workspace_id = :'ws_b')
  + (select count(*)::int from public.awards where workspace_id = :'ws_b')
  + (select count(*)::int from public.personal_records where workspace_id = :'ws_b')
  + (select count(*)::int from public.client_stats where workspace_id = :'ws_b'), 0,
  'coach A sees nothing from B');
reset role;

-- 5. A's old logs earn nothing more now the client has left A.
select is(public.award_inputs(:'la') -> 'log' ->> 'is_client', 'false', 'the A log''s client is no longer a client of A');
select throws_ok(format($q$select public.apply_award(%L, %L::jsonb)$q$, :'la', :'award_a'), '42501',
  'You are no longer a client of this coach.', 'and A''s logs earn nothing more');

-- 6. Deleting B leaves A's rows.
select lives_ok(format($q$delete from public.workspaces where id = %L$q$, :'ws_b'), 'workspace B can be deleted');
select is((select count(*)::int from public.sticker_awards where client_id = :'c' and workspace_id = :'ws_a')
  + (select count(*)::int from public.personal_records where client_id = :'c' and workspace_id = :'ws_a')
  + (select count(*)::int from public.client_stats where client_id = :'c' and workspace_id = :'ws_a'), 4,
  'A''s rows survive B''s deletion');

select * from finish();
rollback;
