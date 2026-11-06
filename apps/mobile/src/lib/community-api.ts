// Server calls for the Community tab. RLS decides everything (only an active member of this client's community sees
// or writes anything, and blocked members' content never comes back); these only shape the rows for the screens.
import {
  COMMUNITY_BUCKET,
  communityPhotoPaths,
  contentTypeFor,
  memberName,
  parseCard,
  type CommunityCard,
  type Database,
  type NotificationRow,
  type ReportReason,
} from '@caltracker/shared';
import { supabase } from './supabase';
import type { PreparedPhoto } from './community-photo';

type Tables = Database['public']['Tables'];
export const FEED_SIZE = 50;
const SIGNED_URL_SECONDS = 60 * 60;

export type CommunityInfo = { id: string; workspaceId: string; name: string };
export type FeedImage = { id: string; path: string; thumbPath: string; width: number; height: number };
export type FeedComment = { id: string; authorId: string; authorName: string; body: string; createdAt: string };
export type FeedPost = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarPath: string | null;
  body: string;
  card: CommunityCard | null;
  createdAt: string;
  pinnedAt: string | null;
  images: FeedImage[];
  likerIds: string[];
  likerNames: string[];
  commentCount: number;
};

/** Friendly errors: no signal reads differently from a refusal. */
export class CommunityError extends Error {}
const OFFLINE = 'You’re offline. Check your connection and try again.';
const isNetwork = (e: { message?: string } | null) => Boolean(e?.message && /network|fetch|timed? ?out|offline/i.test(e.message));
const fail = (e: { message?: string; code?: string } | null, fallback: string): never => {
  throw new CommunityError(isNetwork(e) ? OFFLINE : fallback);
};

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new CommunityError('You are signed out. Sign in again.');
  return id;
}

/** The community of my workspace, or null when I'm not (or no longer) a member. */
export async function myCommunity(workspaceId: string): Promise<CommunityInfo | null> {
  const { data, error } = await supabase
    .from('communities')
    .select('id, workspace_id, name')
    .eq('workspace_id', workspaceId)
    .eq('is_default', true)
    .maybeSingle();
  if (error) fail(error, 'Couldn’t load the community.');
  return data ? { id: data.id, workspaceId: data.workspace_id, name: data.name } : null;
}

/** Who is a coach here (shown with a Coach label; coaches can't be blocked). */
export async function coachIds(communityId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('community_members').select('user_id').eq('community_id', communityId).eq('role', 'coach');
  if (error) fail(error, 'Couldn’t load the community.');
  return new Set((data ?? []).map((m) => m.user_id));
}

const POST_SELECT = `id, author_id, body, card, created_at, pinned_at,
  author:profiles(first_name, last_name, avatar_path),
  images:community_post_images(id, position, path, thumb_path, width, height),
  likes:community_likes(user_id, created_at, liker:profiles(first_name, last_name)),
  comments:community_comments(count)`;

type PostRow = {
  id: string;
  author_id: string;
  body: string;
  card: unknown;
  created_at: string;
  pinned_at: string | null;
  author: { first_name: string; last_name: string; avatar_path: string | null } | null;
  images: { id: string; position: number; path: string; thumb_path: string; width: number; height: number }[];
  likes: { user_id: string; created_at: string; liker: { first_name: string; last_name: string } | null }[];
  comments: { count: number }[];
};

