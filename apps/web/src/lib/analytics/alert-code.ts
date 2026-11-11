import { isErrorCode, type ErrorCode } from '@caltracker/shared';

/** The code an on-screen alert reports: its `data-error-code` when known, else `missing_code` so we notice. */
export function alertCode(attr: string | null | undefined): ErrorCode {
  return isErrorCode(attr) ? attr : 'missing_code';
}

type AlertLike = { getAttribute(name: string): string | null };

/**
 * Remembers the last code reported for each on-screen alert, and reports again when it changes in place (React can
 * keep the same element when one error replaces another). Returns the function to call for every alert seen.
 */
export function alertReporter(report: (code: ErrorCode) => void): (el: AlertLike) => void {
  const last = new WeakMap<AlertLike, ErrorCode>();
  return (el) => {
    const code = alertCode(el.getAttribute('data-error-code'));
    if (last.get(el) === code) return;
    last.set(el, code);
    report(code);
  };
}
