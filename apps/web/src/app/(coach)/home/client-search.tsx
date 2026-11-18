'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { searchClients } from '@caltracker/shared';
import { clientName, type ComboClient } from '@/components/client-combobox/client-combobox';
import combo from '@/components/client-combobox/client-combobox.module.css';
import { SearchBox } from '@/components/ui';
import { cx } from '@/components/ui/cx';
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

/**
 * Jump to any current client's Training (their calendar): the shared SearchBox (UI rules §6) as a combobox. Type part
 * of a name (typos forgiven, shared smart search), arrow to a result, Enter or tap. ⌘K / Ctrl+K focuses the box.
 */
export function ClientSearch({ clients }: { clients: ComboClient[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const hint = useShortcutHint();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

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

  const typed = query.trim() !== '';
  const results = typed ? searchClients(clients, query) : [];
  const expanded = open && results.length > 0;
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (id: string) => `${listId}-${id}`;
  const activeClient = expanded ? results[activeIndex] : undefined;

  function pick(c: ComboClient) {
    setQuery('');
    setOpen(false);
    router.push(`/clients/${c.id}/training`);
  }

  return (
    <div className={cx(combo.wrap, styles.search)}>
      <SearchBox
        label="Find a client"
        placeholder={hint ? `Find a client  ${hint}` : 'Find a client'}
        inputRef={inputRef}
        value={query}
        onChange={(v) => {
          setQuery(v);
          setActive(0);
          setOpen(true);
        }}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeClient ? optionId(activeClient.id) : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && results.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((activeIndex + 1) % results.length);
          } else if (e.key === 'ArrowUp' && results.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((activeIndex - 1 + results.length) % results.length);
          } else if (e.key === 'Enter' && activeClient) {
            e.preventDefault();
            pick(activeClient);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setQuery('');
            setOpen(false);
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label="Clients" hidden={!expanded} className={combo.list}>
        {results.map((c, i) => (
          <li
            key={c.id}
            id={optionId(c.id)}
            role="option"
            aria-selected={i === activeIndex}
            className={combo.option}
            // Mouse down (not click) so the box's blur doesn't close the list first.
            onMouseDown={(e) => {
              e.preventDefault();
              pick(c);
            }}
            onMouseEnter={() => setActive(i)}
          >
            {clientName(c)}
          </li>
        ))}
      </ul>
      <p role="status" className={combo.none}>
        {open && typed && results.length === 0 ? 'No clients match.' : ''}
      </p>
    </div>
  );
}
