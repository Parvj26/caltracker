begin;
select plan(157);

-- Community (docs/superpowers/specs/2026-11-06-community-design.md): workspace isolation, removed members, client vs
-- coach powers, blocks, reports, notifications, cards, photos and Realtime.

select tests.create_user('cm-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('cm-a1@t.local', 'Ann One') as a1 \gset
select tests.create_user('cm-a2@t.local', 'Ben Two') as a2 \gset
select tests.create_user('cm-a3@t.local', 'Cat Three') as a3 \gset
select tests.create_user('cm-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('cm-b1@t.local', 'Dee Bee') as b1 \gset
select tests.create_workspace('CM Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('CM Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_a', :'a3');
select tests.add_client(:'ws_b', :'b1');
select id as comm_a from public.communities where workspace_id = :'ws_a' \gset
select id as comm_b from public.communities where workspace_id = :'ws_b' \gset
select tests.create_log(:'ws_a', :'a1') as log_a1 \gset
select tests.create_log(:'ws_a', :'a2') as log_a2 \gset
select tests.create_log(:'ws_a', :'a1', null, 'in_progress') as log_a1_open \gset
select tests.create_log(:'ws_a', :'a1') as log_a1_plain \gset
-- A finished log of A1's kept from an earlier coach (another workspace).
select tests.create_log(:'ws_b', :'a1') as log_a1_other_ws \gset
insert into public.sticker_awards (client_id, workspace_id, sticker_key) values (:'a1', :'ws_a', 'cat');
select le.exercise_id as ex_a1, e.name as ex_a1_name
from public.log_exercises le join public.log_blocks b on b.id = le.block_id join public.exercises e on e.id = le.exercise_id
where b.log_id = :'log_a1' \gset
-- What the award function stored for A1's workout (written with the service role): a cat at 2.5x and one PR.
insert into public.awards (log_id, client_id, workspace_id, result, log_revision) values (:'log_a1', :'a1', :'ws_a',
  jsonb_build_object('ladder', jsonb_build_object('key', 'cat', 'multiple', 2.5, 'isNew', true, 'count', 1, 'shiny', false),
    'drop', null, 'rare', '[]'::jsonb, 'landmarks', '[]'::jsonb, 'milestone', null,
    'prs', jsonb_build_array(jsonb_build_object('exerciseId', :'ex_a1', 'kind', 'heaviest', 'valueKg', 60, 'reps', null,
      'logId', :'log_a1', 'achievedAt', now()))), 1);

select gen_random_uuid() as p1 \gset
select gen_random_uuid() as p2 \gset
select gen_random_uuid() as p3 \gset
select gen_random_uuid() as p4 \gset
select gen_random_uuid() as p_coach \gset
select gen_random_uuid() as img1 \gset
select gen_random_uuid() as img2 \gset

-- ---------------------------------------------------------------------------------------------------------------
-- Setup, privileges, RLS
-- ---------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.communities where workspace_id = :'ws_a' and is_default), 1,
  'a new workspace gets one default community');
select is((select count(*)::int from public.community_members where community_id = :'comm_a'), 4,
  'the coach and all three clients are members');
select is((select role from public.community_members where community_id = :'comm_a' and user_id = :'coach_a'), 'coach',
  'the owner joins as coach');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.communities'::regclass, 'public.community_members'::regclass, 'public.community_posts'::regclass,
  'public.community_post_images'::regclass, 'public.community_comments'::regclass, 'public.community_likes'::regclass,
  'public.community_blocks'::regclass, 'public.community_reports'::regclass, 'public.community_notifications'::regclass)),
  'every community table has RLS on');
select ok(not has_table_privilege('anon', 'public.community_posts', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'public.community_comments', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'public.community_reports', 'select'), 'anon has no access');
select ok(not has_function_privilege('anon', 'public.create_community_post(uuid, uuid, text, jsonb, jsonb)', 'execute'),
  'anon cannot post');
select ok(not has_table_privilege('authenticated', 'public.community_posts', 'insert,update'),
  'posts are created only through create_community_post and never edited');
