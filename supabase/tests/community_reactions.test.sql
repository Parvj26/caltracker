begin;
select plan(80);

-- Community reactions (❤️ 💪 🔥 👏 😂 🎉, stored as keys) on posts and comments: they replace the single Like.
-- Workspace isolation, cross-client denial, blocks, removed members, notifications (collapsed per person and target)
-- and Realtime.

select tests.create_user('cr-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('cr-a1@t.local', 'Ann One') as a1 \gset
select tests.create_user('cr-a2@t.local', 'Ben Two') as a2 \gset
select tests.create_user('cr-a3@t.local', 'Cat Three') as a3 \gset
select tests.create_user('cr-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('cr-b1@t.local', 'Dee Bee') as b1 \gset
select tests.create_workspace('CR Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('CR Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_a', :'a3');
select tests.add_client(:'ws_b', :'b1');
select id as comm_a from public.communities where workspace_id = :'ws_a' \gset
select id as comm_b from public.communities where workspace_id = :'ws_b' \gset

select gen_random_uuid() as p1 \gset
select gen_random_uuid() as p_coach \gset
select gen_random_uuid() as p_b \gset

select tests.act_as(:'a1');
select public.create_community_post(:'p1', :'comm_a', 'Squat PR today');
reset role;
select tests.act_as(:'coach_a');
select public.create_community_post(:'p_coach', :'comm_a', 'Welcome');
reset role;
select tests.act_as(:'b1');
select public.create_community_post(:'p_b', :'comm_b', 'Hi B');
reset role;
-- A3 comments on A1's post.
select tests.act_as(:'a3');
insert into public.community_comments (post_id, body) values (:'p1', 'Nice!');
reset role;
select id as c_a3 from public.community_comments where post_id = :'p1' and author_id = :'a3' \gset
select tests.act_as(:'b1');
insert into public.community_comments (post_id, body) values (:'p_b', 'me again');
reset role;
select id as c_b from public.community_comments where post_id = :'p_b' \gset

-- ---------------------------------------------------------------------------------------------------------------
-- Data migration: the copy the migration ran, run again on a like and a 'like' notification seeded the old way
-- ---------------------------------------------------------------------------------------------------------------
select gen_random_uuid() as like1 \gset
select set_config('request.jwt.claims', '', true);
create table public.community_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  community_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.community_notifications drop constraint community_notifications_kind_check;
insert into public.community_likes (id, post_id, community_id, workspace_id, user_id, created_at)
values (:'like1', :'p_coach', :'comm_a', :'ws_a', :'a1', '2026-11-01T10:00:00Z');
insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, actor_id, created_at)
values (:'ws_a', :'comm_a', :'coach_a', 'like', :'p_coach', :'a1', '2026-11-01T10:00:00Z');
select lives_ok('select public.community_likes_to_reactions()', 'the like copy runs');
select results_eq(format($$select reaction, user_id, post_id, comment_id, community_id, workspace_id, created_at
  from public.community_reactions where id = %L$$, :'like1'),
  format($$values ('heart'::text, %L::uuid, %L::uuid, null::uuid, %L::uuid, %L::uuid, '2026-11-01T10:00:00Z'::timestamptz)$$,
    :'a1', :'p_coach', :'comm_a', :'ws_a'),
  'an existing like becomes a heart, with the same id, person, post and time');
select is((select count(*)::int from public.community_notifications where kind = 'like'), 0, 'no ''like'' notifications are left');
select results_eq(format($$select kind, created_at from public.community_notifications where recipient_id = %L and actor_id = %L$$,
  :'coach_a', :'a1'), $$values ('reaction'::text, '2026-11-01T10:00:00Z'::timestamptz)$$,
  'the like notification becomes the one reaction notification (not written twice)');
select lives_ok('select public.community_likes_to_reactions()', 'running the copy again ...');
select is((select count(*)::int from public.community_reactions where post_id = :'p_coach' and user_id = :'a1'), 1, '... adds nothing');
select ok(not has_function_privilege('authenticated', 'public.community_likes_to_reactions()', 'execute'),
  'the apps cannot run the copy');
drop table public.community_likes;
alter table public.community_notifications add constraint community_notifications_kind_check
  check (kind in ('comment', 'reaction', 'coach_post', 'report'));
-- Out of the way for the tests below (its notification goes with it).
delete from public.community_reactions where id = :'like1';
select is((select count(*)::int from public.community_notifications where actor_id = :'a1' and kind = 'reaction'), 0,
  'removing the copied heart removes its notification');

-- ---------------------------------------------------------------------------------------------------------------
-- Schema and privileges
-- ---------------------------------------------------------------------------------------------------------------
select has_table('public', 'community_reactions', 'reactions have their own table');
select hasnt_table('public', 'community_likes', 'the old likes table is gone');
select ok((select relrowsecurity from pg_class where oid = 'public.community_reactions'::regclass), 'reactions have RLS on');
select ok(not has_table_privilege('anon', 'public.community_reactions', 'select,insert,update,delete'), 'anon has no access');
select ok(not has_table_privilege('authenticated', 'public.community_reactions', 'update'), 'reactions are never edited');
select ok(not has_column_privilege('authenticated', 'public.community_reactions', 'user_id', 'insert'),
  'a reaction''s author is always the caller');
select ok(not has_column_privilege('authenticated', 'public.community_reactions', 'workspace_id', 'insert'),
  'the workspace always comes from the post');
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename = 'community_reactions'), 1, 'reactions are published to Realtime');
select is((select relreplident::text from pg_class where oid = 'public.community_reactions'::regclass), 'd',
  'a DELETE event carries only the uuid key');

