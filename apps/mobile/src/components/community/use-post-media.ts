import { useCallback, useEffect, useMemo, useRef } from 'react';
import { COMMUNITY_BUCKET } from '@caltracker/shared';
import { signedUrls, type FeedPost } from '@/lib/community-api';
import { useSignedUrls } from './parts';

const avatarThumb = (path: string) => path.replace(/avatar\.(webp|jpg)$/, 'avatar-thumb.$1');

/**
 * Signed links for the posts' photos (full size, which the feed shows, and thumbnails, the placeholders) and the
 * authors' photos. Links are kept and renewed only before they expire, so a re-render never reloads a photo.
 */
export function usePostMedia(posts: FeedPost[]) {
  const photoPaths = useMemo(() => posts.flatMap((p) => p.images.flatMap((i) => [i.path, i.thumbPath])), [posts]);
  const avatarPaths = useMemo(
    () => [...new Set(posts.map((p) => p.authorAvatarPath).filter((x): x is string => Boolean(x)).map(avatarThumb))],
    [posts],
  );
  const photos = useSignedUrls(COMMUNITY_BUCKET, photoPaths);
  const avatars = useSignedUrls('avatars', avatarPaths);
  const avatarUrl = useCallback((p: FeedPost) => (p.authorAvatarPath ? (avatars[avatarThumb(p.authorAvatarPath)] ?? null) : null), [avatars]);
  // Tapping a photo opens the link already made, or signs one if it isn't there yet.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  });
  const fullUrl = useCallback(
    async (path: string) =>
      photosRef.current[path] ?? (await signedUrls(COMMUNITY_BUCKET, [path]).catch((): Record<string, string> => ({})))[path] ?? null,
    [],
  );
  return { photos, avatarUrl, fullUrl };
}
