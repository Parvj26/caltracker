// The community feed's query, apart from the app's client so a test can check the request it builds.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';

/** How many comments each feed post brings along for its preview. */
export const PREVIEW_COMMENTS = 2;

export const POST_SELECT = `id, author_id, body, card, created_at, pinned_at, pinned_by,
  author:profiles(first_name, last_name, avatar_path),
  images:community_post_images(id, position, path, thumb_path, width, height),
  reactions:community_reactions(user_id, comment_id, reaction, created_at, reactor:profiles(first_name, last_name)),
  comments:community_comments(count)`;

// The feed also brings each post's newest comments (RLS on community_comments applies, so blocked members' comments
// never come back), ordered and limited per post by PostgREST (`recent.order`, `recent.limit`).
const FEED_SELECT = `${POST_SELECT},
  recent:community_comments(id, author_id, body, created_at, author:profiles(first_name, last_name, avatar_path))`;

export const feedQuery = (client: SupabaseClient<Database>, communityId: string) =>
  client
    .from('community_posts')
    .select(FEED_SELECT)
    .eq('community_id', communityId)
    .order('created_at', { referencedTable: 'recent', ascending: false })
    .limit(PREVIEW_COMMENTS, { referencedTable: 'recent' });
