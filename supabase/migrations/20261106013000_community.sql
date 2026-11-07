-- Community (docs/superpowers/specs/2026-11-06-community-design.md, spec §7): one private community per workspace.
-- Every table carries workspace_id and has RLS on. Read access: an active community member, or a coach of the
-- workspace. Blocked content is hidden by RLS for the blocker. Removing a client from the business deletes the
-- workspace membership, which cascades to the community membership, so access ends at once.

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

-- One default community per workspace (created by a trigger). The schema allows more groups later.
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null default 'Community' check (char_length(name) between 1 and 80),
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  -- Bumped by the database whenever a post, comment or like is deleted. Feeds listen for this row's UPDATE (filtered
  -- by id, checked by RLS) instead of DELETE events, which Realtime can neither filter nor check.
  activity_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create unique index communities_one_default_idx on public.communities (workspace_id) where is_default;

-- Who is in a community. Added by a trigger when someone joins the workspace; removed_at is the coach's
-- "remove from the community" (they stay a client). The row goes with the workspace membership.
create table public.community_members (
  community_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('coach', 'client')),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users on delete set null,
  primary key (community_id, user_id),
  foreign key (community_id, workspace_id) references public.communities (id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);
create index community_members_user_idx on public.community_members (user_id);
create index community_members_workspace_idx on public.community_members (workspace_id, user_id);

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null,
  workspace_id uuid not null,
  -- Posts show the author's name and photo, read from profiles (embedded through this key).
  author_id uuid not null references public.profiles on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  -- A sticker / workout / PR card the author chose to share. Built by create_community_post from the database's own
  -- records (zoo book, workout log, stored award), never from what the app sent.
  card jsonb check (
    card is null
    or (jsonb_typeof(card) = 'object' and card ->> 'kind' in ('sticker', 'workout', 'pr') and octet_length(card::text) <= 4000)
  ),
  image_count smallint not null default 0 check (image_count between 0 and 4),
  pinned_at timestamptz,
  pinned_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  check (body ~ '\S' or card is not null or image_count > 0),
  unique (id, workspace_id),
  foreign key (community_id, workspace_id) references public.communities (id, workspace_id) on delete cascade
);
create index community_posts_feed_idx on public.community_posts (community_id, created_at desc);
create index community_posts_workspace_idx on public.community_posts (workspace_id);
create index community_posts_author_idx on public.community_posts (author_id);

-- Up to 4 photos per post: {workspace}/{author}/{post}/{photo}.webp (or .jpg) and its -thumb.
create table public.community_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  workspace_id uuid not null,
  position smallint not null check (position between 0 and 3),
  path text not null unique,
  thumb_path text not null unique,
  -- Shrunk on the device: at most 1600 px on the long edge.
  width integer not null check (width between 1 and 1600),
  height integer not null check (height between 1 and 1600),
  unique (post_id, position),
  foreign key (post_id, workspace_id) references public.community_posts (id, workspace_id) on delete cascade
);
create index community_post_images_workspace_idx on public.community_post_images (workspace_id);

create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts on delete cascade,
  -- community_id and workspace_id are copied from the post by a trigger, whatever the insert said.
  community_id uuid not null references public.communities on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  -- Always the caller (no column privilege, so the default and the trigger apply).
  author_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 1000 and body ~ '\S'),
  created_at timestamptz not null default now()
);
create index community_comments_post_idx on public.community_comments (post_id, created_at);
create index community_comments_community_idx on public.community_comments (community_id);
create index community_comments_workspace_idx on public.community_comments (workspace_id);
create index community_comments_author_idx on public.community_comments (author_id);

-- A uuid key, not (post, user): a Realtime DELETE event carries only the key, so it reveals nothing.
create table public.community_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts on delete cascade,
  community_id uuid not null references public.communities on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);
create index community_likes_community_idx on public.community_likes (community_id);
create index community_likes_workspace_idx on public.community_likes (workspace_id);
create index community_likes_user_idx on public.community_likes (user_id);

