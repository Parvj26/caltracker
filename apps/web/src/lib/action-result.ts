import { isServerFailureCode, type ErrorCode } from '@caltracker/shared';
import { reportServerError } from '@/lib/analytics/server';

/** What a server action returns when it refuses or fails: only a code, never free text (it can hold user data). */
export type ActionFailure = { ok: false; code: ErrorCode };

/**
 * Builds a failure. `where` names the action (e.g. `action:assign.assignProgram`). A server failure (`server_error`
 * or a `*_failed` code) is also reported to PostHog, so it shows next to the click that caused it; a refusal of what
 * the coach entered (`field_required`, `request_invalid` …) is not. Only the code and `where` are sent, never the
 * error itself, and reporting never throws or delays the answer.
 */
export function fail(code: ErrorCode, where: string): ActionFailure {
  try {
    if (isServerFailureCode(code)) reportServerError({ code, where });
  } catch {
    // Reporting is best effort.
  }
  return { ok: false, code };
}
