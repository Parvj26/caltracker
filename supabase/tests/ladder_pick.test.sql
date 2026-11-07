begin;
select plan(19);

-- The ladder pick (20261107002000): award_inputs hands over the ladder history, and a recompute keeps or swaps
-- the stored animal. Fixtures as postgres.
select tests.create_user('lp-coach@t.local', 'Coach') as coach \gset
select tests.create_user('lp-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('lp-1@t.local', 'Client 1') as c1 \gset
select tests.create_user('lp-2@t.local', 'Client 2') as c2 \gset
select tests.create_workspace('LP Workspace', :'coach') as ws \gset
select tests.create_workspace('LP Workspace B', :'coach_b') as ws_b \gset
-- c1 trained with coach B first (one coach at a time), then moved to this workspace.
select tests.add_client(:'ws_b', :'c1');
select tests.create_log(:'ws_b', :'c1') as l_other_ws \gset
delete from public.workspace_members where workspace_id = :'ws_b' and user_id = :'c1';
select tests.add_client(:'ws', :'c1');
select tests.add_client(:'ws', :'c2');

-- c1 in ws: la finished 30 minutes ago, lb 20, lc 15 (its award has no animal), ld 5 (no award yet).
select tests.create_log(:'ws', :'c1') as la \gset
select tests.create_log(:'ws', :'c1') as lb \gset
select tests.create_log(:'ws', :'c1') as lc \gset
select tests.create_log(:'ws', :'c1') as ld \gset
update public.workout_logs set finished_at = now() - interval '30 minutes' where id = :'la';
update public.workout_logs set finished_at = now() - interval '20 minutes' where id = :'lb';
update public.workout_logs set finished_at = now() - interval '15 minutes' where id = :'lc';
update public.workout_logs set finished_at = now() - interval '5 minutes' where id = :'ld';
-- A log whose animal must not show: c2's (c1's coach-B log is above).
select tests.create_log(:'ws', :'c2') as l_other_client \gset

insert into public.awards (log_id, client_id, workspace_id, result) values
  (:'lb', :'c1', :'ws', '{"ladder": {"key": "goat", "multiple": 7.4, "isNew": true, "count": 1, "shiny": false}, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": []}'),
  (:'la', :'c1', :'ws', '{"ladder": {"key": "cat", "multiple": 120, "isNew": true, "count": 1, "shiny": false}, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": []}'),
  (:'lc', :'c1', :'ws', '{"ladder": null, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": []}'),
  (:'l_other_ws', :'c1', :'ws_b', '{"ladder": {"key": "hippo", "multiple": 1, "isNew": true, "count": 1, "shiny": false}, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": []}'),
  (:'l_other_client', :'c2', :'ws', '{"ladder": {"key": "pig", "multiple": 3, "isNew": true, "count": 1, "shiny": false}, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": []}');
insert into public.sticker_awards (client_id, workspace_id, sticker_key, count, shiny, first_log_id) values
  (:'c1', :'ws', 'cat', 1, false, :'la'),
  (:'c1', :'ws', 'goat', 2, false, :'lb'),
  (:'c1', :'ws', 'koala', 1, true, :'la');

-- award_inputs: the ladder history.
select is(public.award_inputs(:'ld') -> 'ladder_awards',
  jsonb_build_array(
    jsonb_build_object('log_id', :'la', 'finished_at', (select finished_at from public.workout_logs where id = :'la'), 'key', 'cat'),
    jsonb_build_object('log_id', :'lb', 'finished_at', (select finished_at from public.workout_logs where id = :'lb'), 'key', 'goat')),
  'award_inputs lists the client''s animals in this workspace, oldest first, skipping awards with none');
select is(public.award_inputs(:'l_other_ws') -> 'ladder_awards' -> 0 ->> 'key', 'hippo',
  'another workspace has its own history');
select is(jsonb_array_length(public.award_inputs(:'l_other_ws') -> 'ladder_awards'), 1, 'and only its own');
update public.workout_logs set status = 'in_progress', finished_at = null where id = :'la';
select is(jsonb_array_length(public.award_inputs(:'ld') -> 'ladder_awards'), 1,
  'a reopened log (no finish time) is left out until it is finished again');
update public.workout_logs set status = 'completed', finished_at = now() - interval '30 minutes' where id = :'la';

-- A recompute payload for lb, as award-workout sends it.
create function pg_temp.recompute(p_log uuid, p_ladder jsonb, p_owned_total bigint) returns jsonb
language sql as $$
  select jsonb_build_object('mode', 'recompute', 'owned_total', p_owned_total,
    'history_version', public.award_history_version(l.client_id, l.workspace_id),
    'award', jsonb_build_object('ladder', p_ladder, 'drop', 'kakapo', 'rare', '[]'::jsonb, 'landmarks', '[]'::jsonb,
      'milestone', null, 'prs', '[]'::jsonb),
    'stickers', '[]'::jsonb, 'records', '[]'::jsonb,
    'stats', jsonb_build_object('workouts', 4, 'streak', 1, 'best_streak', 1, 'journey_week', 1, 'pr_count', 0,
      'lifetime_volume_kg', 100))
  from public.workout_logs l where l.id = p_log;
