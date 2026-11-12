'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './header.module.css';

/**
 * The workout page's less common actions (Duplicate, Delete). On a wide screen they sit in the header as buttons, as
 * before. Below 900 px (phones, iPad portrait) they fold behind "⋯", so Assign is the one big button and Delete is no
 * longer as loud as it. The children stay mounted either way, so Delete's confirmation window keeps working.
 */
export function MoreActions({ name, children }: { name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      // A window opened from the panel (Delete's question) handles its own Escape.
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.moreButton}
        aria-label={`More for ${name}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <div id={panelId} className={styles.panel} data-open={open ? '' : undefined}>
        {children}
      </div>
    </div>
  );
}
