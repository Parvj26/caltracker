import type { SupabaseClient } from '@supabase/supabase-js';

export interface StorageObject {
  bucket_id: string;
  name: string;
}

const CHUNK = 100;

/**
 * Removes files through the Storage API (never SQL on storage.objects, which would leave the files behind).
 * Groups by bucket, 100 names per call. Throws on the first error so the caller does not delete the account and a
 * retry can finish the job (removing a file that is already gone is not an error).
 */
export async function purgeStorage(
  admin: SupabaseClient,
  objects: StorageObject[],
): Promise<{ removed: number }> {
  const byBucket = new Map<string, string[]>();
  for (const o of objects) {
    const names = byBucket.get(o.bucket_id) ?? [];
    names.push(o.name);
    byBucket.set(o.bucket_id, names);
  }
  let removed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += CHUNK) {
      const chunk = names.slice(i, i + CHUNK);
      const { error } = await admin.storage.from(bucket).remove(chunk);
      if (error) throw new Error(`Could not remove files from ${bucket}: ${error.message}`);
      removed += chunk.length;
    }
  }
  return { removed };
}