select ok(not has_table_privilege('authenticated', 'public.community_reports', 'insert,update,delete'),
  'reports are written only through the functions');
select ok(not has_table_privilege('authenticated', 'public.community_notifications', 'insert,delete'),
  'notifications are written only by triggers');
select ok(not has_column_privilege('authenticated', 'public.community_comments', 'author_id', 'insert'),
  'a comment''s author is always the caller');

-- ---------------------------------------------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'a1');
select is(public.create_community_post(:'p1', :'comm_a', '  Hello team  '), :'p1'::uuid, 'a client posts');
select is(public.create_community_post(:'p1', :'comm_a', 'Hello team'), :'p1'::uuid, 'a retry returns the same post');
select is((select count(*)::int from public.community_posts where id = :'p1'), 1, '... without posting twice');
select is((select body from public.community_posts where id = :'p1'), 'Hello team', 'the text is trimmed');
select throws_ok(format($$select public.create_community_post(%L, %L, '   ')$$, gen_random_uuid(), :'comm_a'), '23514', null,
  'an empty post is refused');
select lives_ok(format($$select public.create_community_post(%L, %L, 'Photos', null, %L::jsonb)$$, :'p2', :'comm_a',
  jsonb_build_array(
    jsonb_build_object('path', format('%s/%s/%s/%s.webp', :'ws_a', :'a1', :'p2', :'img1'),
      'thumbPath', format('%s/%s/%s/%s-thumb.webp', :'ws_a', :'a1', :'p2', :'img1'), 'width', 1600, 'height', 1200),
    jsonb_build_object('path', format('%s/%s/%s/%s.jpg', :'ws_a', :'a1', :'p2', :'img2'),
      'thumbPath', format('%s/%s/%s/%s-thumb.jpg', :'ws_a', :'a1', :'p2', :'img2'), 'width', 900, 'height', 1600))),
  'a client posts two photos');
select results_eq(format($$select position::int, width from public.community_post_images where post_id = %L order by position$$, :'p2'),
  $$values (0, 1600), (1, 900)$$, 'the photos are stored in order');
select throws_ok(format($$select public.create_community_post(%L, %L, 'x', null, %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_array(jsonb_build_object('path', format('%s/%s/%s/%s.webp', :'ws_a', :'a2', gen_random_uuid(), :'img1'),
    'thumbPath', format('%s/%s/%s/%s-thumb.webp', :'ws_a', :'a2', gen_random_uuid(), :'img1'), 'width', 10, 'height', 10))),
  '23514', null, 'photos must be in the caller''s own folder for that post');
select throws_ok(format($$select public.create_community_post(%L, %L, 'x', null, %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  (select jsonb_agg(jsonb_build_object('path', 'p', 'thumbPath', 't', 'width', 1, 'height', 1)) from generate_series(1, 5))),
  '23514', null, 'at most 4 photos');
select throws_ok(format($$select public.create_community_post(%L, %L, 'x', null, %L::jsonb)$$, :'p3', :'comm_a',
  jsonb_build_array(jsonb_build_object('path', format('%s/%s/%s/%s.webp', :'ws_a', :'a1', :'p3', :'img1'),
    'thumbPath', format('%s/%s/%s/%s-thumb.webp', :'ws_a', :'a1', :'p3', :'img1'), 'width', 3000, 'height', 10))),
  '23514', null, 'a photo larger than 1600 px is refused');

-- Cards: the app sends only what to share; the database builds what is shown from its own records.
select lives_ok(format($$select public.create_community_post(%L, %L, '', '{"kind":"sticker","stickerKey":"cat"}')$$,
  :'p3', :'comm_a'), 'a client shares a sticker they own');
select is((select card from public.community_posts where id = :'p3'),
  '{"kind":"sticker","stickerKey":"cat","shiny":false,"count":1}'::jsonb, 'the sticker card comes from the zoo book');
select throws_ok(format($$select public.create_community_post(%L, %L, '', '{"kind":"sticker","stickerKey":"okapi"}')$$,
  gen_random_uuid(), :'comm_a'), '42501', null, 'a sticker they do not own is refused');
select throws_ok(format($$select public.create_community_post(%L, %L, '', '{"kind":"sticker","stickerKey":"cat","shiny":true}')$$,
  gen_random_uuid(), :'comm_a'), '22023', null, 'a card that claims shiny is refused (unknown key)');
select ok(public.create_community_post(gen_random_uuid(), :'comm_a', '', jsonb_build_object('kind', 'workout', 'logId', :'log_a1')) is not null,
  'a client shares their finished workout');
select results_eq(format($$select card - 'finishedAt' from public.community_posts where card ->> 'kind' = 'workout' and card ->> 'logId' = %L$$, :'log_a1'),
  format($$values (jsonb_build_object('kind', 'workout', 'logId', %L::text, 'workoutName', 'Logged workout', 'exerciseCount', 1,
    'setCount', 1, 'stickerKey', 'cat', 'multiple', 2.5, 'shiny', false, 'volumeKg', null))$$, :'log_a1'),
  'the workout card is built from the log and its award');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_a1', 'volumeKg', 999999)), '22023', null, 'a forged volume is refused');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_a1', 'stickerKey', 'okapi', 'shiny', true)), '22023', null,
  'a workout card carrying a sticker is refused');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_a1', 'workoutName', 'Marathon')), '22023', null, 'a forged workout name is refused');
