import { assertEquals, assertRejects } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { purgeStorage } from './purge-storage.ts';

/** A stand-in for the service-role client: records every remove() call; `fail` makes one bucket fail. */
function fakeAdmin(fail?: string) {
  const calls: { bucket: string; names: string[] }[] = [];
  const admin = {
    storage: {
      from(bucket: string) {
        return {
          remove(names: string[]) {
            calls.push({ bucket, names });
            return Promise.resolve(
              bucket === fail ? { data: null, error: new Error('storage down') } : { data: [], error: null },
            );
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

Deno.test('purgeStorage: groups by bucket and removes in chunks of 100', async () => {
  const { admin, calls } = fakeAdmin();
  const objects = [
    ...Array.from({ length: 150 }, (_, i) => ({ bucket_id: 'meal-photos', name: `ws/u/${i}.webp` })),
    { bucket_id: 'avatars', name: 'u/avatar.webp' },
  ];
  assertEquals(await purgeStorage(admin, objects), { removed: 151 });
  assertEquals(
    calls.map((c) => [c.bucket, c.names.length]),
    [['meal-photos', 100], ['meal-photos', 50], ['avatars', 1]],
  );
});

Deno.test('purgeStorage: nothing to remove makes no calls', async () => {
  const { admin, calls } = fakeAdmin();
  assertEquals(await purgeStorage(admin, []), { removed: 0 });
  assertEquals(calls.length, 0);
});

Deno.test('purgeStorage: throws when a bucket fails, so the caller keeps the account for a retry', async () => {
  const { admin } = fakeAdmin('avatars');
  await assertRejects(
    () => purgeStorage(admin, [{ bucket_id: 'avatars', name: 'u/avatar.webp' }]),
    Error,
    'avatars',
  );
});
