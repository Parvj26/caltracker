'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DIRECTION_LABELS,
  DOSE_LIMITS,
  LIBRARY_TRACKING_TYPES,
  MUSCLE_GROUPS,
  buildExerciseIndex,
  isMuscleId,
  searchExercises,
  type CorrectiveDirection,
  type ErrorCode,
  type ExerciseIndexRow,
  type LibraryTrackingType,
  type MuscleId,
  type MuscleTag,
} from '@caltracker/shared';
import { AdaptiveDialog, Button, ErrorText, SearchBox, SelectField, TextField, type AdaptiveDialogHandle } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { BodyMap } from '@/components/body-map/body-map';
import { regionKey, type RegionStates } from '@/components/body-map/state';
import { TRACKING_LABELS } from '@/app/(coach)/exercises/filters';
import { quickCreateExercise, setExercisePhotos } from '@/app/(coach)/exercises/actions';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { invalidateExerciseIndex, loadExerciseIndex } from '@/lib/exercise-index';
import { PhotoError } from '@/lib/image-resize';
import { PhotoTooLargeError, uploadExercisePhoto } from '@/lib/exercise-photos';
import { bothSides, muscleTagLabel, tagsByMuscle, toggleTag, type LibraryItem } from '@/lib/corrective-library';
import { deleteCorrective, saveCorrective } from './actions';
import { CorrectiveSummary } from './parts';
import styles from './corrective.module.css';

export type DialogStart =
  | { step: 'view'; item: LibraryItem }
  | { step: 'edit'; item: LibraryItem | null }
  | { step: 'delete'; item: LibraryItem };

type Step = 'view' | 'edit' | 'delete';

const NO_FILTERS = { muscles: [], equipment: [], customOnly: false };
const NO_BOOSTS = { favourites: new Set<string>(), recent: [] as string[] };

/**
 * One pop-up for a corrective exercise (board AS8), in steps so no dialog opens another (UI rules §5.4):
 *   view    what it is (phone and iPad; desktop shows this beside the list), with Edit / Make it yours and Delete…
 *   edit    add or change: the exercise (a new one, or one from the library), Underactive / Overactive, the muscle
 *           groups and sides (tap the body map or pick from the list), and the default sets × reps or seconds
 *   delete  "Delete … from your corrective exercises?" (the exercise stays in the library)
 * A built-in default is never changed: Make it yours saves the coach's own copy of its tags, which then wins.
 */