select lives_ok(format($$select public.create_community_post(%L, %L, 'PR!', %L::jsonb)$$, :'p4', :'comm_a',
  jsonb_build_object('kind', 'pr', 'logId', :'log_a1')), 'a client shares the PRs of their own finished workout');
select results_eq(format($$select card -> 'prs' from public.community_posts where id = %L$$, :'p4'),
  format($$values (jsonb_build_array(jsonb_build_object('exerciseName', %L::text, 'prKind', 'heaviest', 'valueKg', 60, 'reps', null)))$$, :'ex_a1_name'),
  'the PRs come from the stored award');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'pr', 'logId', :'log_a1', 'prs', jsonb_build_array(jsonb_build_object('exerciseName', 'Squat', 'prKind', 'heaviest', 'valueKg', 500, 'reps', null)))),
  '22023', null, 'forged PRs are refused');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'pr', 'logId', :'log_a1_plain')), '22023', null, 'a PR card needs a workout that set PRs');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_a2')), '42501', null, 'another client''s workout is refused');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_a1_open')), '42501', null, 'an unfinished workout is refused');
select throws_ok(format($$select public.create_community_post(%L, %L, '', '{"kind":"inbody"}')$$, gen_random_uuid(), :'comm_a'),
  '22023', null, 'an unknown card is refused');
select throws_ok(format($$select public.create_community_post(%L, %L, '', %L::jsonb)$$, gen_random_uuid(), :'comm_a',
  jsonb_build_object('kind', 'workout', 'logId', :'log_a1_other_ws')), '42501', null,
  'a workout of their own from another workspace is refused');
select ok(not has_function_privilege('authenticated', 'public.build_community_card(uuid, uuid, jsonb)', 'execute'),
  'the card builder cannot be called directly');
select throws_ok(format($$insert into public.community_post_images (post_id, workspace_id, position, path, thumb_path, width, height)
  values (%L, %L, 3, 'x', 'y', 1, 1)$$, :'p2', :'ws_a'), '42501', null, 'photos cannot be added to a post directly');
reset role;

select tests.act_as(:'a2');
select throws_ok(format($$select public.create_community_post(%L, %L, 'mine now')$$, :'p1', :'comm_a'), '42501', null,
  'reusing another member''s post id is refused');
reset role;

-- The coach posts: every client hears about it.
select tests.act_as(:'coach_a');
select lives_ok(format($$select public.create_community_post(%L, %L, 'Welcome everyone')$$, :'p_coach', :'comm_a'),
  'the coach posts');
