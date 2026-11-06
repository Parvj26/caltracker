'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './home.module.css';

type SearchClient = { id: string; firstName: string; lastName: string };

const MAX_RESULTS = 8;

/** Lower case with accents removed, so "jose" finds "José". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const nameOf = (c: SearchClient) => `${c.firstName} ${c.lastName}`.trim() || 'Client';

/** Jump to any current client: type part of a name, arrow to a result, Enter. ⌘K / Ctrl+K focuses the box. */
export function ClientSearch({ clients }: { clients: SearchClient[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const needle = fold(query.trim());
  const results = needle
    ? clients.filter((c) => fold(`${c.firstName} ${c.lastName}`).includes(needle)).slice(0, MAX_RESULTS)
    : [];
  const expanded = open && needle !== '';
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (id: string) => `${listId}-${id}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
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
    router.push(`/clients/${c.id}`);
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
        placeholder="Find a client  ⌘K"
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
        {expanded && results.length === 0 ? <li role="presentation" className={styles.searchEmpty}>No clients match.</li> : null}
      </ul>
    </div>
  );
}
