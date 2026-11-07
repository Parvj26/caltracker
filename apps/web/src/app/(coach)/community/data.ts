import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMUNITY_BUCKET, isReactionKey, memberName, parseCard, sortFeed, type CommunityCard, type Database, type ReactionRow } from '@caltracker/shared';

// Reads the coach's community under their own session (RLS): only their workspace, nothing else.

type Db = SupabaseClient<Database>;
const SIGNED_URL_SECONDS = 60 * 60;
export const FEED_SIZE = 50;

export type FeedImage = { id: string; thumbUrl: string | null; fullUrl: string | null; width: number; height: number };
export type FeedComment = { id: string; authorId: string; authorName: string; body: string; createdAt: string; reactions: ReactionRow[] };
export type FeedPost = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorIsCoach: boolean;
  body: string;
  card: CommunityCard | null;
  createdAt: string;
  pinnedAt: string | null;
  images: FeedImage[];
  /** Reactions to the post itself (not its comments). */
  reactions: ReactionRow[];
  comments: FeedComment[];
};
export type Member = { userId: string; name: string; role: 'coach' | 'client'; removedAt: string | null; avatarUrl: string | null };

const POST_SELECT = `id, author_id, body, card, created_at, pinned_at,
  author:profiles(first_name, last_name, avatar_path),
  images:community_post_images(id, position, path, thumb_path, width, height),
  reactions:community_reactions(user_id, comment_id, reaction, created_at, reactor:profiles(first_name, last_name)),
  comments:community_comments(id, author_id, body, created_at, author:profiles(first_name, last_name),
    reactions:community_reactions(user_id, reaction, created_at, reactor:profiles(first_name, last_name)))`;

type ReactionSelect = { user_id: string; reaction: string; created_at: string; reactor: { first_name: string; last_name: string } | null };

/** Rows for the reaction bar; "Former member" when the name no longer resolves. */
const toReactionRows = (rows: readonly ReactionSelect[]): ReactionRow[] =>
  rows.flatMap((r) =>
    isReactionKey(r.reaction)
      ? [
          {
            userId: r.user_id,
            reaction: r.reaction,
            createdAt: r.created_at,
            name: memberName(r.reactor ? { firstName: r.reactor.first_name, lastName: r.reactor.last_name } : null),
          },
        ]
      : [],
  );

async function signAll(supabase: Db, bucket: string, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_SECONDS);
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

const avatarThumb = (path: string) => path.replace(/avatar\.(webp|jpg)$/, 'avatar-thumb.$1');

export async function loadCommunity(supabase: Db, workspaceId: string) {
  const community = await supabase.from('communities').select('id, name').eq('workspace_id', workspaceId).eq('is_default', true).maybeSingle();
  if (community.error) throw new Error(`Could not load the community: ${community.error.message}`);
  if (!community.data) return null;
  const communityId = community.data.id;

  const [posts, members, openReports] = await Promise.all([
    supabase.from('community_posts').select(POST_SELECT).eq('community_id', communityId).order('created_at', { ascending: false }).limit(FEED_SIZE),
    supabase.from('community_members').select('user_id, role, removed_at').eq('community_id', communityId),
    supabase.from('community_reports').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).is('resolved_at', null),
  ]);
  if (posts.error) throw new Error(`Could not load posts: ${posts.error.message}`);
  if (members.error) throw new Error(`Could not load members: ${members.error.message}`);
  // Pinned posts older than the newest 50 still show at the top.
  const pinned = await supabase.from('community_posts').select(POST_SELECT).eq('community_id', communityId).not('pinned_at', 'is', null);
  if (pinned.error) throw new Error(`Could not load pinned posts: ${pinned.error.message}`);
  const rows = new Map([...posts.data, ...pinned.data].map((p) => [p.id, p]));

  const memberIds = members.data.map((m) => m.user_id);
  const profiles = memberIds.length
    ? await supabase.from('profiles').select('id, first_name, last_name, avatar_path').in('id', memberIds)
    : { data: [], error: null };
  if (profiles.error) throw new Error(`Could not load member names: ${profiles.error.message}`);
  const coaches = new Set(members.data.filter((m) => m.role === 'coach').map((m) => m.user_id));

  const avatarPaths = new Set<string>();
  for (const p of profiles.data) if (p.avatar_path) avatarPaths.add(avatarThumb(p.avatar_path));
  for (const p of rows.values()) if (p.author?.avatar_path) avatarPaths.add(avatarThumb(p.author.avatar_path));
  const imagePaths = [...rows.values()].flatMap((p) => p.images.flatMap((i) => [i.thumb_path, i.path]));
  const [avatars, images] = await Promise.all([signAll(supabase, 'avatars', [...avatarPaths]), signAll(supabase, COMMUNITY_BUCKET, imagePaths)]);

  const feed: FeedPost[] = sortFeed(
    [...rows.values()].map((p) => ({
      id: p.id,
      authorId: p.author_id,
      authorName: memberName(p.author ? { firstName: p.author.first_name, lastName: p.author.last_name } : null),
      authorAvatarUrl: p.author?.avatar_path ? (avatars.get(avatarThumb(p.author.avatar_path)) ?? null) : null,
      authorIsCoach: coaches.has(p.author_id),
      body: p.body,
      card: parseCard(p.card),
      createdAt: p.created_at,
      pinnedAt: p.pinned_at,
      images: [...p.images]
        .sort((a, b) => a.position - b.position)
        .map((i) => ({ id: i.id, thumbUrl: images.get(i.thumb_path) ?? null, fullUrl: images.get(i.path) ?? null, width: i.width, height: i.height })),
      reactions: toReactionRows(p.reactions.filter((r) => r.comment_id === null)),
      comments: [...p.comments]
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .map((c) => ({
          id: c.id,
          authorId: c.author_id,
          authorName: memberName(c.author ? { firstName: c.author.first_name, lastName: c.author.last_name } : null),
          body: c.body,
          createdAt: c.created_at,
          reactions: toReactionRows(c.reactions),
        })),
    })),
  );

  const names = new Map(profiles.data.map((p) => [p.id, p]));
  const memberList: Member[] = members.data
    .map((m) => {
      const p = names.get(m.user_id);
      return {
        userId: m.user_id,
        name: memberName(p ? { firstName: p.first_name, lastName: p.last_name } : null),
        role: m.role === 'coach' ? ('coach' as const) : ('client' as const),
        removedAt: m.removed_at,
        avatarUrl: p?.avatar_path ? (avatars.get(avatarThumb(p.avatar_path)) ?? null) : null,
      };
    })
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'coach' ? -1 : 1));

  return { communityId, name: community.data.name, posts: feed, members: memberList, openReports: openReports.count ?? 0 };
}

export type CommunityData = NonNullable<Awaited<ReturnType<typeof loadCommunity>>>;
