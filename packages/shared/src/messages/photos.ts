// Photo rules shared by the apps: size limits, storage paths, and the small merge/upload helpers the chat needs.

export const FULL_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 320;
export const MAX_PHOTOS = 4;

/** The size that fits `width` x `height` inside a `max` px long edge, never enlarging. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= max) return { width, height };
  const scale = max / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type PhotoExt = 'webp' | 'jpg';

/** Storage paths for one photo: `{workspace}/{conversation}/{id}.{ext}` and its `-thumb.{ext}`. */
export function photoPaths(workspaceId: string, conversationId: string, photoId: string, ext: PhotoExt = 'webp'): { full: string; thumb: string } {
  const base = `${workspaceId}/${conversationId}/${photoId}`;
  return { full: `${base}.${ext}`, thumb: `${base}-thumb.${ext}` };
}

/** The thumbnail path of a stored photo path. */
export function thumbPathOf(fullPath: string): string {
  return fullPath.replace(/\.(webp|jpg)$/, '-thumb.$1');
}

/** True for the storage error a repeated upload of the same path gives (the photo is already there: a success). */
export function isAlreadyUploaded(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  return String(e.statusCode) === '409' || String(e.status) === '409' || (typeof e.message === 'string' && /already exists/i.test(e.message));
}

/** Messages merged by id (a repeat replaces the earlier copy), oldest first. */
export function mergeById<T extends { id: string; createdAt: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
