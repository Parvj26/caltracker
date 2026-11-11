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

/**
 * Watches `root` for error messages (role="alert") that appear, or whose code changes in place, and reports each
 * one's code. Never reads their text. Returns the function that stops watching.
 */
export function watchAlerts(root: Node, report: (code: ErrorCode) => void): () => void {
  const seen = alertReporter(report);
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        if (r.target instanceof HTMLElement && r.target.matches('[role="alert"]')) seen(r.target);
        continue;
      }
      for (const node of r.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const alerts = node.matches('[role="alert"]') ? [node] : [...node.querySelectorAll('[role="alert"]')];
        for (const el of alerts) seen(el);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-error-code'] });
  return () => observer.disconnect();
}
