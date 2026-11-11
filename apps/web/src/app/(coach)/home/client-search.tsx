'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ClientCombobox, type ComboClient } from '@/components/client-combobox/client-combobox';
import styles from './home.module.css';

const noop = () => () => {};
/** "⌘K" on Apple devices, "Ctrl K" everywhere else (and on the server, until the browser says otherwise). */
function useShortcutHint(): string {
  return useSyncExternalStore(
    noop,
    () => {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
      return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K';
    },
    () => 'Ctrl K',
  );
}

/** Jump to any current client's Training (their calendar): type part of a name (typos forgiven), arrow to a result, Enter. ⌘K / Ctrl+K focuses the box. */
export function ClientSearch({ clients }: { clients: ComboClient[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const hint = useShortcutHint();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ClientCombobox
      clients={clients}
      label="Find a client"
      placeholder={`Find a client  ${hint}`}
      emptyOnPick
      inputRef={inputRef}
      className={styles.search}
      onPick={(c) => router.push(`/clients/${c.id}/training`)}
    />
  );
}
