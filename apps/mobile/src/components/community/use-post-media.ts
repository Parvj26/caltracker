import { useCallback, useEffect, useMemo, useRef } from 'react';
import { COMMUNITY_BUCKET } from '@caltracker/shared';
import { signedUrls, type FeedPost } from '@/lib/community-api';
import { avatarThumb, feedAvatarPaths } from '@/lib/community-media';
import { useSignedUrls } from './parts';


const NONE: ReadonlySet<string> = new Set();

/**
 * Signed links for the posts' photos (full size, which the feed shows, and thumbnails, the placeholders) and the
 * authors' photos (and the comment preview's authors, plus any `extraAvatarPaths`, e.g. my own for the share box). Nothing is signed for
 * comments by people in `blocked`. Links are kept and renewed only before they expire, so a re-render never reloads a photo.
 */
export function usePostMedia(posts: FeedPost[], extraAvatarPaths?: readonly (string | null)[], blocked?: ReadonlySet<string>) {
  const photoPaths = useMemo(() => posts.flatMap((p) => p.images.flatMap((i) => [i.path, i.thumbPath])), [posts]);
  const avatarPaths = useMemo(() => feedAvatarPaths(posts, extraAvatarPaths ?? [], blocked ?? NONE), [posts, extraAvatarPaths, blocked]);
  const photos = useSignedUrls(COMMUNITY_BUCKET, photoPaths);
  const avatars = useSignedUrls('avatars', avatarPaths);
  const avatarOf = useCallback((path: string | null) => (path ? (avatars[avatarThumb(path)] ?? null) : null), [avatars]);
  const avatarUrl = useCallback((p: FeedPost) => avatarOf(p.authorAvatarPath), [avatarOf]);
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
  return { photos, avatarUrl, avatarOf, fullUrl };
}
