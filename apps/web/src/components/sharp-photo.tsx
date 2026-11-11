'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cx } from '@/components/ui/cx';
import { useStableSrc } from './stable-img';
import styles from './sharp-photo.module.css';

/**
 * A private photo shown whole and sharp: the full-size file (1600 px long edge) drawn uncropped
 * (`object-fit: contain`), with the small thumbnail, blurred, underneath as a placeholder until the full photo has
 * loaded. Stretching the 320 px thumbnail to the card width is what made photos look blurry.
 *
 * `width`/`height` (the stored size) reserve the space before anything loads. Without them, the thumbnail (same shape
 * as the photo) sets the size as soon as it arrives. Signed links keep their first token across re-renders.
 */
export function SharpPhoto({
  full,
  thumb,
  alt,
  width,
  height,
  maxHeight,
  className,
}: {
  full: string;
  thumb?: string | undefined;
  alt: string;
  width?: number | undefined;
  height?: number | undefined;
  /** Any CSS length, e.g. `80vh` or `320px`. */
  maxHeight: string;
  className?: string | undefined;
}) {
  const [fullSrc, retryFull] = useStableSrc(full);
  const [thumbSrc, retryThumb] = useStableSrc(thumb);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const fullRef = useRef<HTMLImageElement>(null);
  // A photo already in the browser's cache can finish before React listens for `load`.
  useEffect(() => {
    const el = fullRef.current;
    if (el?.complete && el.naturalWidth > 0) setLoadedSrc(fullSrc);
  }, [fullSrc]);
  const loaded = loadedSrc === fullSrc;
  const size = width && height ? { width, height } : {};
  const style = { '--photo-max-height': maxHeight } as CSSProperties;

  return (
    // data-ph-block: the whole frame (photo and blurred placeholder) is a grey box in session recordings.
    <span className={cx(styles.frame, className)} style={style} data-loaded={loaded ? 'true' : 'false'} data-ph-block="">
      {thumbSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private photo behind a signed URL
        <img className={cx(styles.fit, styles.placeholder, loaded && styles.hidden)} src={thumbSrc} alt="" aria-hidden="true" {...size} loading="lazy" onError={retryThumb} />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- a private photo behind a signed URL, already sized */}
      <img
        ref={fullRef}
        className={thumbSrc ? styles.over : styles.fit}
        src={fullSrc}
        alt={alt}
        {...size}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoadedSrc(fullSrc)}
        onError={retryFull}
      />
    </span>
  );
}
