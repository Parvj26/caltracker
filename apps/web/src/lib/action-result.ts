import type { ErrorCode } from '@caltracker/shared';

/** What a server action returns when it refuses or fails: only a code, never free text (it can hold user data). */
export type ActionFailure = { ok: false; code: ErrorCode };

/**
 * Builds a failure. `where` names the action (e.g. `action:assign.assignProgram`); stream C will use
 * it to report server failures next to the click that caused them.
 */
export function fail(code: ErrorCode, where: string): ActionFailure {
  void where;
  return { ok: false, code };
}