$$;
create function pg_temp.owned(p_client uuid, p_ws uuid) returns bigint language sql as $$
  select coalesce(sum(count), 0) from public.sticker_awards where client_id = p_client and workspace_id = p_ws;
$$;

-- The same animal comes back: only its multiple follows the corrected volume.
select is(public.apply_award(:'lb', pg_temp.recompute(:'lb',
    '{"key": "goat", "multiple": 5.5, "isNew": false, "count": 3, "shiny": true}', 99)) #> '{result,ladder}',
  '{"key": "goat", "multiple": 5.5, "isNew": true, "count": 1, "shiny": false}'::jsonb,
  'a kept animal keeps its card and takes the new multiple');
select results_eq(format($q$select sticker_key, count, shiny from public.sticker_awards where client_id = %L and workspace_id = %L order by 1$q$, :'c1', :'ws'),
  $q$values ('cat', 1, false), ('goat', 2, false), ('koala', 1, true)$q$, 'and the stickers are untouched');

-- A different animal from a stale sticker count is refused.
select is(public.apply_award(:'lb', pg_temp.recompute(:'lb', '{"key": "rabbit", "multiple": 20}', 99)) ->> 'status',
  'conflict', 'a swap worked out from an old sticker count is refused');
select is((select result #>> '{ladder,key}' from public.awards where log_id = :'lb'), 'goat', 'and changes nothing');

-- Swap to a new animal: the old one loses one (goat 2 -> 1), the new one is added, not shiny.
select is(public.apply_award(:'lb', pg_temp.recompute(:'lb', '{"key": "rabbit", "multiple": 20, "shiny": true}',
    pg_temp.owned(:'c1', :'ws'))) -> 'result',
  '{"ladder": {"key": "rabbit", "multiple": 20, "isNew": true, "count": 1, "shiny": false}, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": []}'::jsonb,
  'a swap stores the re-picked animal as new, with no roll');
select results_eq(format($q$select sticker_key, count, shiny, first_log_id from public.sticker_awards where client_id = %L and workspace_id = %L order by 1$q$, :'c1', :'ws'),
  format($q$values ('cat', 1, false, %1$L::uuid), ('goat', 1, false, %2$L::uuid), ('koala', 1, true, %1$L::uuid), ('rabbit', 1, false, %2$L::uuid)$q$, :'la', :'lb'),
  'the old animal loses one, the new one is added');

-- Swap to an animal already owned (shiny): its count goes up and the card shows it shiny. Rabbit at 1 stays.
select is(public.apply_award(:'lb', pg_temp.recompute(:'lb', '{"key": "koala", "multiple": 4.4}',
    pg_temp.owned(:'c1', :'ws'))) #> '{result,ladder}',
  '{"key": "koala", "multiple": 4.4, "isNew": false, "count": 2, "shiny": true}'::jsonb,
  'a swap to an owned animal counts it again');
select is((select count from public.sticker_awards where client_id = :'c1' and workspace_id = :'ws' and sticker_key = 'rabbit'),
  1, 'a sticker is never taken away: the last one stays');

-- Swap to nothing (the volume fell below a rabbit): no animal on the card, the zoo book keeps koala x1.
select is(public.apply_award(:'lb', pg_temp.recompute(:'lb', 'null', pg_temp.owned(:'c1', :'ws'))) #> '{result,ladder}',
  'null'::jsonb, 'a volume below every animal leaves the card without one');
select is((select count from public.sticker_awards where client_id = :'c1' and workspace_id = :'ws' and sticker_key = 'koala'),
  1, 'and the old animal loses one');
select is((select result -> 'drop' from public.awards where log_id = :'lb'), 'null'::jsonb,
  'a recompute never rolls a drop');

-- From no animal to one (a log corrected up from nothing): the animal is added.
select is(public.apply_award(:'lc', pg_temp.recompute(:'lc', '{"key": "corgi", "multiple": 1.5}',
    pg_temp.owned(:'c1', :'ws'))) #>> '{result,ladder,key}', 'corgi', 'a log corrected up earns an animal');
select is((select count from public.sticker_awards where client_id = :'c1' and workspace_id = :'ws' and sticker_key = 'corgi'),
  1, 'added to the zoo book');

-- The other workspace and the other client are untouched.
select is((select count(*)::int from public.sticker_awards where client_id = :'c1' and workspace_id = :'ws_b'), 0,
  'the other workspace''s zoo book is untouched');
select is((select result #>> '{ladder,key}' from public.awards where log_id = :'l_other_client'), 'pig',
  'another client''s award is untouched');

select * from finish();
rollback;
