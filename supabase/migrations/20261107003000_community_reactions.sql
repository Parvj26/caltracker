-- Community reactions: a fixed set of six (❤️ 💪 🔥 👏 😂 🎉, stored as the keys heart, muscle, fire, clap, laugh,
-- party) on posts and on comments. They replace the single Like: every like becomes a heart, and community_likes goes.
-- A member can add any number of the six to a post or comment; adding one they already used is refused (23505), and
-- the apps remove it instead, like Slack. Access mirrors likes: only current community members (and the coach) read or
-- write them, a blocker no longer sees the blocked member's reactions and cannot react to their content, and removed
-- members can do nothing.

-- ---------------------------------------------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------------------------------------------

-- A uuid key, not (target, user, reaction): a Realtime DELETE event carries only the key, so it reveals nothing.
-- post_id is set for comment reactions too (the comment's post), so a post page can listen to one filter.
create table public.community_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts on delete cascade,
  -- null for a reaction to the post itself.
  comment_id uuid references public.community_comments on delete cascade,
  -- post_id (for comments), community_id and workspace_id are copied from the target by a trigger.
  community_id uuid not null references public.communities on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  reaction text not null check (reaction in ('heart', 'muscle', 'fire', 'clap', 'laugh', 'party')),
  created_at timestamptz not null default now()
);
-- One of each reaction per person per target. Two partial indexes (not a constraint over a nullable column).
create unique index community_reactions_post_unique on public.community_reactions (post_id, user_id, reaction)
  where comment_id is null;
create unique index community_reactions_comment_unique on public.community_reactions (comment_id, user_id, reaction)
  where comment_id is not null;
create index community_reactions_comment_idx on public.community_reactions (comment_id);
create index community_reactions_community_idx on public.community_reactions (community_id);
create index community_reactions_workspace_idx on public.community_reactions (workspace_id);
create index community_reactions_user_idx on public.community_reactions (user_id);

-- ---------------------------------------------------------------------------------------------------------------
-- The database fills in who and where
-- ---------------------------------------------------------------------------------------------------------------

create function public.community_reaction_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.community_posts%rowtype;
  v_post uuid;
  v_comment_author uuid;
begin
  if new.comment_id is not null then
    -- A comment reaction belongs to the comment's own post, whatever the insert said (none: treated as not found).
    select c.post_id, c.author_id into v_post, v_comment_author from public.community_comments c where c.id = new.comment_id;
    new.post_id := v_post;
  end if;
  select * into p from public.community_posts x where x.id = new.post_id;
  -- Signed-in callers: no access and no target look the same, so nothing leaks. (The service role is trusted.)
  if (select auth.uid()) is not null then
    if not found
      or not public.can_view_community(p.community_id)
      or public.has_blocked(p.workspace_id, p.author_id)
      or (v_comment_author is not null and public.has_blocked(p.workspace_id, v_comment_author)) then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    new.user_id := (select auth.uid());
  elsif not found then
    raise exception 'Post not found' using errcode = '23503';
  end if;
  new.community_id := p.community_id;
  new.workspace_id := p.workspace_id;
  return new;
end;
$$;
create trigger community_reactions_before_insert before insert on public.community_reactions
  for each row execute function public.community_reaction_before_insert();

-- ---------------------------------------------------------------------------------------------------------------
-- Every like becomes a heart (same id and time), before the notification trigger exists: the like notifications are
-- carried over below instead of being written again.
-- ---------------------------------------------------------------------------------------------------------------

insert into public.community_reactions (id, post_id, community_id, workspace_id, user_id, reaction, created_at)
select l.id, l.post_id, l.community_id, l.workspace_id, l.user_id, 'heart', l.created_at
from public.community_likes l;

-- ---------------------------------------------------------------------------------------------------------------
-- Notifications: kind 'like' becomes 'reaction' (with comment_id set for a comment). One row per person per post or
-- comment, however many of the six they add; it goes when they take the last one back.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.community_notifications drop constraint community_notifications_kind_check;
update public.community_notifications set kind = 'reaction' where kind = 'like';
alter table public.community_notifications add constraint community_notifications_kind_check
  check (kind in ('comment', 'reaction', 'coach_post', 'report'));

