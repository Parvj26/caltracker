import { errorMessage, type ErrorCode } from '@caltracker/shared';
import { currentScreen, getTaskTracker, track } from './analytics/client';

/** An error to show: its code (always sent with error_shown) and optional fixed copy to show instead of the catalogue message. */
export type ShownError = { code: ErrorCode; text?: string | undefined };

/** Counts the error for the open task and sends its code (never its text). */
export function reportErrorShown(code: ErrorCode): void {
  getTaskTracker().error();
  track('error_shown', { code, screen: currentScreen() });
}

/** The words ErrorText shows: the given fixed copy, else the catalogue message for the code. */
export function errorTextContent(code: ErrorCode, text?: string): string {
  return text ?? errorMessage(code);
}
