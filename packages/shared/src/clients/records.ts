import { diffDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';

/**
 * Rules for what a coach keeps about a client on the client page: notes, limitations (injuries), the goal with its
 * countdown, and documents. The limits match the database checks in 20261106006200_client_overview.sql.
 */

export const NOTE_MAX_LENGTH = 2000;
export const GOAL_MAX_LENGTH = 200;
export const DOCUMENT_NAME_MAX_LENGTH = 120;
/** PDFs are stored as they are; images are compressed on the device first and must also fit. */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export type TextCheck = { ok: true; value: string } | { ok: false; error: string };

function check(text: string, min: number, max: number, empty: string, tooLong: string): TextCheck {
  const value = text.trim();
  if (value.length < min) return { ok: false, error: empty };
  if (value.length > max) return { ok: false, error: tooLong };
  return { ok: true, value };
}

export const validateNote = (text: string) => check(text, 1, NOTE_MAX_LENGTH, 'Write something first.', `Keep a note to ${NOTE_MAX_LENGTH} characters.`);
/** Empty is allowed: it clears the limitations. */
export const validateLimitations = (text: string) => check(text, 0, NOTE_MAX_LENGTH, '', `Keep this to ${NOTE_MAX_LENGTH} characters.`);
export const validateGoal = (text: string) => check(text, 1, GOAL_MAX_LENGTH, 'Write the goal first.', `Keep the goal to ${GOAL_MAX_LENGTH} characters.`);
export const validateDocumentName = (text: string) =>
  check(text, 1, DOCUMENT_NAME_MAX_LENGTH, 'Give the document a name.', `Keep the name to ${DOCUMENT_NAME_MAX_LENGTH} characters.`);

/** Whole days from today to the target date (negative once it has passed). */
export function daysUntil(target: IsoDate, today: IsoDate): number {
  return diffDays(today, target);
}

/** "49 days to go", "1 day to go", "Today", "Passed yesterday", "Passed 3 days ago". */
export function countdownLabel(target: IsoDate, today: IsoDate): string {
  const days = daysUntil(target, today);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day to go';
  if (days > 1) return `${days} days to go`;
  if (days === -1) return 'Passed yesterday';
  return `Passed ${-days} days ago`;
}

/**
 * What a chosen file is, or null when it can't be a document: a PDF up to 5 MB, or an image (any size: it's shrunk
 * on the device and checked again). Video and every other type are refused.
 */
export function documentKind(contentType: string, sizeBytes: number): 'pdf' | 'image' | null {
  if (sizeBytes <= 0) return null;
  if (contentType === 'application/pdf') return sizeBytes <= DOCUMENT_MAX_BYTES ? 'pdf' : null;
  if (contentType.startsWith('image/')) return 'image';
  return null;
}

/** "512 B", "2 KB", "1.5 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}
