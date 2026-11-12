'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  COACH_MEAL_LIMITS,
  COACH_MEAL_PHOTO_BUCKET,
  MACRO_KEYS,
  coachMealPhotoPaths,
  coachMealProblems,
  isAlreadyUploaded,
  parseMacroInput,
  type MacroKey,
  type MealMacros,
} from '@caltracker/shared';
import { Button, ErrorText, errorFromText, type FieldError } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { PhotoError, compressPhoto } from '@/lib/image-resize';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { removeCoachMeal, saveCoachMeal, type CoachMealInput } from './actions';
import { mealFormDirty } from './form-dirty';
import styles from './meals.module.css';

type StoredPhoto = { path: string; thumbPath: string; width: number; height: number; url: string | null };
export type MealFormValue = {
  id: string;
  name: string;
  macros: MealMacros;
  ingredients: string;
  howTo: string;
  photo: StoredPhoto | null;
};

const LABEL: Record<MacroKey, string> = { calories: 'kcal', protein: 'Protein g', carbs: 'Carbs g', fat: 'Fat g' };
const toText = (n: number | null) => (n === null ? '' : String(n));
export const DISCARD_CONFIRM = 'Discard changes?';
export const REMOVE_CONFIRM = "Remove this meal? Clients won't see it any more. Meals they already logged stay.";