-- A member hides another member's content for themselves.
create table public.community_blocks (
  workspace_id uuid not null references public.workspaces on delete cascade,
  blocker_id uuid not null default auth.uid() references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index community_blocks_blocked_idx on public.community_blocks (blocked_id);
create index community_blocks_blocker_idx on public.community_blocks (blocker_id);

-- Reports go to the coach. The reported text and its author are copied, so the report still reads after a delete.
create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  community_id uuid not null references public.communities on delete cascade,
  reporter_id uuid references auth.users on delete set null,
  target_kind text not null check (target_kind in ('post', 'comment')),
  post_id uuid references public.community_posts on delete set null,
  comment_id uuid references public.community_comments on delete set null,
  target_author_id uuid references auth.users on delete set null,
  target_body text not null default '' check (char_length(target_body) <= 2000),
  target_image_count smallint not null default 0,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users on delete set null,
  resolution text check (resolution in ('removed', 'kept')),
  check ((resolved_at is null) = (resolution is null))
);
create index community_reports_queue_idx on public.community_reports (workspace_id, resolved_at, created_at desc);
create index community_reports_community_idx on public.community_reports (community_id);
create index community_reports_post_idx on public.community_reports (post_id);
create index community_reports_comment_idx on public.community_reports (comment_id);
create index community_reports_reporter_idx on public.community_reports (reporter_id);
create index community_reports_target_author_idx on public.community_reports (target_author_id);
create index community_reports_resolved_by_idx on public.community_reports (resolved_by);

-- The in-app notifications list. Written by triggers only. Push later: an Edge Function on inserts here (Database
-- Webhook) can send the same text (packages/shared community/notifications.ts) without a schema change.
create table public.community_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  community_id uuid not null references public.communities on delete cascade,
  recipient_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('comment', 'like', 'coach_post', 'report')),
  post_id uuid references public.community_posts on delete cascade,
  comment_id uuid references public.community_comments on delete cascade,
  report_id uuid references public.community_reports on delete cascade,
  actor_id uuid references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index community_notifications_recipient_idx on public.community_notifications (recipient_id, created_at desc);