reset role;
select is((select count(*)::int from public.community_notifications where post_id = :'p_coach' and kind = 'coach_post'), 3,
  'each client gets a new coach post notification');
select is((select count(*)::int from public.community_notifications where kind = 'coach_post' and post_id = :'p1'), 0,
  'a client''s post does not notify everyone');

-- ---------------------------------------------------------------------------------------------------------------
-- Other workspaces see nothing and can do nothing
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.communities where workspace_id = :'ws_a'), 0, 'coach B cannot see A''s community');
select is((select count(*)::int from public.community_posts where workspace_id = :'ws_a'), 0, 'coach B cannot see A''s posts');
select is((select count(*)::int from public.community_post_images where workspace_id = :'ws_a'), 0, 'coach B cannot see A''s photos');
select is((select count(*)::int from public.community_members where community_id = :'comm_a'), 0, 'coach B cannot see A''s members');
select throws_ok(format($$select public.set_community_post_pinned(%L, true)$$, :'p1'), '42501', null, 'coach B cannot pin A''s post');
select throws_ok(format($$select public.remove_community_member(%L, %L)$$, :'comm_a', :'a1'), '42501', null,
  'coach B cannot remove A''s member');
with d as (delete from public.community_posts where id = :'p1' returning 1)
select is((select count(*)::int from d), 0, 'coach B cannot delete A''s post');
reset role;

select tests.act_as(:'b1');
select is((select count(*)::int from public.community_posts), 0, 'B1 sees no posts from workspace A');
select is((select count(*)::int from public.community_notifications), 0, 'B1 has no notifications from workspace A');
select throws_ok(format($$select public.create_community_post(%L, %L, 'hi')$$, gen_random_uuid(), :'comm_a'), '42501', null,
  'B1 cannot post into A''s community');
select throws_ok(format($$insert into public.community_comments (post_id, body) values (%L, 'hi')$$, :'p1'), '42501', null,
  'B1 cannot comment on A''s post');
select throws_ok(format($$insert into public.community_likes (post_id) values (%L)$$, :'p1'), '42501', null,
  'B1 cannot like A''s post');
select throws_ok(format($$select public.report_community_content('spam', %L)$$, :'p1'), '42501', null,
  'B1 cannot report A''s post');
select throws_ok(format($$insert into public.community_blocks (workspace_id, blocked_id) values (%L, %L)$$, :'ws_a', :'a1'),
  '42501', null, 'B1 cannot block in workspace A');
select ok(public.create_community_post(gen_random_uuid(), :'comm_b', 'Hi B') is not null, 'B1 posts in their own community');
reset role;

select tests.act_as(:'a1');
select is((select count(*)::int from public.community_posts where workspace_id = :'ws_b'), 0, 'A1 cannot see B''s posts');
reset role;

-- ---------------------------------------------------------------------------------------------------------------
-- Comments, likes, and what a client may not do
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'a2');
select is((select count(*)::int from public.community_posts where workspace_id = :'ws_a'), 6,
  'A2 sees every post in the community');
select lives_ok(format($$insert into public.community_comments (post_id, body) values (%L, '  Nice one  ')$$, :'p1'),
  'A2 comments on A1''s post');
select is((select author_id from public.community_comments where post_id = :'p1'), :'a2'::uuid, 'the comment is A2''s');
select is((select workspace_id from public.community_comments where post_id = :'p1'), :'ws_a'::uuid,
  'the workspace comes from the post');
select lives_ok(format($$insert into public.community_likes (post_id) values (%L)$$, :'p1'), 'A2 likes A1''s post');
select throws_ok(format($$insert into public.community_likes (post_id) values (%L)$$, :'p1'), '23505', null,
  'one like per person');
with d as (delete from public.community_posts where id = :'p1' returning 1)
select is((select count(*)::int from d), 0, 'A2 cannot delete A1''s post');
select throws_ok(format($$select public.set_community_post_pinned(%L, true)$$, :'p1'), '42501', null, 'a client cannot pin');
select throws_ok(format($$select public.remove_community_member(%L, %L)$$, :'comm_a', :'a3'), '42501', null,
  'a client cannot remove a member');
