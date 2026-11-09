const SLOW_MS = 2000;
/** A page change this long after the click is not from that click (the user did something else). */
const STALE_MS = 15_000;

/** True once the coach has left the new-program form and the program being built. */
export function buildProgramLeft(path: string, programId: string | null): boolean {
  if (path === '/programs/new') return false;
  return !(programId !== null && path === `/programs/${programId}`);
}

/** Where a plain click on a link goes, or null for new-tab clicks and links that stay on this page. */
export function navTarget(
  href: string,
  target: string,
  click: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  origin: string,
  currentPath: string,
): string | null {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (target && target !== '_self') return null;
  const path = new URL(href, origin).pathname;
  return path === currentPath ? null : path;
}

/** The load time to report as slow, or null when it was quick or the start is stale. */
export function slowNavMs(startedAt: number, now: number): number | null {
  const ms = Math.round(now - startedAt);
  return ms > SLOW_MS && ms <= STALE_MS ? ms : null;
}
