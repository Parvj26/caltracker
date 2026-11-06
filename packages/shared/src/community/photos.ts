// Community photo rules (spec §8): shrunk on the device to at most 1600 px on the long edge, plus a small thumbnail
// the feed loads; WebP, or JPEG where WebP can't be written.

export const COMMUNITY_PHOTO_MAX_EDGE = 1600;
export const COMMUNITY_THUMB_MAX_EDGE = 320;
export const COMMUNITY_BUCKET = 'community-images';

export type CommunityPhotoExt = 'webp' | 'jpg';

/** The size that fits inside a `max` px long edge, never enlarging. */
export function fitLongEdge(width: number, height: number, max: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= max) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = max / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `{workspace}/{author}/{post}/{photo}.{ext}` and its `-thumb.{ext}` (the database checks this shape). */
export function communityPhotoPaths(
  workspaceId: string,
  authorId: string,
  postId: string,
  photoId: string,
  ext: CommunityPhotoExt,
): { path: string; thumbPath: string } {
  const base = `${workspaceId}/${authorId}/${postId}/${photoId}`;
  return { path: `${base}.${ext}`, thumbPath: `${base}-thumb.${ext}` };
}

export const contentTypeFor = (ext: CommunityPhotoExt): string => (ext === 'webp' ? 'image/webp' : 'image/jpeg');