select throws_ok(format($$select public.restore_community_member(%L, %L)$$, :'comm_a', :'a3'), '42501', null,
  'a client cannot add a member back');
select is((select count(*)::int from public.community_reports), 0, 'a client cannot read reports');
reset role;

select tests.act_as(:'a3');
select lives_ok(format($$insert into public.community_likes (post_id) values (%L)$$, :'p1'), 'A3 likes A1''s post');
with d as (delete from public.community_comments where post_id = :'p1' returning 1)
select is((select count(*)::int from d), 0, 'A3 cannot delete A2''s comment');
with d as (delete from public.community_likes where post_id = :'p1' and user_id = :'a2' returning 1)
select is((select count(*)::int from d), 0, 'A3 cannot remove A2''s like');
reset role;

select tests.act_as(:'a1');
select is((select count(*)::int from public.community_notifications where kind = 'like' and post_id = :'p1'), 2,
  'A1 is told about both likes');
select is((select count(*)::int from public.community_notifications where kind = 'comment' and post_id = :'p1'), 1,
  'A1 is told about the comment');
select is((select count(*)::int from public.community_notifications where kind = 'coach_post'), 1,
  'A1 is told about the coach''s post');
reset role;

select tests.act_as(:'a3');
delete from public.community_likes where post_id = :'p1';
select is((select count(*)::int from public.community_likes where post_id = :'p1'), 1, 'A3 takes back their like');
reset role;
select is((select count(*)::int from public.community_notifications where kind = 'like' and post_id = :'p1'), 1,
  'the like notification goes with it');

select tests.act_as(:'a2');
select is((select count(*)::int from public.community_notifications where recipient_id = :'a1'), 0,
  'A2 cannot read A1''s notifications');
with u as (update public.community_notifications set read_at = now() where recipient_id = :'a1' returning 1)
select is((select count(*)::int from u), 0, 'A2 cannot mark A1''s notifications read');
reset role;

select tests.act_as(:'a1');
select public.mark_community_notifications_read();
select is((select count(*)::int from public.community_notifications where read_at is null), 0, 'A1 marks everything read');
-- A1 deletes their own content.
select lives_ok(format($$delete from public.community_posts where id = %L$$, :'p4'), 'A1 deletes their own post');
reset role;
select is((select count(*)::int from public.community_posts where id = :'p4'), 0, '... and it is gone');

-- The coach pins and moderates.
select tests.act_as(:'coach_a');
select lives_ok(format($$select public.set_community_post_pinned(%L, true)$$, :'p_coach'), 'the coach pins a post');
select ok((select pinned_at is not null from public.community_posts where id = :'p_coach'), 'the post is pinned');
select lives_ok(format($$select public.set_community_post_pinned(%L, false)$$, :'p_coach'), 'the coach unpins it');
select ok((select pinned_at is null from public.community_posts where id = :'p_coach'), 'the post is no longer pinned');
with d as (delete from public.community_comments where post_id = :'p1' returning 1)
select is((select count(*)::int from d), 1, 'the coach deletes a client''s comment');
reset role;
select is((select count(*)::int from public.community_notifications where kind = 'comment' and post_id = :'p1'), 0,
  'the comment''s notification goes with it');

-- ---------------------------------------------------------------------------------------------------------------
-- Blocking
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'a1');
select lives_ok(format($$insert into public.community_comments (post_id, body) values (%L, 'Thanks coach')$$, :'p_coach'),
  'A1 comments on the coach''s post');
reset role;

select tests.act_as(:'coach_a');
select throws_ok(format($$insert into public.community_blocks (workspace_id, blocked_id) values (%L, %L)$$, :'ws_a', :'a1'),
  '42501', null, 'the coach cannot block (they moderate instead)');
reset role;

select tests.act_as(:'a2');
select throws_ok(format($$insert into public.community_blocks (workspace_id, blocked_id) values (%L, %L)$$, :'ws_a', :'coach_a'),
  '42501', null, 'the coach cannot be blocked');
