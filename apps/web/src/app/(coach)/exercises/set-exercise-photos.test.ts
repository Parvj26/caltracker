import { beforeEach, describe, expect, it, vi } from 'vitest';

// setExercisePhotos: saves a custom exercise's photo paths after the browser uploaded them. Every path is checked on
// the server (this workspace's folder for this exercise, a uuid file, webp or jpg, at most 2), a new file must be in
// storage under its exact name, and the files of photos taken out are deleted.

const WS = '00000000-0000-4000-8000-000000000001';
const EX = '00000000-0000-4000-8000-0000000000e1';
const FOLDER = `custom/${WS}/${EX}`;
const A = `${FOLDER}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
const B = `${FOLDER}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;

let stored: string[] = [];
let inStorage: string[] = [];
const lists: { folder: string; search: string | undefined }[] = [];
const updates: unknown[] = [];
const removed: string[][] = [];

function exercises() {
  const b = {
    select: () => b,
    eq: () => b,
    maybeSingle: () => Promise.resolve({ data: { image_paths: stored }, error: null }),
    update: (row: unknown) => (updates.push(row), b),
  };
  return Object.assign(b, { select: (cols?: string) => (cols === 'id' ? Promise.resolve({ data: [{ id: EX }], error: null }) : b) });
}

const storage = {
  from: () => ({
    // Like Supabase: `search` matches names that contain the text.
    list: (folder: string, opts: { search?: string }) => {
      lists.push({ folder, search: opts.search });
      const names = inStorage.filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1));
      return Promise.resolve({ data: names.filter((n) => !opts.search || n.includes(opts.search)).map((name) => ({ name })), error: null });
    },
    remove: (paths: string[]) => (removed.push(paths), Promise.resolve({ data: [], error: null })),
  }),
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ workspaceId: WS }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve({ from: exercises, storage }) }));

import { setExercisePhotos } from './actions';

beforeEach(() => {
  stored = [];
  inStorage = [];
  lists.length = 0;
  updates.length = 0;
  removed.length = 0;
});

describe('setExercisePhotos', () => {
  it('saves a new photo once its exact file is in storage', async () => {
    inStorage = [A];
    expect(await setExercisePhotos(EX, [A])).toEqual({ ok: true });
    expect(lists).toEqual([{ folder: FOLDER, search: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp' }]);
    expect(updates).toEqual([{ image_paths: [A] }]);
  });

  it('refuses a path whose file is not in storage', async () => {
    inStorage = [];
    expect(await setExercisePhotos(EX, [A])).toMatchObject({ ok: false, code: 'exercise_photo_failed' });
    expect(updates).toEqual([]);
  });

  it('refuses paths outside this exercise, more than 2, or repeated', async () => {
    const other = `custom/${WS}/00000000-0000-4000-8000-0000000000e2/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
    expect(await setExercisePhotos(EX, [other])).toMatchObject({ ok: false, code: 'request_invalid' });
    expect(await setExercisePhotos(EX, [A, A])).toMatchObject({ ok: false, code: 'request_invalid' });
    expect(await setExercisePhotos(EX, [A, B, `${FOLDER}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp`])).toMatchObject({ ok: false, code: 'exercise_photo_limit' });
    expect(await setExercisePhotos(EX, [`${FOLDER}/../x.webp`])).toMatchObject({ ok: false, code: 'request_invalid' });
    expect(updates).toEqual([]);
  });

  it('deletes the file of a photo taken out, without looking up the photos it keeps', async () => {
    stored = [A, B];
    inStorage = [A, B];
    expect(await setExercisePhotos(EX, [A])).toEqual({ ok: true });
    expect(lists).toEqual([]);
    expect(removed).toEqual([[B]]);
  });
});