export function toFeedPost(p: PostRow): FeedPost {
  const likes = [...p.likes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return {
    id: p.id,
    authorId: p.author_id,
    authorName: memberName(p.author ? { firstName: p.author.first_name, lastName: p.author.last_name } : null),
    authorAvatarPath: p.author?.avatar_path ?? null,
    body: p.body,
    card: parseCard(p.card),
    createdAt: p.created_at,
    pinnedAt: p.pinned_at,
    images: [...p.images].sort((a, b) => a.position - b.position).map((i) => ({ id: i.id, path: i.path, thumbPath: i.thumb_path, width: i.width, height: i.height })),
    likerIds: likes.map((l) => l.user_id),
    likerNames: likes.map((l) => memberName(l.liker ? { firstName: l.liker.first_name, lastName: l.liker.last_name } : null)),
    commentCount: p.comments[0]?.count ?? 0,
  };
}

/** The newest posts plus every pinned one. */
export async function loadFeed(communityId: string): Promise<FeedPost[]> {
  const [latest, pinned] = await Promise.all([
    supabase.from('community_posts').select(POST_SELECT).eq('community_id', communityId).order('created_at', { ascending: false }).limit(FEED_SIZE),
    supabase.from('community_posts').select(POST_SELECT).eq('community_id', communityId).not('pinned_at', 'is', null),
  ]);
  if (latest.error) fail(latest.error, 'Couldn’t load the community.');
  if (pinned.error) fail(pinned.error, 'Couldn’t load the community.');
  const rows = new Map<string, PostRow>();
  for (const r of [...(latest.data ?? []), ...(pinned.data ?? [])] as unknown as PostRow[]) rows.set(r.id, r);
  return [...rows.values()].map(toFeedPost);
}

export async function loadPost(postId: string): Promise<FeedPost | null> {
  const { data, error } = await supabase.from('community_posts').select(POST_SELECT).eq('id', postId).maybeSingle();
  if (error) fail(error, 'Couldn’t load the post.');
  return data ? toFeedPost(data) : null;
}

export async function loadComments(postId: string): Promise<FeedComment[]> {
  const { data, error } = await supabase
    .from('community_comments')
    .select('id, author_id, body, created_at, author:profiles(first_name, last_name)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) fail(error, 'Couldn’t load the comments.');
  return (data ?? []).map((c) => ({
    id: c.id,
    authorId: c.author_id,
    authorName: memberName(c.author ? { firstName: c.author.first_name, lastName: c.author.last_name } : null),
    body: c.body,
    createdAt: c.created_at,
  }));
}

/** Short-lived links for private photos (community photos and profile photos). */
export async function signedUrls(bucket: string, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_SECONDS);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

const alreadyUploaded = (e: { message?: string; statusCode?: string | number } | null) =>
  Boolean(e && (String(e.statusCode) === '409' || /already exists|duplicate/i.test(e.message ?? '')));

async function upload(path: string, uri: string, contentType: string) {
  let body: ArrayBuffer;
  try {
    body = await (await fetch(uri)).arrayBuffer();
  } catch {
    throw new CommunityError('Couldn’t read the photo. Please choose it again.');
  }
  // No overwrite (the bucket allows no updates): on a retry, the photo already there counts as uploaded.
  const { error } = await supabase.storage.from(COMMUNITY_BUCKET).upload(path, body, { contentType, upsert: false });
  if (error && !alreadyUploaded(error)) fail(error, 'Couldn’t upload a photo. Please try again.');
}

/**
 * Uploads the photos (full and thumbnail) into my folder for this post, then creates it. `postId` is made once per
 * post on the phone, so tapping Retry after a failure never posts twice.
 */
export async function createPost(input: {
  postId: string;
  community: CommunityInfo;
  body: string;
  card: CommunityCard | null;
  photos: PreparedPhoto[];
}): Promise<void> {
  const me = await myId();
  const images = [];
  for (const p of input.photos) {
    const paths = communityPhotoPaths(input.community.workspaceId, me, input.postId, p.id, p.ext);
    await upload(paths.path, p.fullUri, contentTypeFor(p.ext));
    await upload(paths.thumbPath, p.thumbUri, contentTypeFor(p.ext));
    images.push({ ...paths, width: p.width, height: p.height });
  }
  const { error } = await supabase.rpc('create_community_post', {
    p_id: input.postId,
    p_community_id: input.community.id,
    p_body: input.body,
    ...(input.card ? { p_card: input.card } : {}),
    p_images: images,
  });
  if (error) fail(error, error.code === '42501' ? 'You can’t post here any more.' : 'Couldn’t post. Please try again.');
}

export async function deletePost(post: FeedPost): Promise<void> {
  const { error, count } = await supabase.from('community_posts').delete({ count: 'exact' }).eq('id', post.id);
  if (error || count === 0) fail(error, 'Couldn’t delete the post.');
  // Best effort: nothing points at the files any more.
  const files = post.images.flatMap((i) => [i.path, i.thumbPath]);
  if (files.length) await supabase.storage.from(COMMUNITY_BUCKET).remove(files);
}

export async function setLiked(postId: string, liked: boolean): Promise<void> {
  if (liked) {
    const { error } = await supabase.from('community_likes').insert({ post_id: postId } as Tables['community_likes']['Insert']);
    if (error && error.code !== '23505') fail(error, 'Couldn’t like the post.');
    return;
  }
  const { error } = await supabase.from('community_likes').delete().eq('post_id', postId).eq('user_id', await myId());
  if (error) fail(error, 'Couldn’t remove the like.');
}

export async function addComment(postId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('community_comments')
    .insert({ post_id: postId, body } as Tables['community_comments']['Insert']);
  if (error) fail(error, 'Couldn’t add the comment.');
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error, count } = await supabase.from('community_comments').delete({ count: 'exact' }).eq('id', commentId);
  if (error || count === 0) fail(error, 'Couldn’t delete the comment.');
}

export async function report(target: { postId?: string; commentId?: string }, reason: ReportReason, note = ''): Promise<void> {
  const { error } = await supabase.rpc('report_community_content', {
    p_reason: reason,
    ...(target.postId ? { p_post_id: target.postId } : {}),
    ...(target.commentId ? { p_comment_id: target.commentId } : {}),
    p_note: note,
  });
  if (error) fail(error, 'Couldn’t send the report. Please try again.');
}

export async function loadBlocked(): Promise<Set<string>> {
  const { data, error } = await supabase.from('community_blocks').select('blocked_id');
  if (error) fail(error, 'Couldn’t load your blocked list.');
  return new Set((data ?? []).map((b) => b.blocked_id));
}

export async function block(workspaceId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('community_blocks')
    .insert({ workspace_id: workspaceId, blocked_id: userId });
  if (error && error.code !== '23505') fail(error, 'Couldn’t block them. Please try again.');
}

export async function unblock(userId: string): Promise<void> {
  const { error } = await supabase.from('community_blocks').delete().eq('blocked_id', userId);
  if (error) fail(error, 'Couldn’t unblock them.');
}

/** People I blocked, with names (for the unblock list). */
export async function blockedPeople(): Promise<{ id: string; name: string }[]> {
  const ids = [...(await loadBlocked())];
  if (ids.length === 0) return [];
  const { data } = await supabase.from('profiles').select('id, first_name, last_name').in('id', ids);
  const names = new Map((data ?? []).map((p) => [p.id, memberName({ firstName: p.first_name, lastName: p.last_name })]));
  return ids.map((id) => ({ id, name: names.get(id) ?? 'Former member' }));
}

export async function loadNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('community_notifications')
    .select('id, kind, post_id, comment_id, actor_id, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) fail(error, 'Couldn’t load notifications.');
  return (data ?? []).map((n) => ({
    id: n.id,
    kind: n.kind as NotificationRow['kind'],
    postId: n.post_id,
    commentId: n.comment_id,
    actorId: n.actor_id,
    createdAt: n.created_at,
    readAt: n.read_at,
  }));
}

export async function markNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_community_notifications_read');
  if (error) fail(error, 'Couldn’t update notifications.');
}

/** Display names for a set of people (members can read each other's names). */
export async function namesOf(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data } = await supabase.from('profiles').select('id, first_name, last_name').in('id', ids);
  const out: Record<string, string> = {};
  for (const p of data ?? []) out[p.id] = memberName({ firstName: p.first_name, lastName: p.last_name });
  return out;
}

export { myId };
