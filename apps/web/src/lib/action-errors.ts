import { errorMessage, type ErrorCode } from '@caltracker/shared';

/**
 * A page loaded before a deploy still holds the old server action ids. After the deploy the server doesn't know
 * them, so nothing reaches the database and only a reload (which fetches the new ids) helps.
 *
 * Next 16 answers such a call with status 409, `x-nextjs-action-not-found: 1` and the text "Server Action
 * unavailable.", and the browser throws an UnrecognizedActionError: `Server Action "<id>" was not found on the
 * server.` If a proxy drops that header, the browser throws a plain Error with the response text instead. Older Next
 * versions said "Failed to find Server Action". The name check covers Next's own error class without importing
 * Next internals.
 */
const STALE_TEXT = /Server Action "[^"]*" was not found on the server|Server Action unavailable|Failed to find Server Action/i;

export const STALE_DEPLOY_MESSAGE = errorMessage('stale_deploy');

export function isStaleDeployError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === 'UnrecognizedActionError' || STALE_TEXT.test(e.message);
}

/** The message for a failed save: the reload prompt after a deploy, otherwise `fallback`. */
export const failureMessage = (e: unknown, fallback: string): string =>
  isStaleDeployError(e) ? STALE_DEPLOY_MESSAGE : fallback;

/** The code for a failed save: `stale_deploy` after a deploy, otherwise `fallback`. */
export const failureCode = (e: unknown, fallback: ErrorCode): ErrorCode => (isStaleDeployError(e) ? 'stale_deploy' : fallback);

/** Thrown by optimistic saves when the server refused with a code, so the catch can show that code's message. */
export class ActionRefusedError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.name = 'ActionRefusedError';
    this.code = code;
  }
}