select throws_ok(format($$insert into public.community_blocks (workspace_id, blocked_id) values (%L, %L)$$, :'ws_a', :'b1'),
  '42501', null, 'someone outside the workspace cannot be blocked');
select lives_ok(format($$insert into public.community_blocks (workspace_id, blocked_id) values (%L, %L)$$, :'ws_a', :'a1'),
  'A2 blocks A1');
select is((select count(*)::int from public.community_posts where author_id = :'a1'), 0, 'A2 no longer sees A1''s posts');
select is((select count(*)::int from public.community_post_images where post_id = :'p2'), 0, '... or their photos');
select is((select count(*)::int from public.community_comments where author_id = :'a1'), 0, '... or their comments');
select is((select count(*)::int from public.community_posts where id = :'p_coach'), 1, '... but still sees the coach''s post');
select throws_ok(format($$insert into public.community_comments (post_id, body) values (%L, 'hey')$$, :'p1'), '42501', null,
  'A2 cannot comment on a post they blocked');
reset role;

select tests.act_as(:'a3');
select is((select count(*)::int from public.community_posts where author_id = :'a1'), 4, 'A3 still sees A1''s posts');
select is((select count(*)::int from public.community_blocks), 0, 'A3 cannot see A2''s blocks');
reset role;

select tests.act_as(:'a1');
select is((select count(*)::int from public.community_blocks), 0, 'A1 cannot tell they were blocked');
select is((select count(*)::int from public.community_posts where author_id = :'a1'), 4, 'A1 still sees their own posts');
reset role;

select tests.act_as(:'a2');
delete from public.community_blocks where blocked_id = :'a1';
select is((select count(*)::int from public.community_posts where author_id = :'a1'), 4, 'after unblocking, A2 sees A1 again');
reset role;

-- ---------------------------------------------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'a2');
select public.report_community_content('spam', :'p1', null, 'Selling stuff') as report1 \gset
select is(public.report_community_content('harassment', :'p1'), :'report1'::uuid, 'a repeat report returns the first');
select is((select count(*)::int from public.community_reports), 0, 'the reporter cannot read reports back');
select throws_ok(format($$select public.resolve_community_report(%L, 'removed')$$, :'report1'), '42501', null,
  'a client cannot handle reports');
select throws_ok($$select public.report_community_content('spam')$$, '22023', null,
  'a report names a post or a comment');
select throws_ok(format($$select public.report_community_content('rude', %L)$$, :'p2'), '23514', null,
  'the reason must be one of the list');
reset role;

select tests.act_as(:'a1');
select throws_ok(format($$select public.report_community_content('spam', %L)$$, :'p1'), '22023', null,
  'a member cannot report their own post');
select is((select count(*)::int from public.community_reports), 0, 'the reported member cannot read reports');
select id as a1_comment from public.community_comments where post_id = :'p_coach' and author_id = :'a1' \gset
reset role;

select tests.act_as(:'a3');
select ok(public.report_community_content('inappropriate', null, :'a1_comment') is not null, 'A3 reports A1''s comment');
reset role;

select tests.act_as(:'coach_b');
select is((select count(*)::int from public.community_reports), 0, 'coach B cannot see A''s reports');
select throws_ok(format($$select public.resolve_community_report(%L, 'removed')$$, :'report1'), '42501', null,
  'coach B cannot handle A''s reports');
reset role;

select tests.act_as(:'coach_a');
select is((select count(*)::int from public.community_reports where resolved_at is null), 2, 'the coach sees both reports');
select results_eq(format($$select target_body, note, target_author_id from public.community_reports where id = %L$$, :'report1'),
  format($$values ('Hello team'::text, 'Selling stuff'::text, %L::uuid)$$, :'a1'), 'the report keeps the text and who wrote it');
select is((select count(*)::int from public.community_notifications where kind = 'report'), 2, 'the coach is told about each report');
select lives_ok(format($$select public.resolve_community_report(%L, 'removed')$$, :'report1'), 'the coach removes the post');
select is((select count(*)::int from public.community_posts where id = :'p1'), 0, 'the reported post is deleted');
select ok((select resolution = 'removed' and resolved_by = :'coach_a'::uuid from public.community_reports where id = :'report1'),
  'the report is closed as removed');
