/** Server-side checks of an uploaded photo. The browser already cropped and compressed it; this does not trust that. */

export type AvatarExt = 'webp' | 'jpg';
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
export const THUMB_MAX_BYTES = 300 * 1024;

/** Checks the file's own first bytes, not the type the browser claims. WebP is "RIFF" + 4 length bytes + "WEBP"; JPEG starts FF D8 FF. */
export async function looksLike(blob: Blob, ext: AvatarExt): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (ext === 'jpg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const text = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  return head.length === 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
}

/** True when both files are non-empty, within their size limits, and really are `ext` pictures. */
export async function acceptableAvatarFiles(avatar: Blob, thumb: Blob, ext: AvatarExt): Promise<boolean> {
  if (avatar.size === 0 || avatar.size > AVATAR_MAX_BYTES) return false;
  if (thumb.size === 0 || thumb.size > THUMB_MAX_BYTES) return false;
  return (await looksLike(avatar, ext)) && (await looksLike(thumb, ext));
}
