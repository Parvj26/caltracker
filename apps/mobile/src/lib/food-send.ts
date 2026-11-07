// How one queued meal operation reaches the server, with the storage and table calls injected (food-api.ts wires
// them to Supabase), so the rules are unit tested:
// - a save uploads a new photo first (a repeated upload counts as done: each photo has its own file names), then
//   inserts the meal; a meal already there (23505: an earlier try, or an edit) is updated instead, and an update that
//   changes nothing (the meal is gone, or no longer the client's to change) is a refusal, never a silent success;
// - old photo files the meal no longer uses, and a deleted meal's files, are removed afterwards, best effort.
import type { FoodOp } from './food-queue';
import { isNetworkFailure } from './network-failure';
import { OutboxSendError } from './outbox';

export type DbError = { code?: string | undefined; message: string };

export type MealFields = {
  eaten_at: string;
  eaten_on: string;
  name: string | null;
  note: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  photo_path: string | null;
  photo_thumb_path: string | null;
  photo_width: number | null;
  photo_height: number | null;
};

export type FoodBackend = {
  deleteMeal(id: string): Promise<DbError | null>;
  insertMeal(row: MealFields & { id: string; workspace_id: string }): Promise<DbError | null>;
  /** The number of rows the update changed (RLS hides rows the caller may not change). */
  updateMeal(id: string, fields: MealFields): Promise<{ error: DbError | null; rows: number }>;
  /** Uploads a local file; resolves when it is there (also when it already was). Throws OutboxSendError. */
  upload(path: string, localValue: string, contentType: string): Promise<void>;
  /** Never throws. */
  removeQuietly(paths: string[]): Promise<void>;
};

export const SAVE_REFUSED = "Couldn't save this meal. Please try again.";
export const GONE = "This meal can't be changed any more. Discard it, or log it again.";

const fail = (error: DbError, refusal: string): OutboxSendError =>
  isNetworkFailure(error) ? new OutboxSendError('network', error.message) : new OutboxSendError('refused', refusal);

export function mealFields(op: FoodOp & { kind: 'save' }): MealFields {
  const m = op.meal;
  return {
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
}

/** Sends one queued operation. Safe to repeat. Throws OutboxSendError. */
export async function sendFoodOpWith(db: FoodBackend, op: FoodOp): Promise<void> {
  if (op.kind === 'delete') {
    const error = await db.deleteMeal(op.mealId);
    if (error) throw fail(error, "Couldn't delete this meal. Please try again.");
    await db.removeQuietly(op.dropPaths);
    return;
  }

  const m = op.meal;
  if (op.localPhoto && m.photo) {
    const type = op.localPhoto.ext === 'webp' ? 'image/webp' : 'image/jpeg';
    await db.upload(m.photo.path, op.localPhoto.fullUri, type);
    await db.upload(m.photo.thumbPath, op.localPhoto.thumbUri, type);
  }

  const fields = mealFields(op);
  const inserted = await db.insertMeal({ id: m.id, workspace_id: m.workspaceId, ...fields });
  if (inserted?.code === '23505') {
    const updated = await db.updateMeal(m.id, fields);
    if (updated.error) throw fail(updated.error, SAVE_REFUSED);
    if (updated.rows === 0) throw new OutboxSendError('refused', GONE);
  } else if (inserted) {
    if (inserted.code === '42501') throw new OutboxSendError('refused', "You can't log meals with this coach any more.");
    throw fail(inserted, SAVE_REFUSED);
  }
  await db.removeQuietly(op.dropPaths);
}
