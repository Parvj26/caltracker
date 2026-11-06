'use client';

import { useState } from 'react';
import styles from './exercise-search.module.css';

type Props = { src: string | null; alt: string; width: number; height: number; className: string | undefined };

/** A lazy-loaded photo that shows a dumbbell placeholder when there is no image or it fails to load. */
export function Photo({ src, alt, width, height, className }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <span className={`${className} ${styles.placeholder}`} role="img" aria-label={alt ? `${alt} (no photo)` : undefined} aria-hidden={alt ? undefined : true}>
        <svg viewBox="0 0 24 24" width="50%" height="50%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
        </svg>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- plain img keeps the app host-agnostic (no image optimizer)
    <img src={src} alt={alt} width={width} height={height} loading="lazy" className={className} onError={() => setFailedSrc(src)} />
  );
}