-- ---------------------------------------------------------------------------------------------------------------
-- Reacting
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'a2');
select lives_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'fire')$$, :'p1'),
  'A2 reacts to A1''s post with fire');
select lives_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'muscle')$$, :'p1'),
  '... and with muscle too (any number of the six)');
select throws_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'fire')$$, :'p1'), '23505', null,
  'the same reaction twice is refused (tapping again removes it)');
select throws_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'like')$$, :'p1'), '23514', null,
  'only the six keys are allowed');
select throws_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, '🔥')$$, :'p1'), '23514', null,
  'emoji are not stored, only keys');
select throws_ok(format($$insert into public.community_reactions (post_id, user_id, reaction) values (%L, %L, 'heart')$$, :'p1', :'a3'),
  '42501', null, 'A2 cannot react in A3''s name');
select lives_ok(format($$insert into public.community_reactions (comment_id, reaction) values (%L, 'laugh')$$, :'c_a3'),
  'A2 reacts to A3''s comment');
select results_eq(format($$select post_id, community_id, workspace_id, user_id from public.community_reactions where comment_id = %L$$, :'c_a3'),
  format($$values (%L::uuid, %L::uuid, %L::uuid, %L::uuid)$$, :'p1', :'comm_a', :'ws_a', :'a2'),
  'a comment reaction takes its post, community and workspace from the comment');
select lives_ok(format($$insert into public.community_reactions (post_id, comment_id, reaction) values (%L, %L, 'clap')$$, :'p_coach', :'c_a3'),
  'a comment reaction that names the wrong post ...');
select is((select post_id from public.community_reactions where comment_id = :'c_a3' and reaction = 'clap'), :'p1'::uuid,
  '... is filed under the comment''s real post');
select is((select count(*)::int from public.community_reactions where post_id = :'p1' and comment_id is null), 2,
  'A2 sees their two reactions on the post');
reset role;

select tests.act_as(:'a3');
select lives_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'fire')$$, :'p1'),
  'A3 reacts with fire as well');
select is((select count(*)::int from public.community_reactions where post_id = :'p1'), 5,
  'A3 sees everyone''s reactions on the post and its comment');
with d as (delete from public.community_reactions where user_id = :'a2' returning 1)
select is((select count(*)::int from d), 0, 'A3 cannot remove A2''s reactions');
reset role;

select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'party')$$, :'p1'),
  'the coach reacts too');
select lives_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'heart')$$, :'p_coach'),
  'reacting to your own post is fine');
reset role;

-- ---------------------------------------------------------------------------------------------------------------
-- Notifications: one per person per post or comment, however many reactions they add
-- ---------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.community_notifications where kind = 'reaction' and recipient_id = :'a1'
  and post_id = :'p1' and comment_id is null), 3, 'A1 hears once each from A2 (two reactions), A3 and the coach');
select is((select count(*)::int from public.community_notifications where kind = 'reaction' and recipient_id = :'a1'
  and actor_id = :'a2' and comment_id is null), 1, 'A2''s two reactions collapse into one notification');
select is((select count(*)::int from public.community_notifications where kind = 'reaction' and recipient_id = :'a3'
  and comment_id = :'c_a3'), 1, 'A3 hears once about A2''s two reactions on their comment');
select is((select post_id from public.community_notifications where kind = 'reaction' and comment_id = :'c_a3'), :'p1'::uuid,
  'the comment notification links to its post');
select is((select count(*)::int from public.community_notifications where kind = 'reaction' and post_id = :'p_coach'), 0,
  'no notification for reacting to your own post');
