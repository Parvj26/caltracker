'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ErrorCode } from '@caltracker/shared';
import { AdaptiveDialog, Button, ErrorText, type AdaptiveDialogHandle } from '@/components/ui';
import { PhotoError } from '@/lib/image-resize';
import { MAX_EXERCISE_PHOTOS } from '@/lib/corrective-library';
import { exercisePhotoUrl, uploadExercisePhoto } from '@/lib/exercise-photos';
import { invalidateExerciseIndex } from '@/lib/exercise-index';
import { setExercisePhotos } from '../actions';
import styles from './exercise-photos.module.css';

const SLOT_NAMES = ['Start', 'End'] as const;

/**
 * Photos of one of the coach's own exercises (board AS8; photos only, no video): up to 2, the start and the end
 * position, like the built-ins. A picked photo is made smaller on the device, uploaded, then saved on the exercise
 * (the server checks the path). Removing one asks first and deletes the file.
 */
export function ExercisePhotos({ workspaceId, exerciseId, name, paths }: { workspaceId: string; exerciseId: string; name: string; paths: string[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(paths);
  const [seen, setSeen] = useState(paths);
  if (seen !== paths) {
    setSeen(paths);
    setShown(paths);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: ErrorCode; text?: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const statusId = useId();
  const [status, setStatus] = useState('');

  async function save(next: string[]): Promise<boolean> {
    const out = await setExercisePhotos(exerciseId, next);
    if (!out.ok) {
      setError({ code: out.code });
      return false;
    }
    setShown(next);
    invalidateExerciseIndex();
    router.refresh();
    return true;
  }

  async function add(file: File) {
    setBusy(true);
    setError(null);
    setStatus('Uploading photo…');
    try {
      const path = await uploadExercisePhoto(workspaceId, exerciseId, file);
      if (await save([...shown, path])) setStatus('Photo added.');
      else setStatus('');
    } catch (e) {
      setError(e instanceof PhotoError ? { code: 'photo_prepare_failed', text: e.message } : { code: 'exercise_photo_failed' });
      setStatus('');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={styles.photos}>
      <ul className={styles.slots} aria-label={`Photos of ${name}`}>
        {shown.map((p, i) => (
          <li key={p} className={styles.slot}>
            {/* eslint-disable-next-line @next/next/no-img-element -- plain img keeps the app host-agnostic (no image optimizer) */}
            <img src={exercisePhotoUrl(p)} alt={`${name}, ${SLOT_NAMES[i]?.toLowerCase() ?? 'photo'} position`} className={styles.img} />
            <span className={styles.slotFoot}>
              <span className={styles.slotName}>{SLOT_NAMES[i] ?? 'Photo'}</span>
              <Button variant="quiet" size="compact" onClick={() => setRemoving(p)} disabled={busy} aria-label={`Remove ${SLOT_NAMES[i]?.toLowerCase() ?? ''} photo`}>
                Remove
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {shown.length < MAX_EXERCISE_PHOTOS ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className={styles.file}
            tabIndex={-1}
            aria-hidden="true"
            data-testid="exercise-photo-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void add(f);
            }}
          />
          <Button variant="secondary" onClick={() => inputRef.current?.click()} pending={busy} className={styles.addButton}>
            {busy ? 'Uploading…' : shown.length === 0 ? '+ Add start photo' : '+ Add end photo'}
          </Button>
        </>
      ) : null}
      <p className={styles.hint}>Up to 2 photos: the start and the end position. Photos only.</p>
      <p id={statusId} role="status" className={styles.srOnly}>
        {status}
      </p>
      {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
      {removing ? <RemoveDialog onClose={() => setRemoving(null)} onConfirm={() => save(shown.filter((x) => x !== removing))} /> : null}
    </div>
  );
}

function RemoveDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<boolean> }) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const bodyId = useId();
  const [pending, setPending] = useState(false);
  return (
    <AdaptiveDialog
      ref={ref}
      historyId="remove-photo"
      role="alertdialog"
      describedBy={bodyId}
      title="Remove this photo?"
      titleSafe
      busy={pending}
      stackFooterOnPhone
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => ref.current?.requestClose()} disabled={pending} phSafe>
            Cancel
          </Button>
          <Button
            variant="danger"
            pending={pending}
            phSafe
            onClick={() => {
              setPending(true);
              void onConfirm().then(async () => {
                setPending(false);
                await ref.current?.close();
              });
            }}
          >
            {pending ? 'Removing…' : 'Remove photo'}
          </Button>
        </>
      }
    >
      <p id={bodyId}>The photo is deleted. You can add another one at any time.</p>
    </AdaptiveDialog>
  );
}
