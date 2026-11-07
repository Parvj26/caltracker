'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { searchClients } from '@caltracker/shared';
import styles from './home.module.css';

type SearchClient = { id: string; firstName: string; lastName: string };

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

const nameOf = (c: SearchClient) => `${c.firstName} ${c.lastName}`.trim() || 'Client';

/** Jump to any current client's Training (their calendar): type part of a name, arrow to a result, Enter. ⌘K / Ctrl+K focuses the box. */
export function ClientSearch({ clients }: { clients: SearchClient[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const hint = useShortcutHint();
  const typed = query.trim() !== '';
  const results = searchClients(clients, query);
  const expanded = open && typed && results.length > 0;
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (id: string) => `${listId}-${id}`;

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

  function go(c: SearchClient) {
    setQuery('');
    setOpen(false);
    router.push(`/clients/${c.id}/training`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((activeIndex + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((activeIndex - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && expanded && results[activeIndex]) {
      e.preventDefault();
      go(results[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      setOpen(false);
    }
  }

  const activeClient = expanded ? results[activeIndex] : undefined;

  return (
    <div className={styles.search}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Find a client"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeClient ? optionId(activeClient.id) : undefined}
        autoComplete="off"
        placeholder={`Find a client  ${hint}`}
        className={styles.searchInput}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label="Clients" hidden={!expanded} className={styles.searchList}>
        {results.map((c, i) => (
          <li
            key={c.id}
            id={optionId(c.id)}
            role="option"
            aria-selected={i === activeIndex}
            className={styles.searchOption}
            // Mouse down (not click) so the input's blur doesn't close the list first.
            onMouseDown={(e) => {
              e.preventDefault();
              go(c);
            }}
            onMouseEnter={() => setActive(i)}
          >
            {nameOf(c)}
          </li>
        ))}
      </ul>
      <p role="status" className={styles.searchEmpty}>{open && typed && results.length === 0 ? 'No clients match.' : ''}</p>
    </div>
  );
}