select throws_ok(format($$insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, actor_id)
  values (%L, %L, %L, 'reaction', %L, %L)$$, :'ws_a', :'comm_a', :'a1', :'p1', :'a3'), '23505', null,
  'the database keeps one reaction notification per recipient, actor and post');
select throws_ok(format($$insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, comment_id, actor_id)
  values (%L, %L, %L, 'reaction', %L, %L, %L)$$, :'ws_a', :'comm_a', :'a3', :'p1', :'c_a3', :'a2'), '23505', null,
  '... and per recipient, actor and comment');
select lives_ok(format($$insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, actor_id)
  values (%L, %L, %L, 'comment', %L, %L)$$, :'ws_a', :'comm_a', :'a1', :'p1', :'a3'), 'other kinds are not limited by it');
delete from public.community_notifications where kind = 'comment' and recipient_id = :'a1' and actor_id = :'a3';

select tests.act_as(:'a2');
delete from public.community_reactions where post_id = :'p1' and comment_id is null and reaction = 'fire';
reset role;
select is((select count(*)::int from public.community_notifications where kind = 'reaction' and recipient_id = :'a1'
  and actor_id = :'a2'), 1, 'taking back one of two reactions keeps the notification');
select tests.act_as(:'a2');
delete from public.community_reactions where post_id = :'p1' and comment_id is null;
reset role;
select is((select count(*)::int from public.community_notifications where kind = 'reaction' and recipient_id = :'a1'
  and actor_id = :'a2'), 0, 'taking back the last one removes it');
select is((select count(*)::int from public.community_notifications where kind = 'reaction' and comment_id = :'c_a3'), 1,
  '... without touching the comment''s notification');
select tests.act_as(:'a2');
select lives_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'fire')$$, :'p1'),
  'A2 reacts again');
reset role;

-- ---------------------------------------------------------------------------------------------------------------
-- Other workspaces see nothing and can do nothing
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.community_reactions where workspace_id = :'ws_a'), 0, 'coach B cannot see A''s reactions');
select throws_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'heart')$$, :'p1'), '42501', null,
  'coach B cannot react to A''s post');
select throws_ok(format($$insert into public.community_reactions (comment_id, reaction) values (%L, 'heart')$$, :'c_a3'), '42501', null,
  'coach B cannot react to A''s comment');
with d as (delete from public.community_reactions where workspace_id = :'ws_a' returning 1)
select is((select count(*)::int from d), 0, 'coach B cannot remove A''s reactions');
reset role;

select tests.act_as(:'b1');
select is((select count(*)::int from public.community_reactions), 0, 'B1 sees no reactions from workspace A');
select throws_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'heart')$$, :'p1'), '42501', null,
  'B1 cannot react to A''s post');
select throws_ok(format($$insert into public.community_reactions (comment_id, reaction) values (%L, 'heart')$$, :'c_a3'), '42501', null,
  'B1 cannot react to A''s comment');
select throws_ok(format($$insert into public.community_reactions (post_id, comment_id, reaction) values (%L, %L, 'heart')$$, :'p_b', :'c_a3'),
  '42501', null, 'B1 cannot reach A''s comment through their own post');
select lives_ok(format($$insert into public.community_reactions (comment_id, reaction) values (%L, 'heart')$$, :'c_b'),
  'B1 reacts in their own community');
reset role;

select tests.act_as(:'a1');
select is((select count(*)::int from public.community_reactions where workspace_id = :'ws_b'), 0, 'A1 cannot see B''s reactions');
select throws_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'heart')$$, :'p_b'), '42501', null,
  'A1 cannot react to B''s post');
reset role;

-- ---------------------------------------------------------------------------------------------------------------
-- Blocks: like likes, a blocker no longer sees the blocked member's reactions and cannot react to their content
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'a1');
insert into public.community_blocks (workspace_id, blocked_id) values (:'ws_a', :'a3');
select is((select count(*)::int from public.community_reactions where user_id = :'a3'), 0, 'A1 no longer sees A3''s reactions');
select is((select count(*)::int from public.community_reactions where comment_id = :'c_a3'), 0,
  '... or reactions on A3''s hidden comment');
select throws_ok(format($$insert into public.community_reactions (comment_id, reaction) values (%L, 'heart')$$, :'c_a3'), '42501', null,
  'A1 cannot react to a comment by someone they blocked');
select is((select count(*)::int from public.community_notifications where kind = 'reaction' and actor_id = :'a3'), 0,
  'A1 no longer sees A3''s reaction notifications');
reset role;

