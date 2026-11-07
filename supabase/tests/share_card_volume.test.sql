begin;
select plan(23);

-- Shared workout cards carry the workout's volume (20261107003000): award-workout stores it in awards.result as
-- volumeKg (worked out with the shared logVolumeKg) and build_community_card copies it from there. The phone can't
-- send it, other people's workouts and other workspaces stay refused, and preview_community_card writes nothing.
select tests.create_user('scv-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('scv-a1@t.local', 'Vaishali Kapoor') as a1 \gset
select tests.create_user('scv-a2@t.local', 'Ben Two') as a2 \gset
select tests.create_user('scv-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('scv-b1@t.local', 'Dee Bee') as b1 \gset
select tests.create_workspace('SCV Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('SCV Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select id as comm_a from public.communities where workspace_id = :'ws_a' \gset
select id as comm_b from public.communities where workspace_id = :'ws_b' \gset
select tests.create_log(:'ws_a', :'a1') as log_new \gset
select tests.create_log(:'ws_a', :'a1') as log_old \gset
select tests.create_log(:'ws_a', :'a1') as log_odd \gset
select tests.create_log(:'ws_a', :'a2') as log_a2 \gset
select tests.create_log(:'ws_b', :'b1') as log_b1 \gset

-- What award-workout stored: a new award with its volume, one from before volumes were stored, and one whose volume
-- isn't a number (never copied).
insert into public.awards (log_id, client_id, workspace_id, result, log_revision) values
  (:'log_new', :'a1', :'ws_a', '{"ladder": {"key": "cow", "multiple": 1, "isNew": true, "count": 1, "shiny": false}, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": [], "volumeKg": 698.53}', 1),
  (:'log_old', :'a1', :'ws_a', '{"ladder": {"key": "cat", "multiple": 2.5, "isNew": true, "count": 1, "shiny": false}, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": []}', 1),
  (:'log_odd', :'a1', :'ws_a', '{"ladder": null, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": [], "volumeKg": "99999"}', 1),
  (:'log_a2', :'a2', :'ws_a', '{"ladder": null, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": [], "volumeKg": 50}', 1),
  (:'log_b1', :'b1', :'ws_b', '{"ladder": null, "drop": null, "rare": [], "landmarks": [], "milestone": null, "prs": [], "volumeKg": 50}', 1);

select ok(not has_function_privilege('anon', 'public.preview_community_card(uuid, jsonb)', 'execute'),
  'anon cannot preview cards');
select ok(not has_function_privilege('authenticated', 'public.build_community_card(uuid, uuid, jsonb)', 'execute'),
  'build_community_card stays private (it trusts its workspace and author)');

-- Posting.
select tests.act_as(:'a1');
select gen_random_uuid() as p_new \gset
select gen_random_uuid() as p_old \gset
select lives_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, :'p_new', :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_new')), 'a client shares a workout awarded with its volume');
select is((select card -> 'volumeKg' from public.community_posts where id = :'p_new'), '698.53'::jsonb,
  'the workout card copies volumeKg from the stored award');
select is((select card ->> 'stickerKey' from public.community_posts where id = :'p_new'), 'cow', '... with its animal');
select lives_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, :'p_old', :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_old')), 'and one awarded before volumes were stored');
select is((select card -> 'volumeKg' from public.community_posts where id = :'p_old'), 'null'::jsonb,
  'an award stored before volumes were has no volume on its card (the older look)');
select is(public.preview_community_card(:'comm_a', jsonb_build_object('kind', 'workout', 'logId', :'log_odd')) -> 'volumeKg',
  'null'::jsonb, 'a stored volume that is not a number is never copied');

select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_new', 'volumeKg', 999999)), '22023', null,
  'a forged volumeKg from the phone is refused');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_old', 'volumeKg', 1)), '22023', null,
  '... even for a workout whose award has none');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'pr', 'logId', :'log_new', 'volumeKg', 1)), '22023', null,
  'a PR card can''t carry a volume either');

-- Preview: the same card, built the same way, nothing written.
select is(public.preview_community_card(:'comm_a', jsonb_build_object('kind', 'workout', 'logId', :'log_new')) - 'finishedAt',
  (select card - 'finishedAt' from public.community_posts where id = :'p_new'),
  'the preview is the card a share would post');
select is((select count(*)::int from public.community_posts where author_id = :'a1'), 2, 'a preview posts nothing');
select throws_ok(format($$select public.preview_community_card(%L, %L::jsonb)$$, :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_new', 'volumeKg', 999999)), '22023', null,
  'a preview with a forged volume is refused');
select throws_ok(format($$select public.preview_community_card(%L, %L::jsonb)$$, :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_a2')), '42501', null,
  'cross-client: another client''s workout can''t be previewed');
select throws_ok(format($$select public.preview_community_card(%L, %L::jsonb)$$, :'comm_b',
  jsonb_build_object('kind', 'workout', 'logId', :'log_new')), '42501', null,
  'cross-workspace: another workspace''s community is refused');
select throws_ok(format($$select public.preview_community_card(%L, %L::jsonb)$$, :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_b1')), '42501', null,
  'cross-workspace: another workspace''s workout is refused');

select tests.act_as(:'b1');
select throws_ok(format($$select public.preview_community_card(%L, %L::jsonb)$$, :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_new')), '42501', null,
  'cross-workspace: a client of another coach can''t preview in this community');
select is((public.preview_community_card(:'comm_b', jsonb_build_object('kind', 'workout', 'logId', :'log_b1')) -> 'volumeKg'),
  '50'::jsonb, 'their own workout in their own community previews fine');

select tests.act_as(:'coach_a');
select throws_ok(format($$select public.preview_community_card(%L, %L::jsonb)$$, :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_new')), '42501', null,
  'the coach can''t preview a client''s workout as their own');

-- apply_award: a recompute refreshes the stored volume; a payload without one leaves it.
reset role;
create function pg_temp.recompute(p_log uuid, p_award_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('mode', 'recompute',
    'owned_total', (select coalesce(sum(s.count), 0) from public.sticker_awards s
      where s.client_id = l.client_id and s.workspace_id = l.workspace_id),
    'history_version', public.award_history_version(l.client_id, l.workspace_id),
    'award', jsonb_build_object('ladder', null, 'drop', null, 'rare', '[]'::jsonb, 'landmarks', '[]'::jsonb,
      'milestone', null, 'prs', '[]'::jsonb) || p_award_extra,
    'stickers', '[]'::jsonb, 'records', '[]'::jsonb,
    'stats', jsonb_build_object('workouts', 3, 'streak', 1, 'best_streak', 1, 'journey_week', 1, 'pr_count', 0,
      'lifetime_volume_kg', 100))
  from public.workout_logs l where l.id = p_log;
$$;
select is(public.apply_award(:'log_old', pg_temp.recompute(:'log_old', '{"volumeKg": 420.5}')) #> '{result,volumeKg}',
  '420.5'::jsonb, 'a recompute stores the corrected volume, even on an award stored before volumes were');
select is((select result -> 'volumeKg' from public.awards where log_id = :'log_old'), '420.5'::jsonb, '... in the awards row');
select is(public.apply_award(:'log_old', pg_temp.recompute(:'log_old', '{}')) #> '{result,volumeKg}',
  '420.5'::jsonb, 'a recompute without a volume leaves the stored one');

select * from finish();
rollback;
