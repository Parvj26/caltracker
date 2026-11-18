'use client';

import { useState, type ReactNode } from 'react';
import { SECTION_PRESETS } from '@caltracker/shared';
import { Button, notAContact } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import styles from './builder.module.css';
import { useBackLayer } from '@/lib/open-layer';

type Props = {
  /** True when the workout already has the most sections it can hold. */
  full: boolean;
  onAdd: (name: string) => void;
  /** The top bar: the choices open in a small panel below the button instead of pushing the page down. */
  popover?: boolean;
  /** The phone's More sheet: a big row instead of the button. */
  trigger?: ReactNode;
  triggerClassName?: string;
};

/** "+ Section": a small panel with the preset names and a "Custom…" text box. */
export function AddSectionMenu({ full, onAdd, popover = false, trigger, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  // Back (and iOS swipe-back) closes the menu, not the page.
  useBackLayer(open, () => setOpen(false));
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
    <div className={cx(styles.sectionMenu, popover && styles.sectionPopover)} onKeyDown={(e) => (e.key === 'Escape' ? close() : undefined)}>
      {trigger ? (
        <button type="button" className={triggerClassName} aria-expanded={open} disabled={full} onClick={() => (open ? close() : setOpen(true))}>
          {trigger}
        </button>
      ) : (
        <Button variant="secondary" aria-expanded={open} disabled={full} title={full && popover ? 'Use at most 10 sections.' : undefined} onClick={() => (open ? close() : setOpen(true))}>
          + Section
        </Button>
      )}
      {full && !popover ? <p className={styles.caption}>Use at most 10 sections.</p> : null}
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
                {...notAContact('new-section')}
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
