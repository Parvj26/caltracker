'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { MAX_PHOTOS } from '@caltracker/shared';
import { canSendDraft } from './model';
import styles from './messages.module.css';

export type Draft = { body: string; files: File[] };
type Photo = { file: File; url: string };

const BODY_MAX = 4000;

/**
 * The reply box: Enter sends, Shift+Enter adds a line, 📎 adds up to 4 photos shown as removable thumbnails.
 * `initialBody` starts the box with text (and focuses it at the end), e.g. "Reply about this meal" from the Food tab.
 */
export function Composer({ onSend, initialBody = '' }: { onSend: (draft: Draft) => void; initialBody?: string | undefined }) {
  const [body, setBody] = useState(initialBody.slice(0, BODY_MAX));
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const latestPhotos = useRef(photos);
  useEffect(() => {
    latestPhotos.current = photos;
  });
  // Object URLs are released when the box goes away.
  useEffect(() => () => latestPhotos.current.forEach((p) => URL.revokeObjectURL(p.url)), []);
  // A pre-filled reply is ready to type into: focus it with the caret after the text.
  const startsFilled = useRef(initialBody !== '');
  useEffect(() => {
    const el = area.current;
    if (!startsFilled.current || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const canSend = canSendDraft(body, photos.length, initialBody);

  function grow() {
    const el = area.current;
    if (!el) return;
    // Up to 6 lines (the CSS max-height), then it scrolls.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const picked = [...list];
    const images = picked.filter((f) => f.type.startsWith('image/'));
    const room = MAX_PHOTOS - photos.length;
    if (images.length < picked.length) setError('Only photos can be sent.');
    else if (images.length > room) setError(`You can add up to ${MAX_PHOTOS} photos to a message.`);
    else setError(null);
    setPhotos((prev) => [...prev, ...images.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    if (picker.current) picker.current.value = '';
  }

  function removePhoto(url: string) {
    URL.revokeObjectURL(url);
    setPhotos((prev) => prev.filter((p) => p.url !== url));
    setError(null);
  }

  function submit() {
    if (!canSend) return;
    onSend({ body, files: photos.map((p) => p.file) });
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setBody('');
    setError(null);
    requestAnimationFrame(() => {
      if (area.current) area.current.style.height = 'auto';
      area.current?.focus();
    });
  }

  return (
    <form
      className={styles.composer}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {photos.length > 0 ? (
        <ul className={styles.thumbs} aria-label="Photos to send">
          {photos.map((p, i) => (
            <li key={p.url} className={styles.thumb}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file */}
              <img src={p.url} alt={`Photo ${i + 1}`} />
              <button type="button" className={styles.thumbRemove} aria-label={`Remove photo ${i + 1}`} onClick={() => removePhoto(p.url)}>
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.composerRow}>
        <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} aria-label="Choose photos" />
        <button
          type="button"
          className={styles.attach}
          aria-label="Add photos"
          disabled={photos.length >= MAX_PHOTOS}
          onClick={() => picker.current?.click()}
        >
          <span aria-hidden="true">📎</span>
        </button>
        <textarea
          ref={area}
          className={styles.input}
          rows={1}
          maxLength={BODY_MAX}
          aria-label="Message"
          placeholder="Write a message"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button type="submit" className={styles.send} disabled={!canSend}>
          Send
        </Button>
      </div>
    </form>
  );
}