async function sizeOf(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/**
 * New or edit form for a shared meal. A new photo is compressed in the browser (1600 px + 320 px thumbnail) and
 * uploaded to the meal's own files before saving; the files of a replaced or removed photo are deleted after.
 */
export function MealForm({ workspaceId, initial, isNew }: { workspaceId: string; initial: MealFormValue; isNew: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [macroText, setMacroText] = useState<Record<MacroKey, string>>({
    calories: toText(initial.macros.calories),
    protein: toText(initial.macros.protein),
    carbs: toText(initial.macros.carbs),
    fat: toText(initial.macros.fat),
  });
  const [ingredients, setIngredients] = useState(initial.ingredients);
  const [howTo, setHowTo] = useState(initial.howTo);
  const [stored, setStored] = useState<StoredPhoto | null>(initial.photo);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<FieldError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const discardRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const discardTitleId = useId();

  // The local preview's link is freed when it is replaced and when the form goes away.
  const previewRef = useRef<string | null>(null);
  function pickFile(f: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = f ? URL.createObjectURL(f) : null;
    setFile(f);
    setPreview(previewRef.current);
  }
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const shownPhoto = file ? preview : stored?.url ?? null;
  const hasPhoto = file !== null || stored !== null;

  async function uploadNew(): Promise<CoachMealInput['photo']> {
    if (!file) return stored ? { path: stored.path, thumbPath: stored.thumbPath, width: stored.width, height: stored.height } : null;
    const c = await compressPhoto(file);
    const size = await sizeOf(c.full);
    const paths = coachMealPhotoPaths(workspaceId, initial.id, crypto.randomUUID(), c.ext);
    const supabase = createBrowserSupabase();
    for (const [path, blob] of [[paths.path, c.full], [paths.thumbPath, c.thumb]] as const) {
      const { error: upErr } = await supabase.storage.from(COACH_MEAL_PHOTO_BUCKET).upload(path, blob, { contentType: c.full.type, upsert: false });
      // A retry finds the file already there: each photo has its own name, so that is this same photo.
      if (upErr && !isAlreadyUploaded(upErr)) throw new PhotoError("Couldn't upload the photo. Please try again.");
    }
    return { path: paths.path, thumbPath: paths.thumbPath, width: size.width, height: size.height };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const problems = coachMealProblems({ name, ingredients, howTo });
    for (const k of MACRO_KEYS) {
      const r = parseMacroInput(k, macroText[k]);
      if ('error' in r) problems.push(r.error);
    }
    if (problems[0]) {
      setError(errorFromText(problems[0], 'meal_details_invalid'));
      return;
    }
    setPending(true);
    try {
      const photo = await uploadNew();
      const before = initial.photo ? [initial.photo.path, initial.photo.thumbPath] : [];
      const keep = new Set(photo ? [photo.path, photo.thumbPath] : []);
      const out = await saveCoachMeal({
        id: initial.id,
        name,
        calories: macroText.calories,
        protein: macroText.protein,
        carbs: macroText.carbs,
        fat: macroText.fat,
        ingredients,
        howTo,
        photo,
        dropPaths: before.filter((p) => !keep.has(p)),
      });
      if (!out.ok) {
        setError({ code: out.code });
        return;
      }
      setSaved(true);
      if (isNew) router.push(`/meals/${initial.id}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof PhotoError ? errorFromText(err.message, 'meal_photo_failed') : { code: 'meal_save_failed' });
    } finally {
      setPending(false);
    }
  }

  const dirty = mealFormDirty(
    {
      name: initial.name,
      macroText: { calories: toText(initial.macros.calories), protein: toText(initial.macros.protein), carbs: toText(initial.macros.carbs), fat: toText(initial.macros.fat) },
      ingredients: initial.ingredients,
      howTo: initial.howTo,
      photoPath: initial.photo?.path ?? null,
      newFile: false,
    },
    { name, macroText, ingredients, howTo, photoPath: stored?.path ?? null, newFile: file !== null },
  );

  /** Back to the list without saving; asks first if anything was typed. */
  function cancel() {
    if (dirty) discardRef.current?.showModal();
    else router.push('/meals');
  }

  async function remove() {
    setPending(true);
    const out = await removeCoachMeal(initial.id);
    setPending(false);
    if (!out.ok) {
      setError({ code: out.code });
      dialogRef.current?.close();
      return;
    }
    dialogRef.current?.close();
    router.push('/meals');
    router.refresh();
  }

  return (
    // data-no-menu-button: on an iPhone the floating Menu button would sit on the sticky Save bar; Cancel leaves.
    <form className={styles.panel} aria-label={isNew ? 'New meal' : 'Edit meal'} onSubmit={(e) => void save(e)} noValidate data-no-menu-button="">
      <h2 className={styles.panelTitle}>{isNew ? 'New meal' : 'Edit meal'}</h2>

      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={COACH_MEAL_LIMITS.name + 10} required />
      </label>

      <div className={styles.photoRow}>
        {shownPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview or a short-lived signed link
          <img src={shownPhoto} alt="Meal photo" className={styles.photo} />
        ) : (
          <span className={cx(styles.photo, styles.photoEmpty)} aria-hidden="true" />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className={styles.fileInput}
          aria-label="Meal photo file"
          data-testid="coach-meal-photo-input"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f) pickFile(f);
            e.target.value = '';
          }}
        />
        <button type="button" className={styles.smallButton} onClick={() => fileRef.current?.click()}>
          {hasPhoto ? 'Change photo' : 'Add photo'}
        </button>
        {hasPhoto ? (
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => {
              pickFile(null);
              setStored(null);
            }}
          >
            Remove photo
          </button>
        ) : null}
      </div>

      <div className={styles.macros}>
        {MACRO_KEYS.map((k) => (
          <label key={k} className={styles.field}>
            <span className={styles.macroLabel}>{LABEL[k]}</span>
            <input
              className={cx(styles.input, styles.macroInput)}
              inputMode="decimal"
              value={macroText[k]}
              onChange={(e) => setMacroText((t) => ({ ...t, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Ingredients</span>
        <textarea className={styles.textarea} rows={4} value={ingredients} onChange={(e) => setIngredients(e.target.value)} maxLength={COACH_MEAL_LIMITS.ingredients} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>How to make it</span>
        <textarea className={styles.textarea} rows={3} value={howTo} onChange={(e) => setHowTo(e.target.value)} maxLength={COACH_MEAL_LIMITS.howTo} />
      </label>

      {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
      {saved && !isNew ? (
        <p role="status" className={styles.status}>
          Saved
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="submit" className={styles.save} disabled={pending} aria-busy={pending || undefined}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={styles.cancel} onClick={cancel} disabled={pending}>
          Cancel
        </button>
        {!isNew ? (
          <button type="button" className={styles.remove} onClick={() => dialogRef.current?.showModal()}>
            Remove meal
          </button>
        ) : null}
      </div>

      <dialog ref={discardRef} className={styles.dialog} aria-labelledby={discardTitleId}>
        <h2 id={discardTitleId} className={styles.dialogTitle}>
          {DISCARD_CONFIRM}
        </h2>
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => discardRef.current?.close()}>
            Keep editing
          </Button>
          <Button
            onClick={() => {
              discardRef.current?.close();
              router.push('/meals');
            }}
          >
            Discard
          </Button>
        </div>
      </dialog>

      {!isNew ? (
        <dialog
          ref={dialogRef}
          className={styles.dialog}
          aria-labelledby={titleId}
          onCancel={(e) => {
            if (pending) e.preventDefault();
          }}
        >
          <h2 id={titleId} className={styles.dialogTitle}>
            {REMOVE_CONFIRM}
          </h2>
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void remove()} pending={pending}>
              Remove meal
            </Button>
          </div>
        </dialog>
      ) : null}
    </form>
  );
}