reset role;

-- ---------------------------------------------------------------------------------------------------------------
-- Photos in storage
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'a1');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('community-images', %L, %L)$$,
  format('%s/%s/%s/%s.webp', :'ws_a', :'a1', :'p2', :'img1'), :'a1'), 'A1 uploads into their own folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('community-images', %L)$$,
  format('%s/%s/%s/%s.webp', :'ws_a', :'a2', :'p2', :'img1')), '42501', null, 'A1 cannot upload into A2''s folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('community-images', %L)$$,
  format('%s/%s/%s/%s.png', :'ws_a', :'a1', :'p2', :'img2')), '42501', null, 'only WebP and JPEG files can be uploaded');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('community-images', %L, %L)$$,
  format('%s/%s/%s/%s.jpeg', :'ws_a', :'a1', :'p2', gen_random_uuid()), :'a1'), '.jpeg is accepted');
reset role;
select tests.act_as(:'a2');
select is((select count(*)::int from storage.objects where bucket_id = 'community-images' and name like '%.webp'), 1,
  'A2 can open a photo of a post they see');
insert into public.community_blocks (workspace_id, blocked_id) values (:'ws_a', :'a1');
select is((select count(*)::int from storage.objects where bucket_id = 'community-images'), 0,
  'after blocking A1, A2 cannot open A1''s photos');
delete from public.community_blocks where blocked_id = :'a1';
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from storage.objects where bucket_id = 'community-images'), 0, 'coach B cannot open A''s photos');
reset role;
select tests.act_as(:'b1');
select is((select count(*)::int from storage.objects where bucket_id = 'community-images'), 0, 'B1 cannot open A''s photos');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('community-images', %L)$$,
  format('%s/%s/%s/%s.webp', :'ws_a', :'b1', :'p2', :'img1')), '42501', null, 'B1 cannot upload into workspace A');
reset role;
select is((select public from storage.buckets where id = 'community-images'), false, 'the photo bucket is private');

-- ---------------------------------------------------------------------------------------------------------------
-- Removed from the community, removed from the business
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'coach_a');
select throws_ok(format($$select public.remove_community_member(%L, %L)$$, :'comm_a', :'coach_a'), 'P0002', null,
  'the coach cannot be removed');
select lives_ok(format($$select public.remove_community_member(%L, %L)$$, :'comm_a', :'a3'), 'the coach removes A3');
reset role;

select tests.act_as(:'a3');
select is((select count(*)::int from public.communities), 0, 'A3 no longer sees the community');
select is((select count(*)::int from public.community_posts), 0, 'A3 no longer sees posts');
select is((select count(*)::int from public.community_notifications), 0, 'A3 no longer sees notifications');
select throws_ok(format($$select public.create_community_post(%L, %L, 'still here?')$$, gen_random_uuid(), :'comm_a'),
  '42501', null, 'A3 cannot post');
select throws_ok(format($$insert into public.community_likes (post_id) values (%L)$$, :'p_coach'), '42501', null,
  'A3 cannot like');
select is((select count(*)::int from storage.objects where bucket_id = 'community-images'), 0, 'A3 cannot open photos');
select throws_ok(format($$insert into public.community_comments (post_id, body) values (%L, 'hi')$$, :'p_coach'), '42501', null,
  'A3 cannot comment');
select throws_ok(format($$select public.report_community_content('spam', %L)$$, :'p_coach'), '42501', null, 'A3 cannot report');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('community-images', %L)$$,
  format('%s/%s/%s/%s.webp', :'ws_a', :'a3', gen_random_uuid(), gen_random_uuid())), '42501', null, 'A3 cannot upload photos');
reset role;

select tests.act_as(:'a2');
select is((select count(*)::int from public.community_members where user_id = :'a3'), 0,
  'members do not see who was removed');