create index community_notifications_workspace_idx on public.community_notifications (workspace_id);
create index community_notifications_community_idx on public.community_notifications (community_id);
create index community_notifications_post_idx on public.community_notifications (post_id);
create index community_notifications_comment_idx on public.community_notifications (comment_id);
create index community_notifications_report_idx on public.community_notifications (report_id);
create index community_notifications_actor_idx on public.community_notifications (actor_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Access helpers (definer, so policies can use them without recursion)
-- ---------------------------------------------------------------------------------------------------------------

-- True for an active member of the community, or a coach (owner or staff) of its workspace.
create function public.can_view_community(p_community_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.communities c
    where c.id = p_community_id
      and (
        public.is_coach_of(c.workspace_id)
        or exists (
          select 1 from public.community_members cm
          where cm.community_id = c.id and cm.user_id = (select auth.uid()) and cm.removed_at is null
        )
      )
  );
$$;

-- True when the caller has blocked p_user_id in that workspace.
create function public.has_blocked(p_workspace_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.community_blocks b
    where b.workspace_id = p_workspace_id and b.blocker_id = (select auth.uid()) and b.blocked_id = p_user_id
  );
$$;

-- Clients block other clients of their own workspace. The coach is never blocked, and never blocks (they moderate).
create function public.can_block_in_community(p_workspace_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_member_of(p_workspace_id)
    and not public.is_coach_of(p_workspace_id)
    and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role = 'client'
    );
$$;

-- Upload paths: {workspace}/{caller}/{post}/{file}.webp|jpg|jpeg, in a workspace whose community the caller can post in.
-- (The file's real type and pixel size are checked on the device; checking them on the server is a follow-up.)
create function public.can_upload_community_image(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+\.(webp|jpg|jpeg)$'
      and split_part(p_name, '/', 2) = (select auth.uid())::text
    then exists (
      select 1 from public.communities c
      where c.workspace_id = split_part(p_name, '/', 1)::uuid and public.can_view_community(c.id)
    )
    else false
  end;
$$;

-- Reading a photo: it must belong to a post the caller can see. Not a definer: the lookup runs under the caller's
-- RLS, so removals and blocks apply to photos too.
create function public.can_read_community_image(p_name text) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.community_post_images i where i.path = p_name or i.thumb_path = p_name
  );
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Membership triggers and back-fill
-- ---------------------------------------------------------------------------------------------------------------

create function public.community_for_new_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.communities (workspace_id, is_default) values (new.id, true);
  return new;
end;
$$;
create trigger workspaces_create_community after insert on public.workspaces
  for each row execute function public.community_for_new_workspace();

-- A new community takes in everyone already in the workspace (back-fill, and future extra groups).
create function public.community_add_existing_members() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.community_members (community_id, workspace_id, user_id, role)
  select new.id, new.workspace_id, m.user_id, case when m.role = 'client' then 'client' else 'coach' end
  from public.workspace_members m
  where m.workspace_id = new.workspace_id
  on conflict (community_id, user_id) do nothing;
  return new;
end;
$$;
create trigger communities_add_members after insert on public.communities
  for each row execute function public.community_add_existing_members();

-- Joining the workspace (invite accepted, coach provisioned) joins its communities.
create function public.community_add_new_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.community_members (community_id, workspace_id, user_id, role)
  select c.id, c.workspace_id, new.user_id, case when new.role = 'client' then 'client' else 'coach' end
  from public.communities c
  where c.workspace_id = new.workspace_id
  on conflict (community_id, user_id) do update
    set role = excluded.role, removed_at = null, removed_by = null, joined_at = now();
  return new;
end;
$$;
create trigger workspace_members_join_community after insert on public.workspace_members
  for each row execute function public.community_add_new_member();

-- Every existing workspace gets its community (the trigger above adds the members).
insert into public.communities (workspace_id, is_default)
select w.id, true from public.workspaces w
where not exists (select 1 from public.communities c where c.workspace_id = w.id and c.is_default);

-- ---------------------------------------------------------------------------------------------------------------
-- Comments and likes: the database fills in who and where
-- ---------------------------------------------------------------------------------------------------------------

create function public.community_comment_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.community_posts%rowtype;
begin
  select * into p from public.community_posts x where x.id = new.post_id;
  -- Signed-in callers: no access and no post look the same, so nothing leaks. (The service role is trusted.)
  if (select auth.uid()) is not null then
    if not found or not public.can_view_community(p.community_id) or public.has_blocked(p.workspace_id, p.author_id) then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    new.author_id := (select auth.uid());
  elsif not found then
    raise exception 'Post not found' using errcode = '23503';
  end if;
  new.community_id := p.community_id;
  new.workspace_id := p.workspace_id;
  new.body := btrim(new.body);
  return new;
end;
$$;
create trigger community_comments_before_insert before insert on public.community_comments
  for each row execute function public.community_comment_before_insert();

create function public.community_like_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.community_posts%rowtype;
begin
  select * into p from public.community_posts x where x.id = new.post_id;
  if (select auth.uid()) is not null then
    if not found or not public.can_view_community(p.community_id) or public.has_blocked(p.workspace_id, p.author_id) then
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
create trigger community_likes_before_insert before insert on public.community_likes
  for each row execute function public.community_like_before_insert();

-- ---------------------------------------------------------------------------------------------------------------
-- Notifications (in-app). Each trigger writes rows; the apps group and word them (packages/shared).
-- ---------------------------------------------------------------------------------------------------------------

-- A new post by a coach: every other active member hears about it.
create function public.community_notify_post() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.workspace_members m
    where m.workspace_id = new.workspace_id and m.user_id = new.author_id and m.role in ('owner', 'staff')
  ) then
    insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, actor_id)
    select new.workspace_id, new.community_id, cm.user_id, 'coach_post', new.id, new.author_id
    from public.community_members cm
    where cm.community_id = new.community_id and cm.removed_at is null and cm.user_id <> new.author_id;
  end if;
  return new;
end;
$$;
create trigger community_posts_notify after insert on public.community_posts
  for each row execute function public.community_notify_post();

