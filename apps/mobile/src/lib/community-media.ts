// Which profile photos the community feed needs signed links for. Pure, so it is unit tested.

/** The small copy of a profile photo, stored beside it. */
export const avatarThumb = (path: string): string => path.replace(/avatar\.(webp|jpg)$/, 'avatar-thumb.$1');

type PostAvatars = { authorAvatarPath: string | null; recentComments: readonly { authorId: string; authorAvatarPath: string | null }[] };

/**
 * Thumbnail paths for the extra photos (e.g. mine), the post authors and the comment preview's authors, once each.
 * Comments by people I blocked are left out first, so no link is ever made for them.
 */
export function feedAvatarPaths(posts: readonly PostAvatars[], extra: readonly (string | null)[], blocked: ReadonlySet<string>): string[] {
  const paths = [
    ...extra,
    ...posts.flatMap((p) => [p.authorAvatarPath, ...p.recentComments.filter((c) => !blocked.has(c.authorId)).map((c) => c.authorAvatarPath)]),
  ];
  return [...new Set(paths.filter((x): x is string => Boolean(x)).map(avatarThumb))];
}