reset role;
select tests.act_as(:'coach_a');
select ok((select removed_at is not null from public.community_members where community_id = :'comm_a' and user_id = :'a3'),
  'the coach sees A3 as removed');
select lives_ok(format($$select public.restore_community_member(%L, %L)$$, :'comm_a', :'a3'), 'the coach adds A3 back');
reset role;
select tests.act_as(:'a3');
select is((select count(*)::int from public.community_posts where id = :'p_coach'), 1, 'A3 sees the community again');
reset role;

-- Removing a client from the business ends community access too.
select tests.act_as(:'coach_a');
select public.remove_client(:'ws_a', :'a2');
reset role;
select is((select count(*)::int from public.community_members where user_id = :'a2'), 0,
  'leaving the business removes the community membership');
select tests.act_as(:'a2');
select is((select count(*)::int from public.community_posts), 0, 'a removed client sees no posts');
select throws_ok(format($$select public.create_community_post(%L, %L, 'hi')$$, gen_random_uuid(), :'comm_a'), '42501', null,
  'a removed client cannot post');
reset role;

-- ---------------------------------------------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename in ('communities', 'community_posts', 'community_comments', 'community_likes', 'community_notifications', 'community_reports')),
  6, 'the community, posts, comments, likes, notifications and reports are published to Realtime');

-- Deletes are announced as an UPDATE of the community's activity_at (filterable by id and checked by RLS), so feeds
-- never have to listen to unfilterable DELETE events.
update public.communities set activity_at = '2000-01-01' where id = :'comm_a';
select tests.act_as(:'a3');
select lives_ok(format($$insert into public.community_likes (post_id) values (%L)$$, :'p_coach'), 'A3 likes the coach''s post');
reset role;
update public.communities set activity_at = '2000-01-01' where id = :'comm_a';
select tests.act_as(:'a3');
delete from public.community_likes where post_id = :'p_coach';
reset role;
select ok((select activity_at > '2000-01-01' from public.communities where id = :'comm_a'), 'an unlike bumps activity_at');
update public.communities set activity_at = '2000-01-01' where id = :'comm_a';
select tests.act_as(:'coach_a');
delete from public.community_comments where post_id = :'p_coach';
reset role;
select ok((select activity_at > '2000-01-01' from public.communities where id = :'comm_a'), 'a deleted comment bumps activity_at');
-- A deleted post bumps once, not once more for each of its comments and likes.
create table tests.cm_bumps (n int);
grant all on tests.cm_bumps to authenticated;
create function tests.cm_count_bump() returns trigger language plpgsql as $$
begin
  if new.activity_at is distinct from old.activity_at then insert into tests.cm_bumps values (1); end if;
  return new;
end $$;
create trigger cm_count_bump after update on public.communities for each row execute function tests.cm_count_bump();
select tests.act_as(:'a3');
insert into public.community_comments (post_id, body) values (:'p_coach', 'one');
insert into public.community_comments (post_id, body) values (:'p_coach', 'two');
insert into public.community_likes (post_id) values (:'p_coach');
reset role;
update public.communities set activity_at = '2000-01-01' where id = :'comm_a';
delete from tests.cm_bumps;
select tests.act_as(:'coach_a');
delete from public.community_posts where id = :'p_coach';
reset role;
select ok((select activity_at > '2000-01-01' from public.communities where id = :'comm_a'), 'a deleted post bumps activity_at');
select is((select count(*)::int from tests.cm_bumps), 1, 'a post with comments and likes bumps it once');
drop trigger cm_count_bump on public.communities;
select ok(not has_column_privilege('authenticated', 'public.communities', 'activity_at', 'update'),
  'only the database sets activity_at');
select lives_ok(format($$delete from public.workspaces where id = %L$$, :'ws_b'), 'deleting a workspace removes its community cleanly');
select is((select relreplident::text from pg_class where oid = 'public.community_likes'::regclass), 'd',
  'likes keep the default replica identity (a DELETE carries only the uuid key)');

select * from finish();
rollback;
