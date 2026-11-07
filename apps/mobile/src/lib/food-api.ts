// Server calls for the Food tab. RLS limits reads to the signed-in client's own meals and targets while they are a
// client of the workspace; writes are their own meals only (the coach sets targets on the web).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MEAL_PHOTO_BUCKET, isAlreadyUploaded, type Database, type IsoDate, type MacroTargets } from '@caltracker/shared';
import { foodCachePrefix } from './device-cache-keys';
import { emptyFoodCache, parseFoodCache, withDay, withTargets, type FoodCache } from './food-logic';
import type { FoodOp, MealRecord } from './food-queue';
import { isNetworkFailure } from './network-failure';
import { OutboxSendError } from './outbox';
import { photoUri } from './outbox-files';
import { supabase } from './supabase';

type MealRow = Database['public']['Tables']['meals']['Row'];

export const FOOD_LOAD_FAILED = "Couldn't load your meals. Pull down to try again.";
const MEAL_COLUMNS =
  'id, workspace_id, eaten_at, eaten_on, name, note, calories, protein_g, carbs_g, fat_g, photo_path, photo_thumb_path, photo_width, photo_height';
const SIGNED_URL_SECONDS = 3600;

const cacheKey = (userId: string, workspaceId: string) => `${foodCachePrefix(userId)}${workspaceId}`;

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

export function toMealRecord(r: Pick<MealRow, 'id' | 'workspace_id' | 'eaten_at' | 'eaten_on' | 'name' | 'note' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'photo_path' | 'photo_thumb_path' | 'photo_width' | 'photo_height'>): MealRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    eatenAt: r.eaten_at,
    eatenOn: r.eaten_on,
    name: r.name,
    note: r.note,
    macros: { calories: num(r.calories), protein: num(r.protein_g), carbs: num(r.carbs_g), fat: num(r.fat_g) },
    photo:
      r.photo_path && r.photo_thumb_path
        ? { path: r.photo_path, thumbPath: r.photo_thumb_path, width: r.photo_width ?? 0, height: r.photo_height ?? 0 }
        : null,
  };
}

export async function readFoodCache(userId: string, workspaceId: string): Promise<FoodCache> {
  try {
    return parseFoodCache(await AsyncStorage.getItem(cacheKey(userId, workspaceId)));
  } catch {
    return emptyFoodCache();
  }
}

async function writeCache(userId: string, workspaceId: string, change: (c: FoodCache) => FoodCache): Promise<void> {
  try {
    const next = change(await readFoodCache(userId, workspaceId));
    await AsyncStorage.setItem(cacheKey(userId, workspaceId), JSON.stringify(next));
  } catch {
    // the cache is a convenience
  }
}

/** The client's meals on one of their days, and keeps a copy on the phone. */
export async function fetchMealsOn(userId: string, workspaceId: string, day: IsoDate): Promise<MealRecord[]> {
  const { data, error } = await supabase
    .from('meals')
    .select(MEAL_COLUMNS)
    .eq('client_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('eaten_on', day)
    .order('eaten_at');
  if (error) throw new Error(FOOD_LOAD_FAILED);
  const meals = data.map(toMealRecord);
  await writeCache(userId, workspaceId, (c) => withDay(c, day, meals));
  return meals;
}

/** The coach's targets for the client (null when none are set), and keeps a copy on the phone. */
export async function fetchTargets(userId: string, workspaceId: string): Promise<MacroTargets | null> {
  const { data, error } = await supabase
    .from('nutrition_targets')
    .select('calories, protein_g, carbs_g, fat_g')
    .eq('client_id', userId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw new Error(FOOD_LOAD_FAILED);
  const targets = data ? { calories: num(data.calories), protein: num(data.protein_g), carbs: num(data.carbs_g), fat: num(data.fat_g) } : null;
  await writeCache(userId, workspaceId, (c) => withTargets(c, targets));
  return targets;
}

/** Short-lived links to stored photos, by path. Missing ones are left out (the thumbnail placeholder shows). */
export async function mealPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(MEAL_PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const item of data) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}

const fail = (error: { code?: string; message: string }, refusal: string): OutboxSendError =>
  isNetworkFailure(error) ? new OutboxSendError('network', error.message) : new OutboxSendError('refused', refusal);

async function upload(path: string, uri: string, contentType: string): Promise<void> {
  let body: ArrayBuffer;
  try {
    body = await (await fetch(uri)).arrayBuffer();
  } catch {
    throw new OutboxSendError('photo', "Couldn't read the photo. Please log the meal again.");
  }
  const { error } = await supabase.storage.from(MEAL_PHOTO_BUCKET).upload(path, body, { contentType, upsert: false });
  if (error && !isAlreadyUploaded(error)) {
    if (isNetworkFailure(error)) throw new OutboxSendError('network', error.message);
    throw new OutboxSendError('photo', "Couldn't upload the photo. Please try again.");
  }
}

/** Removes stored files; never throws (a file left behind is private and harmless). */
async function removeQuietly(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(MEAL_PHOTO_BUCKET).remove(paths);
  } catch {
    // best effort
  }
}

const REFUSED = "Couldn't save this meal. Please try again.";

/** Sends one queued operation. Safe to repeat. Throws OutboxSendError. */
export async function sendFoodOp(op: FoodOp): Promise<void> {
  if (op.kind === 'delete') {
    const { error } = await supabase.from('meals').delete().eq('id', op.mealId);
    if (error) throw fail(error, "Couldn't delete this meal. Please try again.");
    await removeQuietly(op.dropPaths);
    return;
  }

  const m = op.meal;
  if (op.localPhoto && m.photo) {
    // An upload never overwrites, so a replaced photo of the same type is cleared first (also after a half-done try).
    await removeQuietly([m.photo.path, m.photo.thumbPath]);
    const type = op.localPhoto.ext === 'webp' ? 'image/webp' : 'image/jpeg';
    await upload(m.photo.path, photoUri(op.localPhoto.fullUri), type);
    await upload(m.photo.thumbPath, photoUri(op.localPhoto.thumbUri), type);
  }

  const fields = {
    eaten_at: m.eatenAt,
    eaten_on: m.eatenOn,
    name: m.name,
    note: m.note,
    calories: m.macros.calories,
    protein_g: m.macros.protein,
    carbs_g: m.macros.carbs,
    fat_g: m.macros.fat,
    photo_path: m.photo?.path ?? null,
    photo_thumb_path: m.photo?.thumbPath ?? null,
    photo_width: m.photo?.width ?? null,
    photo_height: m.photo?.height ?? null,
  };
  // client_id is filled by the database from the session (no client may set it).
  const inserted = await supabase.from('meals').insert({ id: m.id, workspace_id: m.workspaceId, ...fields });
  if (inserted.error?.code === '23505') {
    // Already there: an earlier try, or an edit. Update it instead.
    const updated = await supabase.from('meals').update(fields).eq('id', m.id).select('id');
    if (updated.error) throw fail(updated.error, REFUSED);
    if (updated.data.length === 0) throw new OutboxSendError('refused', "This meal can't be changed any more.");
  } else if (inserted.error) {
    if (inserted.error.code === '42501') throw new OutboxSendError('refused', "You can't log meals with this coach any more.");
    throw fail(inserted.error, REFUSED);
  }
  await removeQuietly(op.dropPaths);
}
