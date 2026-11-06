'use client';

import { useState } from 'react';
import { SECTION_PRESETS } from '@caltracker/shared';
import { Button } from '@/components/ui';
import styles from './builder.module.css';

type Props = {
  /** True when the workout already has the most sections it can hold. */
  full: boolean;
  onAdd: (name: string) => void;
};

/** "+ Section": a small panel with the preset names and a "Custom…" text box. */
export function AddSectionMenu({ full, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');

  const close = () => {
    setOpen(false);
    setCustom(false);
    setName('');
  };
  const add = (n: string) => {
    onAdd(n);
    close();
  };

  return (
    <div className={styles.sectionMenu} onKeyDown={(e) => (e.key === 'Escape' ? close() : undefined)}>
      <Button variant="secondary" aria-expanded={open} disabled={full} onClick={() => (open ? close() : setOpen(true))}>
        + Section
      </Button>
      {full ? <p className={styles.caption}>Use at most 10 sections.</p> : null}
      {open && !full ? (
        <div role="group" aria-label="Add a section" className={styles.sectionChoices}>
          {SECTION_PRESETS.map((p) => (
            <button key={p} type="button" className={styles.smallButton} onClick={() => add(p)}>
              {p}
            </button>
          ))}
          {!custom ? (
            <button type="button" className={styles.smallButton} onClick={() => setCustom(true)}>
              Custom…
            </button>
          ) : (
            <form
              className={styles.customSection}
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) add(name);
              }}
            >
              <input
                type="text"
                aria-label="Custom section name"
                maxLength={40}
                autoFocus
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" className={styles.smallButton} disabled={name.trim() === ''}>
                Add section
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
