'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { cx } from './ui/cx';
import ui from './ui/ui.module.css';
import styles from './admin.module.css';
import { usePeopleMatches, type Person } from './people-search';

/**
 * The Logs page's "Person" filter: a search box with suggestions (the shared smart search, as in PeopleSearch).
 * Picking someone filters straight away by setting `?person=<id>` (links keep working); × goes back to everyone.
 * Keyboard: ↑/↓ move through the suggestions, Enter picks, Esc closes.
 */
export function PersonFilter({ people, selectedId, baseHref }: { people: Person[]; selectedId: string | null; baseHref: string }) {
  const router = useRouter();
  const selected = selectedId ? people.find((p) => p.user_id === selectedId) : undefined;
  const selectedLabel = selected ? selected.name || selected.email : '';
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputId = useId();
  const listId = useId();
  const hits = usePeopleMatches(people, open ? query : '');
  const showList = open && query.trim() !== '';
  const sep = baseHref.includes('?') ? '&' : '?';

  function pick(p: Person) {
    setQuery(p.name || p.email);
    setOpen(false);
    router.push(`${baseHref}${sep}person=${p.user_id}`);
  }

  function clear() {
    setQuery('');
    setOpen(false);
    if (selectedId) router.push(baseHref);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (hits.length === 0 ? 0 : Math.min(i + 1, hits.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = hits[active];
      if (showList && hit) {
        e.preventDefault();
        pick(hit);
      }
    } else if (e.key === 'Escape') {
      if (showList) e.preventDefault();
      setOpen(false);
    }
  }

  const activeId = showList && hits[active] ? `${listId}-${active}` : undefined;
  return (
    <div className={cx(ui.fieldLabel, styles.personFilter)}>
      <label htmlFor={inputId} className={ui.fieldLabelText}>Person</label>
      <div className={styles.personFilterBox}>
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeId}
          placeholder="Search by name or email"
          autoComplete="off"
          className={cx(ui.input, styles.personFilterInput)}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {query || selectedId ? (
          <button type="button" aria-label="Clear person (show everyone)" className={styles.personFilterClear} onClick={clear}>
            ×
          </button>
        ) : null}
        <ul id={listId} role="listbox" aria-label="People" className={styles.searchResults} hidden={!showList}>
          {showList && hits.length === 0 ? <li className={styles.searchEmpty}>Nobody matches.</li> : null}
          {showList
            ? hits.map((p, i) => (
                <li
                  key={p.user_id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={cx(styles.searchResult, i === active && styles.searchResultActive)}
                  // mousedown, not click: it runs before the input's blur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(p);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {p.name || p.email}
                  <span className={styles.cellNote}>{p.email}</span>
                </li>
              ))
            : null}
        </ul>
      </div>
    </div>
  );
}
