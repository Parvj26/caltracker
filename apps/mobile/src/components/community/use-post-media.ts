import { useCallback, useMemo } from 'react';
import { COMMUNITY_BUCKET } from '@caltracker/shared';
import { signedUrls, type FeedPost } from '@/lib/community-api';
import { useSignedUrls } from './parts';

const avatarThumb = (path: string) => path.replace(/avatar\.(webp|jpg)$/, 'avatar-thumb.$1');

/** Signed links for the posts' thumbnails and authors' photos; the full photo is signed on tap. */
export function usePostMedia(posts: FeedPost[]) {
  const thumbPaths = useMemo(() => posts.flatMap((p) => p.images.map((i) => i.thumbPath)), [posts]);
  const avatarPaths = useMemo(
    () => [...new Set(posts.map((p) => p.authorAvatarPath).filter((x): x is string => Boolean(x)).map(avatarThumb))],
    [posts],
  );
  const thumbs = useSignedUrls(COMMUNITY_BUCKET, thumbPaths);
  const avatars = useSignedUrls('avatars', avatarPaths);
  const avatarUrl = useCallback((p: FeedPost) => (p.authorAvatarPath ? (avatars[avatarThumb(p.authorAvatarPath)] ?? null) : null), [avatars]);
  const fullUrl = useCallback(async (path: string) => (await signedUrls(COMMUNITY_BUCKET, [path]).catch((): Record<string, string> => ({})))[path] ?? null, []);
  return { thumbs, avatarUrl, fullUrl };
}
