'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { IMAGE_ERROR, processAvatar } from '@/lib/image-resize';
import { removeAvatar, uploadAvatar } from './actions';
import styles from './profile.module.css';

/** The photo circle with Choose / Remove. The picture is cropped and compressed here, in the browser, before upload. */
export function AvatarPicker({ preview, hasPhoto }: { preview: ReactNode; hasPhoto: boolean }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice('');
    setBusy('upload');
    try {
      const { avatar, thumb, ext } = await processAvatar(file);
      const body = new FormData();
      body.set('avatar', avatar, `avatar.${ext}`);
      body.set('thumb', thumb, `avatar-thumb.${ext}`);
      body.set('ext', ext);
      const outcome = await uploadAvatar(body);
      if (!outcome.ok) setError(outcome.error);
      else setNotice('Photo updated.');
    } catch (e) {
      setError(e instanceof Error && e.message === IMAGE_ERROR ? IMAGE_ERROR : failureMessage(e, "Couldn't upload your photo. Please try again."));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = ''; // so choosing the same file again still fires
    }
  }

  async function remove() {
    setError(null);
    setNotice('');
    setBusy('remove');
    try {
      const outcome = await removeAvatar();
      if (!outcome.ok) setError(outcome.error);
      else setNotice('Photo removed.');
    } catch (e) {
      setError(failureMessage(e, "Couldn't remove your photo. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className={styles.photoRow}>
        {preview}
        <div className={styles.photoActions}>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            className={styles.fileInput}
            aria-label="Choose a photo"
            disabled={busy !== null}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <Button variant="secondary" pending={busy === 'upload'} disabled={busy !== null} onClick={() => inputRef.current?.click()}>
            {busy === 'upload' ? 'Uploading…' : hasPhoto ? 'Change photo' : 'Choose photo'}
          </Button>
          {hasPhoto ? (
            <button type="button" className={styles.smallButton} disabled={busy !== null} onClick={() => void remove()}>
              {busy === 'remove' ? 'Removing…' : 'Remove photo'}
            </button>
          ) : null}
        </div>
      </div>
      <div role="status" className={styles.success}>{notice}</div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {error === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
    </div>
  );
}
