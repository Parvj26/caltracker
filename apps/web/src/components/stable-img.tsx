'use client';

import { useState } from 'react';
import { sameImage } from '@/lib/stable-src';

/**
 * Keeps the signed link an image first loaded while new renders only bring a fresh token for the same file and
 * version, so a page refresh (live updates) does not download the photo again or make it flicker. A new file or
 * version switches to the latest link; call the returned `retry` when the image fails (an expired link) to switch too.
 */
export function useStableSrc(src: string): [string, () => void];
export function useStableSrc(src: string | undefined): [string | undefined, () => void];
export function useStableSrc(src: string | undefined): [string | undefined, () => void] {
  const [shown, setShown] = useState(src);
  const current = shown !== undefined && src !== undefined && sameImage(shown, src) ? shown : src;
  if (current !== shown) setShown(current);
  return [current, () => setShown(src)];
}

/** An <img> for a signed Storage link that keeps its first link across re-renders (see `useStableSrc`). */
export function StableImg({ src, className }: { src: string; className?: string | undefined }) {
  const [current, retry] = useStableSrc(src);
  return (
    // A plain <img>: the signed link is already the right size (256 px) and expires, so next/image can't cache it.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={current} alt="" className={className} onError={retry} data-ph-block="" />
  );
}
