'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type InputHTMLAttributes, type RefObject } from 'react';
import { replaceParam } from '@/lib/url-state';
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
          if (e.key === 'Escape') {
            // In a pop-up, Escape closes it in one press. A search box with text would otherwise use the key to clear
            // itself (Chrome), and the pop-up would stay open.
            const dialog = e.currentTarget.closest('dialog');
            if (dialog?.open) {
              // Handled here (one owner): the dialog's own Escape handling sees defaultPrevented and stays out.
              e.preventDefault();
              // AdaptiveDialog (UI rules §5): the first Escape clears the text, the next one closes (asking first when
              // there are unsaved changes).
              if (value !== '' && dialog.hasAttribute('data-adaptive-dialog')) onChange('');
              else requestDialogClose(dialog);
            }
            return;
          }
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

/** Closes a <dialog> the way Escape does: its cancel handlers run first and may keep it open. */
function requestDialogClose(dialog: HTMLDialogElement) {
  if (typeof dialog.requestClose === 'function') {
    dialog.requestClose();
    return;
  }
  if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
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
  return value.trim() === '' || delay <= 0 ? value : settled;
}

/**
 * Search text for a box: `query` is what's typed (give it to the SearchBox), `debounced` is what to filter with (it
 * settles 120 ms after typing stops, so a long list doesn't redo the search on every key). With `urlParam` the text is
 * kept in the address (replaced, not pushed), so Back to the page brings the same results. `delay: 0` filters on every
 * key (a combobox whose Enter and arrows act on the list must never see an older list).
 */
/** Puts the search text in the address (blank: no ?q=), when it differs. */
function writeQuery(urlParam: string, text: string) {
  const value = text.trim() ? text : '';
  if ((new URLSearchParams(window.location.search).get(urlParam) ?? '') !== value) replaceParam(urlParam, value, '');
}

export function useSearchQuery({ initial = '', urlParam, delay = 120 }: { initial?: string; urlParam?: string; delay?: number } = {}) {
  // Start from the address, not only the server's `initial`: Back can bring the page from Next's client cache, whose
  // props are from before the text was typed, while the address (updated as you type) still holds ?q=.
  const params = useSearchParams();
  const fromUrl = urlParam ? params.get(urlParam) : null;
  const [query, setQuery] = useState(fromUrl ?? initial);
  const debounced = useDebounced(query, delay);
  const first = useRef(true);
  useEffect(() => {
    if (!urlParam) return;
    // The first run is the page load: the address already says what the page was opened with.
    if (first.current) {
      first.current = false;
      return;
    }
    // Through replaceParam (state null), so Next's router sees the address too: a refresh keeps ?q=.
    writeQuery(urlParam, debounced);
  }, [debounced, urlParam]);
  // A tap or Enter straight after typing (inside the 120 ms) writes the text first: written later, it would land in
  // the middle of the navigation that tap started and cancel it.
  const latest = useRef(query);
  useEffect(() => {
    latest.current = query;
  }, [query]);
  useEffect(() => {
    if (!urlParam) return;
    const now = () => writeQuery(urlParam, latest.current);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') now();
    };
    document.addEventListener('pointerdown', now, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', now, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [urlParam]);
  return { query, setQuery, debounced, searching: debounced.trim() !== '' };
}
