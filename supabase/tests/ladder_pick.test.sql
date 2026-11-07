begin;
select plan(23);

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

-- Payloads as award-workout sends them.
create function pg_temp.payload(p_mode text, p_log uuid, p_ladder jsonb, p_stickers jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('mode', p_mode,
    'owned_total', (select coalesce(sum(s.count), 0) from public.sticker_awards s
      where s.client_id = l.client_id and s.workspace_id = l.workspace_id),
    'history_version', public.award_history_version(l.client_id, l.workspace_id),
    'award', jsonb_build_object('ladder', p_ladder, 'drop', 'kakapo', 'rare', '[]'::jsonb, 'landmarks', '[]'::jsonb,
      'milestone', null, 'prs', '[]'::jsonb),
    'stickers', p_stickers, 'records', '[]'::jsonb,
    'stats', jsonb_build_object('workouts', 4, 'streak', 1, 'best_streak', 1, 'journey_week', 1, 'pr_count', 0,
      'lifetime_volume_kg', 100))
  from public.workout_logs l where l.id = p_log;
$$;
create function pg_temp.recompute(p_log uuid, p_ladder jsonb) returns jsonb language sql as $$
  select pg_temp.payload('recompute', p_log, p_ladder, '[]'::jsonb);
$$;
create function pg_temp.stickers(p_client uuid) returns table (sticker_key text, count int, shiny boolean)
language sql as $$
  select s.sticker_key, s.count, s.shiny from public.sticker_awards s where s.client_id = p_client order by 1;
$$;

-- A workout keeps its animal forever: a recompute only refreshes the multiple, which may fall under 1.
select is(public.apply_award(:'lb', pg_temp.recompute(:'lb',
    '{"key": "goat", "multiple": 5.5, "isNew": false, "count": 3, "shiny": true}')) #> '{result,ladder}',
  '{"key": "goat", "multiple": 5.5, "isNew": true, "count": 1, "shiny": false}'::jsonb,
  'a kept animal keeps its card and takes the new multiple');
select is(public.apply_award(:'lb', pg_temp.recompute(:'lb', '{"key": "goat", "multiple": 0.4}')) #> '{result,ladder,multiple}',
  '0.4'::jsonb, 'a correction below the animal keeps it, with a multiple under 1');
select is(public.apply_award(:'lb', pg_temp.recompute(:'lb', '{"key": "rabbit", "multiple": 20}')) #> '{result,ladder}',
  '{"key": "goat", "multiple": 0.4, "isNew": true, "count": 1, "shiny": false}'::jsonb,
  'a different animal sent on a recompute is ignored');
select is(public.apply_award(:'lb', pg_temp.recompute(:'lb', 'null')) #>> '{result,ladder,key}', 'goat',
  'so is no animal');
select results_eq(format($q$select * from pg_temp.stickers(%L)$q$, :'c1'),
  $q$values ('cat', 1, false), ('goat', 2, false), ('koala', 1, true)$q$, 'and the stickers are untouched');
select is((select result -> 'drop' from public.awards where log_id = :'lb'), 'null'::jsonb,
  'a recompute never rolls a drop');

-- A log with no animal that is corrected up gets one, once.
select is(public.apply_award(:'lc', pg_temp.recompute(:'lc', '{"key": "corgi", "multiple": 1.5, "shiny": true}')) #> '{result,ladder}',
  '{"key": "corgi", "multiple": 1.5, "isNew": true, "count": 1, "shiny": false}'::jsonb,
  'a log corrected up from nothing earns an animal, with no roll');
select is(public.apply_award(:'lc', pg_temp.recompute(:'lc', '{"key": "rabbit", "multiple": 9}')) #>> '{result,ladder,key}',
  'corgi', 'and keeps it after that');
select is((select count from public.sticker_awards where client_id = :'c1' and workspace_id = :'ws' and sticker_key = 'corgi'),
  1, 'added to the zoo book once');

-- The database holds one animal per log and never lets it change.
select results_eq(format($q$select log_id, ladder_sticker_key from public.awards where log_id in (%L, %L, %L) order by 2$q$,
    :'la', :'lb', :'lc'),
  format($q$values (%L::uuid, 'cat'), (%L::uuid, 'corgi'), (%L::uuid, 'goat')$q$, :'la', :'lc', :'lb'),
  'awards record the one animal granted per log');
select throws_ok(format($q$update public.awards set result = jsonb_set(result, '{ladder,key}', '"hippo"') where log_id = %L$q$, :'lb'),
  '23514', null, 'a log''s animal cannot be changed');
select throws_ok(format($q$update public.awards set result = jsonb_set(result, '{ladder}', 'null') where log_id = %L$q$, :'lb'),
  '23514', null, 'or taken away');

-- The whole life of one workout: finish (and a retry), reopen and finish again, then a coach correction.
-- Exactly one ladder sticker in total.
select tests.create_user('lp-3@t.local', 'Client 3') as c3 \gset
select tests.add_client(:'ws', :'c3');
select tests.create_log(:'ws', :'c3') as le \gset
select is(public.apply_award(:'le', pg_temp.payload('award', :'le', '{"key": "rabbit", "multiple": 240, "isNew": true, "count": 1, "shiny": false}',
    '[{"key": "rabbit", "shiny": false}, {"key": "chichen-itza", "shiny": false}]')) ->> 'status', 'awarded', 'finish: awarded');
select is(public.apply_award(:'le', pg_temp.payload('award', :'le', '{"key": "rabbit", "multiple": 240}',
    '[{"key": "rabbit", "shiny": false}]')) ->> 'status', 'existing', 'the retry returns the same award');
update public.workout_logs set status = 'in_progress', finished_at = null where id = :'le';
update public.workout_logs set status = 'completed', finished_at = now(), revision = revision + 1 where id = :'le';
select is(public.apply_award(:'le', pg_temp.payload('award', :'le', '{"key": "cat", "multiple": 130}',
    '[{"key": "cat", "shiny": true}]')) #> '{result,ladder}',
  '{"key": "rabbit", "multiple": 240, "isNew": true, "count": 1, "shiny": false}'::jsonb,
  're-finished: the animal stays');
select is(public.apply_award(:'le', pg_temp.recompute(:'le', '{"key": "horse", "multiple": 1.1}')) #>> '{result,ladder,key}',
  'rabbit', 'corrected: the animal stays');
select results_eq(format($q$select * from pg_temp.stickers(%L)$q$, :'c3'),
  $q$values ('chichen-itza', 1, false), ('rabbit', 1, false)$q$,
  'one ladder sticker in total for the workout, whatever happened to it');

-- The other workspace and the other client are untouched.
select is((select count(*)::int from public.sticker_awards where client_id = :'c1' and workspace_id = :'ws_b'), 0,
  'the other workspace''s zoo book is untouched');
select is((select result #>> '{ladder,key}' from public.awards where log_id = :'l_other_client'), 'pig',
  'another client''s award is untouched');

select * from finish();
rollback;
