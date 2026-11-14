'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Chip } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { cx } from '@/components/ui/cx';
import { avatarTone, initials } from '../avatar';
import { RemoveClientDialog } from '../row-actions';
import menuStyles from '@/components/calendar/calendar.module.css';
import styles from './client-page.module.css';

export const CLIENT_NAME_ID = 'client-name';

function MessageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

/**
 * The client page's bar: back to Clients, the client's initials and name, Message (or a past client's message
 * history) and "⋯" with Client settings and, for a current client, Remove client (red; it asks first, with the same
 * explanation as everywhere else). On a phone it is one small row that stays at the top with the tabs.
 */
export function ClientHeader({ client }: { client: { id: string; name: string; firstName: string; removedAt: string | null } }) {
  const past = client.removedAt !== null;
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLElement | null)[]>([]);
  const removeRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    itemsRef.current.find((x) => x != null)?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    const els = itemsRef.current.filter((x): x is HTMLElement => x != null);
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      els[(at + step + els.length) % els.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <header className={styles.bar}>
      <Link href="/clients" className={styles.barBack} aria-label="Back to Clients">
        <ChevronIcon direction="left" size={22} />
        <span className={styles.barBackText} aria-hidden="true">Clients</span>
      </Link>
      <span aria-hidden="true" className={cx(styles.avatar, styles[`avatar-${avatarTone(client.id)}`])}>
        {initials(client.name)}
      </span>
      <h1 id={CLIENT_NAME_ID} tabIndex={-1} className={styles.name} title={client.name}>
        {client.name}
      </h1>
      {past ? <Chip tone="grey" phSafe className={styles.pastChip}>Past client</Chip> : null}
      <div className={styles.barActions}>
        {past ? (
          <Link href={`/clients/${client.id}/training#message-history`} className={styles.barIconButton} aria-label="Message history" title="Message history">
            <MessageIcon />
          </Link>
        ) : (
          <Link href={`/messages/${client.id}`} className={cx(styles.barIconButton, styles.barMessage)} aria-label="Message" title={`Message ${client.firstName || client.name}`}>
            <MessageIcon />
            <span className={styles.barMessageText} aria-hidden="true">Message</span>
          </Link>
        )}
        <div ref={wrapRef} className={styles.menuWrap}>
          <button
            type="button"
            ref={buttonRef}
            className={styles.barIconButton}
            aria-label="More for this client"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen((o) => !o)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          {open ? (
            <ul id={menuId} role="menu" aria-label="More for this client" className={cx(menuStyles.menu, styles.barMenu)} onKeyDown={onMenuKey}>
              <li role="none">
                <Link
                  href={`/clients/${client.id}/settings`}
                  role="menuitem"
                  ref={(el) => {
                    itemsRef.current[0] = el;
                  }}
                  className={menuStyles.menuItem}
                  onClick={() => setOpen(false)}
                >
                  Client settings
                </Link>
              </li>
              {past ? null : (
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    ref={(el) => {
                      itemsRef.current[1] = el;
                    }}
                    className={cx(menuStyles.menuItem, styles.menuDanger)}
                    onClick={() => {
                      setOpen(false);
                      removeRef.current?.showModal();
                    }}
                  >
                    Remove client…
                  </button>
                </li>
              )}
            </ul>
          ) : null}
        </div>
      </div>
      {past ? null : <RemoveClientDialog userId={client.id} name={client.name} focusAfterId={CLIENT_NAME_ID} dialogRef={removeRef} />}
    </header>
  );
}
