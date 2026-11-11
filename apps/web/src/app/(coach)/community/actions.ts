'use server';

import { revalidatePath } from 'next/cache';
import { COMMUNITY_BUCKET, CommentInput, MAX_POST_PHOTOS, PostInput, codeForMessage, isReactionKey, type Database, type ReactionKey } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Every write goes through the coach's own session, so the database (RLS and the community functions) decides what
// is allowed; these only add friendly messages.

type Tables = Database['public']['Tables'];

export type CommunityOutcome = { ok: true } | ActionFailure;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const done = (): CommunityOutcome => {
  revalidatePath('/community', 'layout');
  return { ok: true };
};

export type NewPostImage = { path: string; thumbPath: string; width: number; height: number };

/** Posts as the coach. The photos were shrunk and uploaded by the browser into the coach's folder for this post. */
export async function createPost(input: { postId: string; communityId: string; body: string; images: NewPostImage[] }): Promise<CommunityOutcome> {
  await requireCoach();
  if (!UUID.test(input.postId) || !UUID.test(input.communityId)) return fail('server_error', 'action:community.createPost');
  const images = Array.isArray(input.images) ? input.images.slice(0, MAX_POST_PHOTOS + 1) : [];
  const parsed = PostInput.safeParse({ body: input.body, photoCount: images.length, card: null });
  if (!parsed.success) return fail(codeForMessage(parsed.error.issues[0]?.message, 'field_format'), 'action:community.createPost');
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('create_community_post', {
    p_id: input.postId,
    p_community_id: input.communityId,
    p_body: parsed.data.body,
    p_images: images.map((i) => ({ path: i.path, thumbPath: i.thumbPath, width: i.width, height: i.height })),
  });
  if (error) return fail('post_save_failed', 'action:community.createPost');
  return done();
}

/** Deletes a post (any post: the coach moderates) and then its photo files. */
export async function deletePost(postId: string): Promise<CommunityOutcome> {
  await requireCoach();
  if (!UUID.test(postId)) return fail('server_error', 'action:community.deletePost');
  const supabase = await createServerSupabase();
  const images = await supabase.from('community_post_images').select('path, thumb_path').eq('post_id', postId);
  const { error, count } = await supabase.from('community_posts').delete({ count: 'exact' }).eq('id', postId);
  if (error || count === 0) return fail('post_delete_failed', 'action:community.deletePost');
  await removeFiles(supabase, (images.data ?? []).flatMap((i) => [i.path, i.thumb_path]));
  return done();
}

async function removeFiles(supabase: Awaited<ReturnType<typeof createServerSupabase>>, paths: string[]) {
  // Best effort: nothing points at the files any more, and the bucket is private.
  if (paths.length) await supabase.storage.from(COMMUNITY_BUCKET).remove(paths);
}

export async function setPinned(postId: string, pinned: boolean): Promise<CommunityOutcome> {
  await requireCoach();
  if (!UUID.test(postId)) return fail('server_error', 'action:community.setPinned');
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('set_community_post_pinned', { p_post_id: postId, p_pinned: pinned });
  if (error) return fail(pinned ? 'post_pin_failed' : 'post_unpin_failed', 'action:community.setPinned');
  return done();
}

export async function addComment(postId: string, body: string): Promise<CommunityOutcome> {
  await requireCoach();
  if (!UUID.test(postId)) return fail('server_error', 'action:community.addComment');
  const parsed = CommentInput.safeParse(body);
  if (!parsed.success) return fail(codeForMessage(parsed.error.issues[0]?.message, 'field_format'), 'action:community.addComment');
  const supabase = await createServerSupabase();
  // author, community and workspace are filled in by the database (the generated Insert type still lists them).
  const row = { post_id: postId, body: parsed.data } as Tables['community_comments']['Insert'];
  const { error } = await supabase.from('community_comments').insert(row);
  if (error) return fail('comment_save_failed', 'action:community.addComment');
  return done();
}

export async function deleteComment(commentId: string): Promise<CommunityOutcome> {
  await requireCoach();
  if (!UUID.test(commentId)) return fail('server_error', 'action:community.deleteComment');
  const supabase = await createServerSupabase();
  const { error, count } = await supabase.from('community_comments').delete({ count: 'exact' }).eq('id', commentId);
  if (error || count === 0) return fail('comment_delete_failed', 'action:community.deleteComment');
  return done();
}

export type ReactionTarget = { postId: string } | { commentId: string };

/** Adds (on) or takes back (off) one of the coach's reactions on a post or a comment. */
export async function setReaction(target: ReactionTarget, reaction: ReactionKey, on: boolean): Promise<CommunityOutcome> {
  const coach = await requireCoach();
  const postId = 'postId' in target ? target.postId : null;
  const commentId = 'commentId' in target ? target.commentId : null;
  if (!isReactionKey(reaction) || !UUID.test(postId ?? commentId ?? '')) return fail('server_error', 'action:community.setReaction');
  const supabase = await createServerSupabase();
  if (on) {
    // Who and where (and a comment's post) are filled in by the database; the generated Insert type still lists them.
    type Insert = Tables['community_reactions']['Insert'];
    const row = (commentId ? { comment_id: commentId, reaction } : { post_id: postId!, reaction }) as Partial<Insert> as Insert;
    const { error } = await supabase.from('community_reactions').insert(row);
    // Already there (a double click) is fine.
    if (error && error.code !== '23505') return fail('reaction_add_failed', 'action:community.setReaction');
  } else {
    let del = supabase.from('community_reactions').delete().eq('user_id', coach.userId).eq('reaction', reaction);
    del = commentId ? del.eq('comment_id', commentId) : del.eq('post_id', postId!).is('comment_id', null);
    const { error } = await del;
    if (error) return fail('reaction_remove_failed', 'action:community.setReaction');
  }
  return done();
}

/** Takes a client out of the community only (they stay a client), or lets them back in. */
export async function setMemberRemoved(communityId: string, userId: string, removed: boolean): Promise<CommunityOutcome> {
  await requireCoach();
  if (!UUID.test(communityId) || !UUID.test(userId)) return fail('server_error', 'action:community.setMemberRemoved');
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc(removed ? 'remove_community_member' : 'restore_community_member', {
    p_community_id: communityId,
    p_user_id: userId,
  });
  if (error) return fail(removed ? 'member_remove_failed' : 'member_restore_failed', 'action:community.setMemberRemoved');
  return done();
}

/** Closes a report: 'removed' deletes the reported post or comment (and a post's photos), 'kept' leaves it. */
export async function resolveReport(reportId: string, resolution: 'removed' | 'kept'): Promise<CommunityOutcome> {
  await requireCoach();
  if (!UUID.test(reportId) || (resolution !== 'removed' && resolution !== 'kept')) return fail('server_error', 'action:community.resolveReport');
  const supabase = await createServerSupabase();
  let files: string[] = [];
  if (resolution === 'removed') {
    const report = await supabase.from('community_reports').select('target_kind, post_id').eq('id', reportId).maybeSingle();
    if (report.data?.target_kind === 'post' && report.data.post_id) {
      const images = await supabase.from('community_post_images').select('path, thumb_path').eq('post_id', report.data.post_id);
      files = (images.data ?? []).flatMap((i) => [i.path, i.thumb_path]);
    }
  }
  const { error } = await supabase.rpc('resolve_community_report', { p_report_id: reportId, p_resolution: resolution });
  if (error) return fail('report_update_failed', 'action:community.resolveReport');
  await removeFiles(supabase, files);
  return done();
}
