'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { ErrorText } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import { duplicateProgram } from '../actions';
import { DeleteProgram, type DeleteProgramHandle } from './delete-program';
import styles from '../programs.module.css';

/**
 * The program header's ⋯ menu: Duplicate (makes "<name> (copy)" and opens it) and Delete program (asks first). Assign
 * stays a button of its own beside it, so the page's main action stands out.
 */
export function ProgramMenu({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const deleteRef = useRef<DeleteProgramHandle>(null);

  useEffect(() => {
    if (!open) return;
    itemsRef.current[0]?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function duplicate() {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await duplicateProgram(id);
        if (!outcome.ok) {
          setError(outcome.code);
          return;
        }
        router.push(`/programs/${outcome.id}?copied=1`);
      } catch (e) {
        setError(failureCode(e, 'copy_offline'));
      }
    });
  }

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    const items = itemsRef.current.filter((x): x is HTMLButtonElement => x !== null);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className={styles.headerMenu}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.smallButton}
        aria-label="More program actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={pending || undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{pending ? '…' : '⋯'}</span>
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label="More program actions" className={styles.menu} onKeyDown={onMenuKey}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                itemsRef.current[0] = el;
              }}
              className={styles.menuItem}
              disabled={pending}
              onClick={duplicate}
            >
              Duplicate program
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                itemsRef.current[1] = el;
              }}
              className={`${styles.menuItem} ${styles.dangerText}`}
              onClick={() => {
                setOpen(false);
                deleteRef.current?.open();
              }}
            >
              Delete program
            </button>
          </li>
        </ul>
      ) : null}
      {pending ? <p className={styles.caption} role="status">Duplicating…</p> : null}
      {error ? <ErrorText code={error} /> : null}
      <DeleteProgram id={id} name={name} handle={deleteRef} />
    </div>
  );
}