select tests.act_as(:'a2');
insert into public.community_blocks (workspace_id, blocked_id) values (:'ws_a', :'a1');
select throws_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'heart')$$, :'p1'), '42501', null,
  'A2 cannot react to a post by someone they blocked');
select throws_ok(format($$insert into public.community_reactions (comment_id, reaction) values (%L, 'muscle')$$, :'c_a3'), '42501', null,
  'A2 cannot react to a comment on a blocked member''s post');
select is((select count(*)::int from public.community_reactions where user_id = :'a1'), 0, 'A2 sees no reactions by A1');
select is((select count(*)::int from public.community_reactions where post_id = :'p1'), 0, '... and none on A1''s hidden post');
delete from public.community_blocks where blocked_id = :'a1';
select is((select count(*)::int from public.community_reactions where post_id = :'p1' and user_id = :'a2'), 3,
  'after unblocking, A2 sees their reactions on A1''s post again');
reset role;

select tests.act_as(:'a3');
select lives_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'party')$$, :'p1'),
  'being blocked does not stop A3 reacting (they are not told)');
reset role;

select tests.act_as(:'coach_a');
select is((select count(*)::int from public.community_reactions where user_id = :'a3'), 2, 'the coach still sees every reaction');
select throws_ok(format($$insert into public.community_blocks (workspace_id, blocked_id) values (%L, %L)$$, :'ws_a', :'a3'),
  '42501', null, 'the coach still cannot block');
reset role;

-- ---------------------------------------------------------------------------------------------------------------
-- Removed members
-- ---------------------------------------------------------------------------------------------------------------
select tests.act_as(:'coach_a');
select public.remove_community_member(:'comm_a', :'a3');
reset role;
select tests.act_as(:'a3');
select is((select count(*)::int from public.community_reactions), 0, 'a removed member sees no reactions');
select throws_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'heart')$$, :'p_coach'), '42501', null,
  'a removed member cannot react to a post');
select throws_ok(format($$insert into public.community_reactions (comment_id, reaction) values (%L, 'heart')$$, :'c_a3'), '42501', null,
  'a removed member cannot react to a comment');
with d as (delete from public.community_reactions where user_id = :'a3' returning 1)
select is((select count(*)::int from d), 0, 'a removed member cannot take reactions back either');
reset role;
select tests.act_as(:'coach_a');
select public.restore_community_member(:'comm_a', :'a3');
reset role;

-- Leaving the business keeps the reactions (shown as "Former member"), but ends access.
select tests.act_as(:'coach_a');
select public.remove_client(:'ws_a', :'a2');
reset role;
select is((select count(*)::int from public.community_reactions where user_id = :'a2'), 3, 'a former client''s reactions stay');
select tests.act_as(:'a2');
select is((select count(*)::int from public.community_reactions), 0, 'a former client sees no reactions');
select throws_ok(format($$insert into public.community_reactions (post_id, reaction) values (%L, 'party')$$, :'p_coach'), '42501', null,
  'a former client cannot react');
reset role;

-- ---------------------------------------------------------------------------------------------------------------
-- Deletes reach open feeds through communities.activity_at
-- ---------------------------------------------------------------------------------------------------------------
update public.communities set activity_at = '2000-01-01' where id = :'comm_a';
select tests.act_as(:'a3');
delete from public.community_reactions where post_id = :'p1' and comment_id is null and reaction = 'fire';
reset role;
select ok((select activity_at > '2000-01-01' from public.communities where id = :'comm_a'), 'a removed reaction bumps activity_at');

create table tests.cr_bumps (n int);
grant all on tests.cr_bumps to authenticated;
create function tests.cr_count_bump() returns trigger language plpgsql as $$
begin
  if new.activity_at is distinct from old.activity_at then insert into tests.cr_bumps values (1); end if;
  return new;
end $$;
create trigger cr_count_bump after update on public.communities for each row execute function tests.cr_count_bump();
select tests.act_as(:'coach_a');
delete from public.community_comments where id = :'c_a3';
reset role;
select is((select count(*)::int from tests.cr_bumps), 1, 'a comment with reactions bumps it once');
select is((select count(*)::int from public.community_reactions where comment_id = :'c_a3'), 0, '... and its reactions go with it');
delete from tests.cr_bumps;
select tests.act_as(:'coach_a');
delete from public.community_posts where id = :'p1';
reset role;
select is((select count(*)::int from tests.cr_bumps), 1, 'a post with reactions bumps it once');
select is((select count(*)::int from public.community_notifications where kind = 'reaction' and post_id = :'p1'), 0,
  'the post''s reaction notifications go with it');
drop trigger cr_count_bump on public.communities;

select * from finish();
rollback;
