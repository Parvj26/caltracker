'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ClientCombobox, type ComboClient } from '@/components/client-combobox/client-combobox';
import { shortcutHint } from '@/lib/shortcut-hint';
import styles from './home.module.css';

const noop = () => () => {};
/**
 * "⌘K" on a Mac, "Ctrl K" on other computers, nothing on phones, tablets and other touch-first devices (no keyboard
 * to press it on). Nothing on the server either, until the browser says otherwise.
 */
function useShortcutHint(): string {
  return useSyncExternalStore(
    noop,
    () => {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      return shortcutHint({
        platform: nav.userAgentData?.platform ?? navigator.platform ?? '',
        finePointer: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
      });
    },
    () => '',
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
      placeholder={hint ? `Find a client  ${hint}` : 'Find a client'}
      emptyOnPick
      inputRef={inputRef}
      className={styles.search}
      onPick={(c) => router.push(`/clients/${c.id}/training`)}
    />
  );
}