create function public.community_notify_reaction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
begin
  if new.comment_id is not null then
    select c.author_id into v_recipient from public.community_comments c where c.id = new.comment_id;
  else
    select p.author_id into v_recipient from public.community_posts p where p.id = new.post_id;
  end if;
  if v_recipient is null or v_recipient = new.user_id then
    return new;
  end if;
  insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, comment_id, actor_id)
  select new.workspace_id, new.community_id, v_recipient, 'reaction', new.post_id, new.comment_id, new.user_id
  where not exists (
    select 1 from public.community_notifications n
    where n.kind = 'reaction' and n.recipient_id = v_recipient and n.actor_id = new.user_id
      and n.post_id = new.post_id and n.comment_id is not distinct from new.comment_id
  );
  return new;
end;
$$;
create trigger community_reactions_notify after insert on public.community_reactions
  for each row execute function public.community_notify_reaction();

create function public.community_unnotify_reaction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.community_reactions r
    where r.post_id = old.post_id and r.comment_id is not distinct from old.comment_id and r.user_id = old.user_id
  ) then
    delete from public.community_notifications n
    where n.kind = 'reaction' and n.post_id = old.post_id and n.comment_id is not distinct from old.comment_id
      and n.actor_id = old.user_id;
  end if;
  return old;
end;
$$;
create trigger community_reactions_unnotify after delete on public.community_reactions
  for each row execute function public.community_unnotify_reaction();

-- A reaction taken back bumps communities.activity_at (feeds never listen to DELETE events). One deleted along with
-- its post or comment does not: that delete already bumped once.
create function public.community_touch_activity_reaction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (old.comment_id is null and exists (select 1 from public.community_posts p where p.id = old.post_id))
    or (old.comment_id is not null and exists (select 1 from public.community_comments c where c.id = old.comment_id)) then
    update public.communities c set activity_at = clock_timestamp() where c.id = old.community_id;
  end if;
  return old;
end;
$$;
create trigger community_reactions_touch_activity after delete on public.community_reactions
  for each row execute function public.community_touch_activity_reaction();

-- ---------------------------------------------------------------------------------------------------------------
-- Retire likes (their triggers go with the table; Realtime drops it from the publication)
-- ---------------------------------------------------------------------------------------------------------------

drop table public.community_likes;
drop function public.community_like_before_insert();
drop function public.community_notify_like();
drop function public.community_unnotify_like();

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------------------------------------------

revoke execute on function public.community_reaction_before_insert(), public.community_notify_reaction(),
  public.community_unnotify_reaction(), public.community_touch_activity_reaction()
  from public, anon, authenticated;

revoke all on table public.community_reactions from anon, authenticated, service_role;
grant select, delete on public.community_reactions to authenticated;
grant insert (post_id, comment_id, reaction) on public.community_reactions to authenticated;
grant select, insert, update, delete on public.community_reactions to service_role;

alter table public.community_reactions enable row level security;

-- Visible exactly when its post or comment is (the subqueries run under those policies, so blocks and removals
-- apply), and never a blocked member's own reactions.
create policy community_reactions_select on public.community_reactions for select to authenticated
  using (public.can_view_community(community_id) and not public.has_blocked(workspace_id, user_id)
    and case when comment_id is null
      then exists (select 1 from public.community_posts p where p.id = post_id)
      else exists (select 1 from public.community_comments c where c.id = comment_id)
    end);
create policy community_reactions_insert on public.community_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_view_community(community_id));
create policy community_reactions_delete on public.community_reactions for delete to authenticated
  using (user_id = (select auth.uid()) and public.can_view_community(community_id));

-- ---------------------------------------------------------------------------------------------------------------
-- Realtime (idempotent; a no-op where the publication does not exist). INSERTs only reach the apps; deletes bump
-- communities.activity_at.
-- ---------------------------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_reactions'
    ) then
    alter publication supabase_realtime add table public.community_reactions;
  end if;
end;
$$;
