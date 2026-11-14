'use client';

import { useId, useRef, useState, type RefObject } from 'react';
import { searchClients } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import styles from './client-combobox.module.css';

export type ComboClient = { id: string; firstName: string; lastName: string };

export const clientName = (c: ComboClient) => `${c.firstName} ${c.lastName}`.trim() || 'Client';

type Props = {
  clients: readonly ComboClient[];
  /** The box's accessible name. */
  label: string;
  placeholder: string;
  onPick: (c: ComboClient) => void;
  /** The text the box starts with and goes back to on Escape or leaving it (e.g. the client already picked). */
  committed?: string;
  /** Shows a × while there is text; pressing it empties the box and calls this. */
  onClear?: () => void;
  clearLabel?: string;
  /** After a pick the box empties (Home) instead of showing the picked name (a filter). */
  emptyOnPick?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string | undefined;
  /**
   * Looks and works like a dropdown ("Client: All ▾"): `prefix` is shown before the box, tapping the box lists every
   * client (typing still narrows the list with the smart search), and a ▾ shows while nothing is picked.
   */
  dropdown?: { prefix: string };
};

/**
 * An ARIA combobox for picking one of the coach's clients with the shared smart search (typos forgiven): type, arrow to
 * a suggestion, Enter or click. Escape closes the list and puts back the committed text.
 */
export function ClientCombobox({ clients, label, placeholder, onPick, committed = '', onClear, clearLabel = 'Clear', emptyOnPick = false, inputRef, className, dropdown }: Props) {
  const listId = useId();
  const fallbackRef = useRef<HTMLInputElement | null>(null);
  const ownRef = inputRef ?? fallbackRef;
  const [query, setQuery] = useState(committed);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  // When the committed text changes (a pick lands, or Back), the box follows it.
  const [seen, setSeen] = useState(committed);
  if (seen !== committed) {
    setSeen(committed);
    setQuery(committed);
  }

  const typed = query.trim() !== '';
  // A dropdown lists everyone until the coach types something new.
  const browsing = dropdown !== undefined && (!typed || query === committed);
  const results = browsing ? clients : searchClients(clients, query);
  const expanded = open && (typed || browsing) && results.length > 0;
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (id: string) => `${listId}-${id}`;

  function pick(c: ComboClient) {
    setQuery(emptyOnPick ? '' : clientName(c));
    setOpen(false);
    onPick(c);
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
      pick(results[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery(committed);
      setOpen(false);
    }
  }

  const activeClient = expanded ? results[activeIndex] : undefined;
  const showClear = onClear !== undefined && query !== '';

  return (
    <div className={cx(styles.wrap, className)}>
      <div className={cx(styles.box, dropdown && styles.dropdown)}>
        {dropdown ? (
          <span className={styles.prefix} aria-hidden="true">
            {dropdown.prefix}
          </span>
        ) : null}
        <input
          ref={ownRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeClient ? optionId(activeClient.id) : undefined}
          autoComplete="off"
          placeholder={placeholder}
          className={cx(styles.input, (showClear || dropdown) && styles.withClear)}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={(e) => {
            setOpen(true);
            // A dropdown showing a name: typing replaces it.
            if (dropdown) e.currentTarget.select();
          }}
          onBlur={() => {
            setOpen(false);
            // A filter box never keeps text that isn't applied.
            if (!emptyOnPick) setQuery(committed);
          }}
          onKeyDown={onKeyDown}
        />
        {showClear ? (
          <button
            type="button"
            className={styles.clear}
            aria-label={clearLabel}
            // Mouse down (not click) so the input's blur doesn't put the committed text back first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('');
              setOpen(false);
              ownRef.current?.focus();
              onClear?.();
            }}
          >
            ×
          </button>
        ) : dropdown ? (
          <svg className={styles.chevron} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M6 9l6 6 6-6" />
          </svg>
        ) : null}
      </div>
      <ul id={listId} role="listbox" aria-label="Clients" hidden={!expanded} className={cx(styles.list, dropdown && styles.scrollList)}>
        {results.map((c, i) => (
          <li
            key={c.id}
            id={optionId(c.id)}
            role="option"
            aria-selected={i === activeIndex}
            className={styles.option}
            // Mouse down (not click) so the input's blur doesn't close the list first.
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
      <p role="status" className={styles.none}>
        {open && typed && results.length === 0 ? 'No clients match.' : ''}
      </p>
    </div>
  );
}
