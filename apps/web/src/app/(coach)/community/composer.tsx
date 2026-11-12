'use client';

import { useRef, useState, useTransition } from 'react';
import { COMMUNITY_BUCKET, MAX_POST_PHOTOS, POST_BODY_MAX, communityPhotoPaths, contentTypeFor } from '@caltracker/shared';
import { Button, ErrorText, errorFromText, type FieldError } from '@/components/ui';
import { processCommunityPhoto, type ProcessedPhoto } from '@/lib/community-photo';
import { PhotoError } from '@/lib/image-resize';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { createPost } from './actions';
import styles from './community.module.css';

/** True when the upload worked, or failed only because the same file was uploaded by an earlier try. */
function uploaded(error: unknown): boolean {
  if (!error) return true;
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown };
  return String(e.statusCode) === '409' || String(e.status) === '409' || (typeof e.message === 'string' && /already exists|duplicate/i.test(e.message));
}

type Picked = { id: string; photo: ProcessedPhoto; preview: string };

/**
 * The coach's composer: text (links become clickable) and up to 4 photos. Photos are shrunk in the browser, uploaded
 * straight to the private bucket under the coach's own folder for this post, then the post is created.
 */
export function Composer({ communityId, workspaceId, userId }: { communityId: string; workspaceId: string; userId: string }) {
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [error, setError] = useState<FieldError | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  // One id per post being written, so a retry after a failure re-uses the uploaded photos and never posts twice.
  const [postId, setPostId] = useState(() => crypto.randomUUID());

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = MAX_POST_PHOTOS - photos.length;
    if (files.length > room) setError({ code: 'post_too_many_photos' });
    setPreparing(true);
    try {
      const added: Picked[] = [];
      for (const file of [...files].slice(0, room)) {
        const photo = await processCommunityPhoto(file);
        added.push({ id: crypto.randomUUID(), photo, preview: URL.createObjectURL(photo.thumb) });
      }
      setPhotos((p) => [...p, ...added]);
    } catch (e) {
      setError(e instanceof PhotoError ? errorFromText(e.message, 'photo_unusable') : { code: 'photo_unusable' });
    } finally {
      setPreparing(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removePhoto = (id: string) => setPhotos((p) => p.filter((x) => x.id !== id));

  const submit = () => {
    setError(null);
    if (!body.trim() && photos.length === 0) {
      setError({ code: 'post_empty' });
      return;
    }
    startTransition(async () => {
      const supabase = createBrowserSupabase();
      const images = [];
      for (const p of photos) {
        const paths = communityPhotoPaths(workspaceId, userId, postId, p.id, p.photo.ext);
        // No overwrite (the bucket allows no updates); on a retry the photo already there counts as uploaded.
        const options = { contentType: contentTypeFor(p.photo.ext), upsert: false };
        const [full, thumb] = await Promise.all([
          supabase.storage.from(COMMUNITY_BUCKET).upload(paths.path, p.photo.full, options),
          supabase.storage.from(COMMUNITY_BUCKET).upload(paths.thumbPath, p.photo.thumb, options),
        ]);
        if (!uploaded(full.error) || !uploaded(thumb.error)) {
          setError({ code: 'upload_failed' });
          return;
        }
        images.push({ ...paths, width: p.photo.width, height: p.photo.height });
      }
      const result = await createPost({ postId, communityId, body, images });
      if (!result.ok) {
        setError({ code: result.code });
        return;
      }
      for (const p of photos) URL.revokeObjectURL(p.preview);
      setBody('');
      setPhotos([]);
      setPostId(crypto.randomUUID());
    });
  };

  return (
    <section className={styles.composer} aria-label="New post">
      <label className={styles.composerLabel}>
        <span className={styles.visuallyHidden}>Write a post</span>
        <textarea
          className={styles.composerInput}
          placeholder="Share an update with your clients…"
          value={body}
          maxLength={POST_BODY_MAX}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {photos.length > 0 ? (
        <ul className={styles.previewRow} aria-label="Photos to post">
          {photos.map((p, i) => (
            <li key={p.id} className={styles.preview}>
              {/* A local preview of the shrunk thumbnail. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt={`Photo ${i + 1}`} />
              <button type="button" className={styles.previewRemove} aria-label={`Remove photo ${i + 1}`} onClick={() => removePhoto(p.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
      <div className={styles.composerActions}>
        <label className={styles.smallButton} aria-disabled={photos.length >= MAX_POST_PHOTOS || preparing}>
          {preparing ? 'Preparing…' : 'Add photos'}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className={styles.visuallyHidden}
            disabled={photos.length >= MAX_POST_PHOTOS || preparing}
            onChange={(e) => void addFiles(e.target.files)}
            aria-label="Add photos"
          />
        </label>
        <Button onClick={submit} pending={pending || preparing}>
          Post
        </Button>
      </div>
    </section>
  );
}