-- A comment on my post.
create function public.community_notify_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, comment_id, actor_id)
  select new.workspace_id, new.community_id, p.author_id, 'comment', new.post_id, new.id, new.author_id
  from public.community_posts p
  where p.id = new.post_id and p.author_id <> new.author_id;
  return new;
end;
$$;
create trigger community_comments_notify after insert on public.community_comments
  for each row execute function public.community_notify_comment();

-- A like on my post (taken back again on unlike).
create function public.community_notify_like() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, actor_id)
  select new.workspace_id, new.community_id, p.author_id, 'like', new.post_id, new.user_id
  from public.community_posts p
  where p.id = new.post_id and p.author_id <> new.user_id;
  return new;
end;
$$;
create trigger community_likes_notify after insert on public.community_likes
  for each row execute function public.community_notify_like();

create function public.community_unnotify_like() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.community_notifications n
  where n.kind = 'like' and n.post_id = old.post_id and n.actor_id = old.user_id;
  return old;
end;
$$;
create trigger community_likes_unnotify after delete on public.community_likes
  for each row execute function public.community_unnotify_like();

-- A new report: every coach of the workspace.
create function public.community_notify_report() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, comment_id, report_id, actor_id)
  select new.workspace_id, new.community_id, m.user_id, 'report', new.post_id, new.comment_id, new.id, new.reporter_id
  from public.workspace_members m
  where m.workspace_id = new.workspace_id and m.role in ('owner', 'staff');
  return new;
end;
$$;
create trigger community_reports_notify after insert on public.community_reports
  for each row execute function public.community_notify_report();

-- Deletes become a filterable UPDATE of the community's activity_at (see communities.activity_at).
create function public.community_touch_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.communities c set activity_at = clock_timestamp() where c.id = old.community_id;
  return old;
end;
$$;
create trigger community_posts_touch_activity after delete on public.community_posts
  for each row execute function public.community_touch_activity();
-- A comment or like deleted on its own bumps it too; one deleted along with its post does not (the post's own delete
-- already did, so a post with N comments and likes bumps once, not N + 1 times).
create function public.community_touch_activity_child() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.community_posts p where p.id = old.post_id) then
    update public.communities c set activity_at = clock_timestamp() where c.id = old.community_id;
  end if;
  return old;
end;
$$;
create trigger community_comments_touch_activity after delete on public.community_comments
  for each row execute function public.community_touch_activity_child();
create trigger community_likes_touch_activity after delete on public.community_likes
  for each row execute function public.community_touch_activity_child();

-- ---------------------------------------------------------------------------------------------------------------
-- Functions the apps call
-- ---------------------------------------------------------------------------------------------------------------

