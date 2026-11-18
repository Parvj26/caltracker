'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes, type RefObject } from 'react';
import { cx } from './cx';
import styles from './search-box.module.css';

export type SearchBoxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'aria-label'> & {
  value: string;
  onChange: (value: string) => void;
  /** What screen readers hear ("Search workouts"). Required: the box has no visible label. */
  label: string;
  /** Enter closes the keyboard; this runs first (e.g. a server search past the list cap). */
  onEnter?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Class on the wrapper (layout: width, flex). */
  className?: string | undefined;
};

/**
 * The one search box (UI rules §6): 48 px, magnifier on the left, a clear × (44 px) whenever there's text, results
 * update as you type (no Search button). Callers filter with the shared smart search (`smartFilter`,
 * `searchExercises`, `filterClients`…), never `.includes()`.
 */
export function SearchBox({ value, onChange, label, onEnter, inputRef, className, placeholder, onKeyDown, ...rest }: SearchBoxProps) {
  const fallbackRef = useRef<HTMLInputElement | null>(null);
  const ownRef = inputRef ?? fallbackRef;
  return (
    <div className={cx(styles.box, className)}>
      <svg className={styles.icon} aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <input
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        {...rest}
        ref={ownRef}
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter?.();
            // The list already shows the matches: Enter only closes the phone keyboard.
            e.currentTarget.blur();
          }
        }}
      />
      {value !== '' ? (
        <button
          type="button"
          className={styles.clear}
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            ownRef.current?.focus();
          }}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** The no-results line: No workouts match “x” · Clear search. */
export function SearchEmpty({ things, query, onClear, className }: { things: string; query: string; onClear: () => void; className?: string | undefined }) {
  return (
    <p className={cx(styles.empty, className)} data-testid="search-empty">
      <span>
        No {things} match “{query.trim()}”
      </span>
      <button type="button" className={styles.emptyClear} onClick={onClear}>
        Clear search
      </button>
    </p>
  );
}

/** The optional "3 of 40 workouts" line under the box, announced to screen readers as it changes. */
export function SearchCount({ children, className }: { children: string; className?: string | undefined }) {
  return (
    <p role="status" className={cx(styles.count, className)}>
      {children}
    </p>
  );
}

/** Text that follows `value` once it has stayed the same for `delay` ms. Cleared text follows at once. */
export function useDebounced(value: string, delay = 120): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return value.trim() === '' ? value : settled;
}

/**
 * Search text for a box: `query` is what's typed (give it to the SearchBox), `debounced` is what to filter with (it
 * settles 120 ms after typing stops, so a long list doesn't redo the search on every key). With `urlParam` the text is
 * kept in the address (replaced, not pushed), so Back to the page brings the same results.
 */
export function useSearchQuery({ initial = '', urlParam, delay = 120 }: { initial?: string; urlParam?: string; delay?: number } = {}) {
  const [query, setQuery] = useState(initial);
  const debounced = useDebounced(query, delay);
  const first = useRef(true);
  useEffect(() => {
    if (!urlParam) return;
    // The first run is the page load: the address already says what the page was opened with.
    if (first.current) {
      first.current = false;
      return;
    }
    const url = new URL(window.location.href);
    if (debounced.trim()) url.searchParams.set(urlParam, debounced);
    else url.searchParams.delete(urlParam);
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [debounced, urlParam]);
  return { query, setQuery, debounced, searching: debounced.trim() !== '' };
}