export function CorrectiveDialog({
  start,
  workspaceId,
  builtins,
  onClose,
  onSaved,
}: {
  start: DialogStart;
  workspaceId: string;
  /** The built-in defaults, to fill the form when the coach picks one of their exercises. */
  builtins: readonly LibraryItem[];
  onClose: () => void;
  /** After a save or delete, with the key of the item to show (null after a delete). */
  onSaved: (key: string | null) => void;
}) {
  const router = useRouter();
  const ref = useRef<AdaptiveDialogHandle>(null);
  const [step, setStep] = useState<Step>(start.step);
  const item = start.item;
  const editing = item?.yours ? item : null;
  const deleteBodyId = useId();

  // ----- form state -----
  const fixed = item ? { id: item.exerciseId, name: item.name } : null;
  const [source, setSource] = useState<'new' | 'library'>('new');
  const [name, setName] = useState('');
  const [tracking, setTracking] = useState<LibraryTrackingType>('reps');
  const [photo, setPhoto] = useState<File | null>(null);
  const [picked, setPicked] = useState<ExerciseIndexRow | null>(null);
  const [direction, setDirection] = useState<CorrectiveDirection>(item?.direction ?? 'under');
  const [muscles, setMuscles] = useState<MuscleTag[]>(item ? [...item.muscles] : []);
  const [sets, setSets] = useState(String(item?.dose.sets ?? 2));
  const [kind, setKind] = useState<'reps' | 'seconds'>(item?.dose.seconds != null ? 'seconds' : 'reps');
  const [amount, setAmount] = useState(String(item?.dose.reps ?? item?.dose.seconds ?? ''));
  const [eachSide, setEachSide] = useState(item?.dose.eachSide ?? false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: ErrorCode; text?: string } | null>(null);
  const [taken, setTaken] = useState<{ id: string; name: string } | null>(null);
  // A new exercise made by an earlier try (the corrective save failed after): a retry reuses it.
  const created = useRef<{ id: string; name: string; photoSaved: boolean } | null>(null);
  const touch = () => setDirty(true);

  // ----- from library -----
  const [libQuery, setLibQuery] = useState('');
  const [rows, setRows] = useState<ExerciseIndexRow[] | null>(null);
  const [libFailed, setLibFailed] = useState(false);
  const needLibrary = step === 'edit' && !fixed && source === 'library';
  useEffect(() => {
    if (!needLibrary || rows) return;
    let live = true;
    loadExerciseIndex(createBrowserSupabase(), workspaceId)
      .then((r) => live && setRows(r.index))
      .catch(() => live && setLibFailed(true));
    return () => {
      live = false;
    };
  }, [needLibrary, rows, workspaceId]);
  const index = useMemo(() => (rows ? buildExerciseIndex(rows) : null), [rows]);
  const hits = useMemo(() => {
    if (!index) return [];
    const seen = new Set<string>();
    const out: ExerciseIndexRow[] = [];
    for (const h of searchExercises(index, libQuery, NO_FILTERS, NO_BOOSTS)) {
      if (seen.has(h.row.id)) continue;
      seen.add(h.row.id);
      out.push(h.row);
      if (out.length === 6) break;
    }
    return out;
  }, [index, libQuery]);

  function pick(row: ExerciseIndexRow) {
    setPicked(row);
    touch();
    // A built-in default for it: start from its tags, unless the coach already set some.
    const b = builtins.find((x) => x.exerciseId === row.id);
    if (b && muscles.length === 0) {
      setDirection(b.direction);
      setMuscles([...b.muscles]);
      setSets(String(b.dose.sets));
      setKind(b.dose.seconds != null ? 'seconds' : 'reps');
      setAmount(String(b.dose.reps ?? b.dose.seconds ?? ''));
      setEachSide(b.dose.eachSide);
    } else if ((row.trackingType === 'time' || row.trackingType === 'weight_time') && amount === '') setKind('seconds');
  }

  // ----- checks -----
  const setsN = Number(sets);
  const amountN = amount.trim() === '' ? null : Number(amount);
  const max = kind === 'reps' ? DOSE_LIMITS.reps : DOSE_LIMITS.seconds;
  const exerciseReason =
    fixed ? null
    : source === 'new' ? (name.trim() === '' ? 'Give the exercise a name' : null)
    : picked ? null
    : 'Pick an exercise';
  const reason =
    exerciseReason ??
    (muscles.length === 0 ? 'Pick at least one muscle group'
    : !Number.isInteger(setsN) || setsN < 1 || setsN > DOSE_LIMITS.sets ? `Sets: 1 to ${DOSE_LIMITS.sets}`
    : amountN !== null && (!Number.isInteger(amountN) || amountN < 1 || amountN > max) ? `${kind === 'reps' ? 'Reps' : 'Seconds'}: 1 to ${max}`
    : null);

  async function save() {
    if (reason || pending) return;
    setPending(true);
    setError(null);
    setTaken(null);
    try {
      let exerciseId = fixed?.id ?? (source === 'library' ? picked?.id : created.current?.id) ?? null;
      if (!exerciseId) {
        const out = await quickCreateExercise({ name, trackingType: tracking });
        if (!out.ok) {
          setError({ code: out.code });
          if (out.existing) setTaken(out.existing);
          return;
        }
        created.current = { id: out.id, name: out.name, photoSaved: false };
        exerciseId = out.id;
      }
      if (source === 'new' && !fixed && photo && created.current && !created.current.photoSaved) {
        const path = await uploadExercisePhoto(workspaceId, exerciseId, photo);
        const saved = await setExercisePhotos(exerciseId, [path]);
        if (!saved.ok) {
          setError({ code: saved.code });
          return;
        }
        created.current.photoSaved = true;
      }
      const out = await saveCorrective({
        id: editing?.correctiveId ?? null,
        exerciseId,
        direction,
        muscles,
        dose: { sets: setsN, reps: kind === 'reps' ? amountN : null, seconds: kind === 'seconds' ? amountN : null, eachSide },
      });
      if (!out.ok) {
        setError({ code: out.code });
        return;
      }
      invalidateExerciseIndex();
      onSaved(`c:${out.id}`);
      router.refresh();
      await ref.current?.close();
    } catch (e) {
      setError(e instanceof PhotoTooLargeError ? { code: 'exercise_photo_too_large' } : e instanceof PhotoError ? { code: 'photo_prepare_failed', text: e.message } : { code: 'corrective_save_failed' });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!item?.correctiveId || pending) return;
    setPending(true);
    setError(null);
    const out = await deleteCorrective(item.correctiveId);
    setPending(false);
    if (!out.ok) {
      setError({ code: out.code });
      return;
    }
    onSaved(null);
    router.refresh();
    await ref.current?.close();
  }

  // ----- body map -----
  const states: RegionStates = {};
  for (const t of muscles) states[regionKey(t.muscleId, t.side)] = direction;
  const onMap = (id: string, side: 'L' | 'R' | 'none') => {
    if (!isMuscleId(id)) return;
    setMuscles((m) => toggleTag(m, id, id === 'abs' ? 'none' : side));
    touch();
  };
  const toggleMuscle = (id: MuscleId) => {
    setMuscles((m) => (m.some((t) => t.muscleId === id) ? m.filter((t) => t.muscleId !== id) : [...m, ...bothSides(id)]));
    touch();
  };

  const title =
    step === 'delete' ? `Delete “${item?.name ?? ''}”?`
    : step === 'view' ? (item?.name ?? 'Corrective exercise')
    : editing ? 'Edit corrective exercise'
    : item ? 'Make it yours'
    : 'Corrective exercise';

  const footer =
    step === 'view' && item ? (
      item.yours ? (
        <Button variant="primary" onClick={() => setStep('edit')}>
          Edit
        </Button>
      ) : (
        <Button variant="primary" onClick={() => setStep('edit')}>
          Make it yours
        </Button>
      )
    ) : step === 'delete' ? (
      <>
        <Button variant="secondary" onClick={() => (start.step === 'delete' ? ref.current?.requestClose() : setStep('view'))} disabled={pending} phSafe>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => void remove()} pending={pending} phSafe>
          {pending ? 'Deleting…' : 'Delete'}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={() => ref.current?.requestClose()} disabled={pending} phSafe>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void save()} pending={pending} disabled={reason !== null} disabledReason={reason ?? undefined} phSafe>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </>
    );

  return (
    <AdaptiveDialog
      ref={ref}
      historyId="corrective"
      title={title}
      {...(step === 'edit' ? { subtitle: 'Library' } : {})}
      onClose={onClose}
      dirty={step === 'edit' && dirty}
      busy={pending}
      size={step === 'edit' ? 'wide' : 'medium'}
      role={step === 'delete' ? 'alertdialog' : 'dialog'}
      {...(step === 'delete' ? { describedBy: deleteBodyId } : {})}
      stackFooterOnPhone={step === 'delete'}
      fullScreenOnPhone={step === 'edit'}
      noKeyboardOnTouch
      footer={footer}
    >
      {step === 'view' && item ? (
        <div className={styles.viewStep}>
          <CorrectiveSummary item={item} headingLevel={3} />
          {item.yours ? (
            <button type="button" className={styles.dangerText} onClick={() => setStep('delete')}>
              Delete from corrective exercises…
            </button>
          ) : null}
        </div>
      ) : null}

      {step === 'delete' && item ? (
        <div className={styles.viewStep}>
          <p id={deleteBodyId}>
            It comes off your corrective exercises and won’t be suggested in assessments. The exercise itself stays in your library.
          </p>
          {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
        </div>
      ) : null}

      {step === 'edit' ? (
        <form
          className={styles.form}
          aria-label="Corrective exercise"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {/* The exercise */}
          {fixed ? (
            <div className={styles.field}>
              <p className={styles.label}>Exercise</p>
              <p className={styles.fixedName}>{fixed.name}</p>
            </div>
          ) : (
            <>
              <div className={styles.segment} role="group" aria-label="Exercise">
                {(['new', 'library'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={cx(styles.segmentButton, source === s && styles.segmentOn)}
                    aria-pressed={source === s}
                    onClick={() => setSource(s)}
                  >
                    {s === 'new' ? 'New exercise' : 'From library'}
                  </button>
                ))}
              </div>
              {source === 'new' ? (
                <div className={styles.newExercise}>
                  <TextField
                    label="Name"
                    value={name}
                    maxLength={100}
                    autoComplete="off"
                    onChange={(e) => {
                      setName(e.target.value);
                      created.current = null;
                      touch();
                    }}
                  />
                  <SelectField label="Tracking" value={tracking} onChange={(e) => {
                      const t = e.target.value as LibraryTrackingType;
                      setTracking(t);
                      if (amount === '') setKind(t === 'time' || t === 'weight_time' ? 'seconds' : 'reps');
                      touch();
                    }}>
                    {LIBRARY_TRACKING_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TRACKING_LABELS[t]}
                      </option>
                    ))}
                  </SelectField>
                  <PhotoPicker file={photo} onChange={(f) => (setPhoto(f), touch())} />
                </div>
              ) : (
                <div className={styles.libraryPick}>
                  <SearchBox value={libQuery} onChange={setLibQuery} label="Search exercises" placeholder="Search exercises" />
                  {libFailed ? <ErrorText code="request_invalid">Couldn’t load your exercises. Close and try again.</ErrorText> : null}
                  {rows === null && !libFailed ? <p className={styles.muted}>Loading exercises…</p> : null}
                  {rows !== null && hits.length === 0 ? <p className={styles.muted}>No exercises match “{libQuery.trim()}”</p> : null}
                  <ul className={styles.pickList} aria-label="Exercises">
                    {hits.map((r) => (
                      <li key={r.id}>
                        <label className={cx(styles.pickRow, picked?.id === r.id && styles.pickRowOn)}>
                          <input type="radio" name="corrective-exercise" checked={picked?.id === r.id} onChange={() => pick(r)} className={styles.pickRadio} />
                          <span className={styles.pickText}>
                            <span className={styles.pickName}>{r.name}</span>
                            <span className={styles.muted}>
                              {r.source === 'custom' ? 'Yours' : 'Built-in'}
                              {r.primaryMuscles[0] ? ` · ${r.primaryMuscles[0].charAt(0).toUpperCase()}${r.primaryMuscles[0].slice(1)}` : ''}
                            </span>
                          </span>
                          {picked?.id === r.id ? <span className={styles.pickTick} aria-hidden="true">✓</span> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                  {picked && !hits.some((h) => h.id === picked.id) ? <p className={styles.pickedLine}>Picked: {picked.name}</p> : null}
                </div>
              )}
            </>
          )}

          {/* For */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>For</legend>
            <div className={styles.dirChoices}>
              {(['under', 'over'] as const).map((d) => (
                <label key={d} className={cx(styles.dirChoice, direction === d && styles.dirChoiceOn)}>
                  <input type="radio" name="corrective-direction" checked={direction === d} onChange={() => (setDirection(d), touch())} className={styles.pickRadio} />
                  <span className={cx(styles.dirSwatch, d === 'under' ? styles.dirUnder : styles.dirOver)} aria-hidden="true" />
                  <span className={styles.pickText}>
                    <span className={styles.pickName}>{DIRECTION_LABELS[d].long}</span>
                    <span className={styles.muted}>{DIRECTION_LABELS[d].action}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Muscle groups */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>Muscle groups</legend>
            <p className={styles.muted}>Tap muscles on the map (each side on its own), or pick from the list.</p>
            <div className={styles.maps}>
              <BodyMap view="front" label="Front of body" states={states} onSelect={onMap} size="medium" />
              <BodyMap view="back" label="Back of body" states={states} onSelect={onMap} size="medium" />
            </div>
            {muscles.length > 0 ? (
              <ul className={styles.tagList} aria-label="Picked muscle groups">
                {tagsByMuscle(muscles).map((g) => (
                  <li key={g.muscleId} className={styles.tag}>
                    <span className={styles.tagName}>{muscleTagLabel(g.muscleId, [])}</span>
                    {g.muscleId !== 'abs'
                      ? (['L', 'R'] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={styles.sideButton}
                            aria-pressed={g.sides.includes(s)}
                            aria-label={`${s === 'L' ? 'Left' : 'Right'} side`}
                            onClick={() => onMap(g.muscleId, s)}
                          >
                            {s}
                          </button>
                        ))
                      : null}
                    <button type="button" className={styles.tagRemove} aria-label={`Remove ${muscleTagLabel(g.muscleId, [])}`} onClick={() => toggleMuscle(g.muscleId)}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <details className={styles.listPick}>
              <summary>Pick from the list</summary>
              <div className={styles.muscleGrid} role="group" aria-label="Muscle group list">
                {MUSCLE_GROUPS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={styles.filterChip}
                    aria-pressed={muscles.some((t) => t.muscleId === m.id)}
                    onClick={() => isMuscleId(m.id) && toggleMuscle(m.id)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </details>
          </fieldset>

          {/* Default dose */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>Default dose</legend>
            <div className={styles.doseRow}>
              <TextField label="Sets" type="number" inputMode="numeric" min={1} max={DOSE_LIMITS.sets} value={sets} onChange={(e) => (setSets(e.target.value), touch())} className={styles.doseField} />
              <div className={styles.doseKind}>
                <div className={styles.segment} role="group" aria-label="Count">
                  {(['reps', 'seconds'] as const).map((k) => (
                    <button key={k} type="button" className={cx(styles.segmentButton, kind === k && styles.segmentOn)} aria-pressed={kind === k} onClick={() => (setKind(k), touch())}>
                      {k === 'reps' ? 'Reps' : 'Seconds'}
                    </button>
                  ))}
                </div>
              </div>
              <TextField
                label={kind === 'reps' ? 'Reps (optional)' : 'Seconds (optional)'}
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                value={amount}
                onChange={(e) => (setAmount(e.target.value), touch())}
                className={styles.doseField}
              />
            </div>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={eachSide} onChange={(e) => (setEachSide(e.target.checked), touch())} />
              Each side
            </label>
          </fieldset>

          {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
          {taken ? (
            <Button
              variant="secondary"
              onClick={() => {
                setSource('library');
                setLibQuery(taken.name);
                setPicked({ id: taken.id, name: taken.name, primaryMuscles: [], secondaryMuscles: [], equipment: null, category: null, trackingType: 'reps', source: 'custom', imagePath: null });
                setTaken(null);
                setError(null);
              }}
            >
              Use “{taken.name}” instead
            </Button>
          ) : null}
        </form>
      ) : null}
    </AdaptiveDialog>
  );
}

/** "Photo (optional)": pick one, see it, replace or remove it. Photos only (no video). */
function PhotoPicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <div className={styles.field}>
      <p className={styles.label}>Photo (optional)</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className={styles.file}
        tabIndex={-1}
        aria-hidden="true"
        data-testid="corrective-photo-input"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <div className={styles.photoRow}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL)
          <img src={url} alt="Chosen photo" className={styles.thumb} />
        ) : null}
        <Button variant="secondary" size="compact" onClick={() => inputRef.current?.click()}>
          {file ? 'Replace' : '+ Add photo'}
        </Button>
        {file ? (
          <Button
            variant="quiet"
            size="compact"
            onClick={() => {
              onChange(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
          >
            Remove
          </Button>
        ) : null}
      </div>
      <p className={styles.muted}>The start position. Add an end photo on the exercise page.</p>
    </div>
  );
}