-- Builds the card to store from the database's own records. The app only says what to share:
--   {"kind":"sticker","stickerKey":k}  a sticker in the author's zoo book (shiny and count from sticker_awards)
--   {"kind":"workout","logId":id}      the author's finished workout: its name and finish time, exercise and set
--                                       counts, and the animal from the stored award (volume is not shown: that sum
--                                       lives only in packages/shared)
--   {"kind":"pr","logId":id}           the PRs the award function stored for that workout (names from exercises)
-- Any other key, or another kind, is refused (22023); someone else's sticker or workout is refused (42501).
create function public.build_community_card(p_workspace_id uuid, p_author_id uuid, p_card jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text;
  v_log public.workout_logs%rowtype;
  v_award jsonb;
  v_sticker public.sticker_awards%rowtype;
  v_prs jsonb;
begin
  if jsonb_typeof(p_card) is distinct from 'object' then
    raise exception 'Card must be an object' using errcode = '22023';
  end if;
  v_kind := p_card ->> 'kind';
  if v_kind = 'sticker' then
    if exists (select 1 from jsonb_object_keys(p_card) k where k not in ('kind', 'stickerKey'))
      or jsonb_typeof(p_card -> 'stickerKey') is distinct from 'string' then
      raise exception 'A sticker card names only the sticker' using errcode = '22023';
    end if;
    select * into v_sticker from public.sticker_awards a
    where a.client_id = p_author_id and a.workspace_id = p_workspace_id and a.sticker_key = p_card ->> 'stickerKey';
    if not found then
      raise exception 'You can only share stickers you have' using errcode = '42501';
    end if;
    return jsonb_build_object('kind', 'sticker', 'stickerKey', v_sticker.sticker_key, 'shiny', v_sticker.shiny,
      'count', v_sticker.count);
  end if;

  if v_kind not in ('workout', 'pr') or v_kind is null then
    raise exception 'Unknown card' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_card) k where k not in ('kind', 'logId'))
    or coalesce(p_card ->> 'logId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A workout card names only the workout' using errcode = '22023';
  end if;
  select * into v_log from public.workout_logs l
  where l.id = (p_card ->> 'logId')::uuid and l.client_id = p_author_id and l.workspace_id = p_workspace_id
    and l.status = 'completed';
  if not found then
    raise exception 'You can only share your own finished workouts' using errcode = '42501';
  end if;
  select a.result into v_award from public.awards a where a.log_id = v_log.id and a.client_id = p_author_id;

  if v_kind = 'workout' then
    return jsonb_build_object(
      'kind', 'workout',
      'logId', v_log.id,
      'workoutName', left(v_log.name, 120),
      'finishedAt', v_log.finished_at,
      'exerciseCount', (select count(*) from public.log_exercises e join public.log_blocks b on b.id = e.block_id
        where b.log_id = v_log.id),
      'setCount', (select count(*) from public.log_sets st join public.log_exercises e on e.id = st.log_exercise_id
        join public.log_blocks b on b.id = e.block_id where b.log_id = v_log.id and st.completed_at is not null),
      'stickerKey', v_award #>> '{ladder,key}',
      'multiple', v_award #> '{ladder,multiple}',
      'shiny', coalesce((v_award #>> '{ladder,shiny}')::boolean, false));
  end if;

  select jsonb_agg(jsonb_build_object(
      'exerciseName', coalesce(left(x.name, 120), 'Exercise'),
      'prKind', pr ->> 'kind',
      'valueKg', pr -> 'valueKg',
      'reps', pr -> 'reps') order by ord)
    into v_prs
  from jsonb_array_elements(coalesce(v_award -> 'prs', '[]'::jsonb)) with ordinality as t(pr, ord)
  left join public.exercises x on x.id = case
    when pr ->> 'exerciseId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (pr ->> 'exerciseId')::uuid
  end
  where ord <= 5;
  if v_prs is null then
    raise exception 'This workout set no personal bests' using errcode = '22023';
  end if;
  return jsonb_build_object('kind', 'pr', 'logId', v_log.id, 'workoutName', left(v_log.name, 120),
    'finishedAt', v_log.finished_at, 'prs', v_prs);
end;
$$;

-- Creates a post (with its photos, already uploaded to the caller's folder) as the caller. p_id comes from the app,
-- so a retry of the same post returns it instead of posting twice. p_images: [{path, thumbPath, width, height}].
create function public.create_community_post(
  p_id uuid, p_community_id uuid, p_body text, p_card jsonb default null, p_images jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_ws uuid;
  v_author uuid;
  v_images jsonb := coalesce(p_images, '[]'::jsonb);
  v_prefix text;
  v_img record;
  v_path text;
  v_thumb text;
  v_card jsonb;
begin
  if v_me is null or p_id is null or not public.can_view_community(p_community_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select c.workspace_id into v_ws from public.communities c where c.id = p_community_id;

  select p.author_id into v_author from public.community_posts p where p.id = p_id;
  if found then
    if v_author = v_me then
      return p_id;
    end if;
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if jsonb_typeof(v_images) <> 'array' then
    raise exception 'Photos must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_images) > 4 then
    raise exception 'At most 4 photos per post' using errcode = '23514';
  end if;
  if p_card is not null then
    v_card := public.build_community_card(v_ws, v_me, p_card);
  end if;

  insert into public.community_posts (id, community_id, workspace_id, author_id, body, card, image_count)
  values (p_id, p_community_id, v_ws, v_me, btrim(coalesce(p_body, '')), v_card, jsonb_array_length(v_images));

  v_prefix := v_ws::text || '/' || v_me::text || '/' || p_id::text || '/';
  for v_img in select value, ordinality from jsonb_array_elements(v_images) with ordinality loop
    v_path := v_img.value ->> 'path';
    v_thumb := v_img.value ->> 'thumbPath';
    if v_path is null or v_thumb is null
      or v_path !~ ('^' || v_prefix || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|jpeg)$')
      or v_thumb <> regexp_replace(v_path, '\.(webp|jpg|jpeg)$', '-thumb.\1') then
      raise exception 'Photos must be in your own folder for this post' using errcode = '23514';
    end if;
    insert into public.community_post_images (post_id, workspace_id, position, path, thumb_path, width, height)
    values (p_id, v_ws, (v_img.ordinality - 1)::smallint, v_path, v_thumb,
      (v_img.value ->> 'width')::integer, (v_img.value ->> 'height')::integer);
  end loop;
  return p_id;
end;
$$;

-- Coach only: pin or unpin a post.
create function public.set_community_post_pinned(p_post_id uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.community_posts p
  set pinned_at = case when p_pinned then now() end,
      pinned_by = case when p_pinned then (select auth.uid()) end
  where p.id = p_post_id and public.is_coach_of(p.workspace_id);
  if not found then
    raise exception 'Only the coach can pin posts' using errcode = '42501';
  end if;
end;
$$;

-- Coach only: take a client out of the community (they stay the coach's client), or let them back in.
create function public.remove_community_member(p_community_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.communities c where c.id = p_community_id and public.is_coach_of(c.workspace_id)) then
    raise exception 'Only the coach can remove members' using errcode = '42501';
  end if;
  update public.community_members cm
  set removed_at = now(), removed_by = (select auth.uid())
  where cm.community_id = p_community_id and cm.user_id = p_user_id and cm.role = 'client' and cm.removed_at is null;
  if not found then
    raise exception 'Not a member of this community' using errcode = 'P0002';
  end if;
end;
$$;

create function public.restore_community_member(p_community_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.communities c where c.id = p_community_id and public.is_coach_of(c.workspace_id)) then
    raise exception 'Only the coach can add members back' using errcode = '42501';
  end if;
  update public.community_members cm
  set removed_at = null, removed_by = null
  where cm.community_id = p_community_id and cm.user_id = p_user_id and cm.removed_at is not null;
  if not found then
    raise exception 'Not a removed member of this community' using errcode = 'P0002';
  end if;
end;
$$;

-- Report a post or a comment the caller can see (exactly one of the two). A repeat of an open report by the same
-- person returns it. Returns the report id. 42501 for anything the caller can't see (nothing leaks).
create function public.report_community_content(
  p_reason text, p_post_id uuid default null, p_comment_id uuid default null, p_note text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_kind text;
  v_community uuid;
  v_ws uuid;
  v_author uuid;
  v_body text;
  v_post uuid;
  v_images smallint := 0;
  v_id uuid;
begin
  if (p_post_id is null) = (p_comment_id is null) then
    raise exception 'Report a post or a comment' using errcode = '22023';
  end if;
  if p_comment_id is not null then
    v_kind := 'comment';
    select c.community_id, c.workspace_id, c.author_id, c.body, c.post_id
      into v_community, v_ws, v_author, v_body, v_post
    from public.community_comments c where c.id = p_comment_id;
  else
    v_kind := 'post';
    select p.community_id, p.workspace_id, p.author_id, p.body, p.id, p.image_count
      into v_community, v_ws, v_author, v_body, v_post, v_images
    from public.community_posts p where p.id = p_post_id;
  end if;
  if v_me is null or v_community is null or not public.can_view_community(v_community) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_author = v_me then
    raise exception 'You can''t report your own post' using errcode = '22023';
  end if;

  select r.id into v_id from public.community_reports r
  where r.reporter_id = v_me and r.resolved_at is null and r.target_kind = v_kind
    and r.post_id = v_post and r.comment_id is not distinct from p_comment_id;
  if found then
    return v_id;
  end if;

  insert into public.community_reports (workspace_id, community_id, reporter_id, target_kind, post_id, comment_id,
    target_author_id, target_body, target_image_count, reason, note)
  values (v_ws, v_community, v_me, v_kind, v_post, p_comment_id, v_author, coalesce(v_body, ''), coalesce(v_images, 0),
    p_reason, btrim(coalesce(p_note, '')))
  returning id into v_id;
  return v_id;
end;
$$;

-- Coach only: close a report. 'removed' deletes the reported post or comment; 'kept' leaves it. Every open report
-- about the same post or comment is closed with it.
create function public.resolve_community_report(p_report_id uuid, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.community_reports%rowtype;
begin
  select * into r from public.community_reports x where x.id = p_report_id for update;
  if not found or not public.is_coach_of(r.workspace_id) then
    raise exception 'Only the coach can handle reports' using errcode = '42501';
  end if;
  if p_resolution is null or p_resolution not in ('removed', 'kept') then
    raise exception 'Resolution must be removed or kept' using errcode = '22023';
  end if;

  update public.community_reports x
  set resolved_at = now(), resolved_by = (select auth.uid()), resolution = p_resolution
  where x.workspace_id = r.workspace_id and x.resolved_at is null
    and (x.id = r.id
      or (r.target_kind = 'comment' and x.target_kind = 'comment' and x.comment_id = r.comment_id)
      or (r.target_kind = 'post' and x.target_kind = 'post' and x.post_id = r.post_id));

  if p_resolution = 'removed' then
    if r.target_kind = 'comment' and r.comment_id is not null then
      delete from public.community_comments c where c.id = r.comment_id;
    elsif r.target_kind = 'post' and r.post_id is not null then
      delete from public.community_posts p where p.id = r.post_id;
    end if;
  end if;
end;
$$;

-- The caller has seen their notifications up to now.
create function public.mark_community_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update public.community_notifications n set read_at = now()
  where n.recipient_id = (select auth.uid()) and n.read_at is null;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------------------------------------------

revoke execute on function
  public.can_view_community(uuid), public.has_blocked(uuid, uuid), public.can_block_in_community(uuid, uuid),
  public.can_upload_community_image(text), public.can_read_community_image(text),
  public.community_for_new_workspace(), public.community_add_existing_members(), public.community_add_new_member(),
  public.community_comment_before_insert(), public.community_like_before_insert(),
  public.community_notify_post(), public.community_notify_comment(), public.community_notify_like(),
  public.community_unnotify_like(), public.community_notify_report(),
  public.build_community_card(uuid, uuid, jsonb), public.community_touch_activity(),
  public.community_touch_activity_child(),
  public.create_community_post(uuid, uuid, text, jsonb, jsonb), public.set_community_post_pinned(uuid, boolean),
  public.remove_community_member(uuid, uuid), public.restore_community_member(uuid, uuid),
  public.report_community_content(text, uuid, uuid, text), public.resolve_community_report(uuid, text),
  public.mark_community_notifications_read()
  from public, anon, authenticated;
-- Policies (and storage policies) run as the caller, so they need the helpers.
grant execute on function
  public.can_view_community(uuid), public.has_blocked(uuid, uuid), public.can_block_in_community(uuid, uuid),
  public.can_upload_community_image(text), public.can_read_community_image(text),
  public.create_community_post(uuid, uuid, text, jsonb, jsonb), public.set_community_post_pinned(uuid, boolean),
  public.remove_community_member(uuid, uuid), public.restore_community_member(uuid, uuid),
  public.report_community_content(text, uuid, uuid, text), public.resolve_community_report(uuid, text),
  public.mark_community_notifications_read()
  to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Table privileges: nothing for anon; the API reads, and writes only through narrow column grants and the functions.
-- ---------------------------------------------------------------------------------------------------------------

revoke all on table public.communities, public.community_members, public.community_posts, public.community_post_images,
  public.community_comments, public.community_likes, public.community_blocks, public.community_reports,
  public.community_notifications
  from anon, authenticated, service_role;
grant select on public.communities, public.community_members, public.community_posts, public.community_post_images,
  public.community_comments, public.community_likes, public.community_blocks, public.community_reports,
  public.community_notifications
  to authenticated;
grant insert (post_id, body) on public.community_comments to authenticated;
grant insert (post_id) on public.community_likes to authenticated;
grant insert (workspace_id, blocked_id) on public.community_blocks to authenticated;
grant delete on public.community_posts, public.community_comments, public.community_likes, public.community_blocks
  to authenticated;
grant update (read_at) on public.community_notifications to authenticated;
grant select, insert, update, delete on public.communities, public.community_members, public.community_posts,
  public.community_post_images, public.community_comments, public.community_likes, public.community_blocks,
  public.community_reports, public.community_notifications
  to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------------------------

alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_post_images enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes enable row level security;
alter table public.community_blocks enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_notifications enable row level security;

create policy communities_select on public.communities for select to authenticated
  using (public.can_view_community(id));

-- Members see who is in; only the coach sees who was removed.
create policy community_members_select on public.community_members for select to authenticated
  using (public.is_coach_of(workspace_id) or (removed_at is null and public.can_view_community(community_id)));

create policy community_posts_select on public.community_posts for select to authenticated
  using (public.can_view_community(community_id) and not public.has_blocked(workspace_id, author_id));
create policy community_posts_delete on public.community_posts for delete to authenticated
  using (public.is_coach_of(workspace_id)
    or (author_id = (select auth.uid()) and public.can_view_community(community_id)));

-- A photo is visible exactly when its post is (the subquery runs under the posts policy).
create policy community_post_images_select on public.community_post_images for select to authenticated
  using (exists (select 1 from public.community_posts p where p.id = post_id));

create policy community_comments_select on public.community_comments for select to authenticated
  using (public.can_view_community(community_id) and not public.has_blocked(workspace_id, author_id)
    and exists (select 1 from public.community_posts p where p.id = post_id));
create policy community_comments_insert on public.community_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_view_community(community_id));
create policy community_comments_delete on public.community_comments for delete to authenticated
  using (public.is_coach_of(workspace_id)
    or (author_id = (select auth.uid()) and public.can_view_community(community_id)));

create policy community_likes_select on public.community_likes for select to authenticated
  using (public.can_view_community(community_id) and not public.has_blocked(workspace_id, user_id));
create policy community_likes_insert on public.community_likes for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_view_community(community_id));
create policy community_likes_delete on public.community_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy community_blocks_select on public.community_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy community_blocks_insert on public.community_blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()) and public.can_block_in_community(workspace_id, blocked_id));
create policy community_blocks_delete on public.community_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

create policy community_reports_select on public.community_reports for select to authenticated
  using (public.is_coach_of(workspace_id));

create policy community_notifications_select on public.community_notifications for select to authenticated
  using (recipient_id = (select auth.uid()) and public.can_view_community(community_id)
    and (actor_id is null or not public.has_blocked(workspace_id, actor_id)));
create policy community_notifications_update on public.community_notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- Photos: private bucket, WebP (JPEG where WebP can't be written), 3 MB.
-- ---------------------------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-images', 'community-images', false, 3145728, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/webp', 'image/jpeg'];

create policy community_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'community-images' and public.can_upload_community_image(name));
create policy community_images_select on storage.objects for select to authenticated
  using (bucket_id = 'community-images'
    and (public.can_upload_community_image(name) or public.can_read_community_image(name)));
create policy community_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'community-images'
    and (split_part(name, '/', 2) = (select auth.uid())::text
      or case when split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_coach_of(split_part(name, '/', 1)::uuid) else false end));

-- ---------------------------------------------------------------------------------------------------------------
-- Realtime: idempotent, and a no-op where the publication does not exist. Realtime checks each INSERT/UPDATE against
-- the subscriber's SELECT policies. The apps never listen to DELETE events (they can't be filtered or checked):
-- deletes bump communities.activity_at instead.
-- ---------------------------------------------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['communities', 'community_posts', 'community_comments', 'community_likes', 'community_notifications',
      'community_reports'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
