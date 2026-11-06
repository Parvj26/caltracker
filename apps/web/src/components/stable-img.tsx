'use client';

import { useState } from 'react';
import { sameImage } from '@/lib/stable-src';

/**
 * An <img> for a signed Storage link that keeps the link it first loaded while new renders only bring a fresh token
 * for the same file and version, so a page refresh does not download the photo again. A new file or version, or a
 * failed load (an expired link), switches to the latest link.
 */
export function StableImg({ src, className }: { src: string; className?: string | undefined }) {
  const [shown, setShown] = useState(src);
  const current = sameImage(shown, src) ? shown : src;
  if (current !== shown) setShown(current);
  return (
    // A plain <img>: the signed link is already the right size (256 px) and expires, so next/image can't cache it.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={current} alt="" className={className} onError={() => setShown(src)} />
  );
}
