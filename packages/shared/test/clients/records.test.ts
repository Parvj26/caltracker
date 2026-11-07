import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_MAX_BYTES,
  GOAL_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  countdownLabel,
  daysUntil,
  documentKind,
  formatFileSize,
  validateDocumentName,
  validateGoal,
  validateLimitations,
  validateNote,
} from '../../src/clients/records';

describe('countdown', () => {
  it('counts whole days to the target', () => {
    expect(daysUntil('2026-12-25', '2026-11-06')).toBe(49);
    expect(countdownLabel('2026-12-25', '2026-11-06')).toBe('49 days to go');
    expect(countdownLabel('2026-11-07', '2026-11-06')).toBe('1 day to go');
  });
  it('says Today on the day and how long ago after it', () => {
    expect(countdownLabel('2026-11-06', '2026-11-06')).toBe('Today');
    expect(countdownLabel('2026-11-05', '2026-11-06')).toBe('Passed yesterday');
    expect(countdownLabel('2026-11-03', '2026-11-06')).toBe('Passed 3 days ago');
  });
});

describe('text checks', () => {
  it('trims and limits notes', () => {
    expect(validateNote('  Prefers mornings ')).toEqual({ ok: true, value: 'Prefers mornings' });
    expect(validateNote('   ').ok).toBe(false);
    expect(validateNote('x'.repeat(NOTE_MAX_LENGTH)).ok).toBe(true);
    expect(validateNote('x'.repeat(NOTE_MAX_LENGTH + 1)).ok).toBe(false);
  });
  it('allows empty limitations (cleared) but not too long', () => {
    expect(validateLimitations('  ')).toEqual({ ok: true, value: '' });
    expect(validateLimitations('x'.repeat(NOTE_MAX_LENGTH + 1)).ok).toBe(false);
  });
  it('needs a goal of 1 to 200 characters', () => {
    expect(validateGoal(' Run a half marathon ')).toEqual({ ok: true, value: 'Run a half marathon' });
    expect(validateGoal('').ok).toBe(false);
    expect(validateGoal('x'.repeat(GOAL_MAX_LENGTH + 1)).ok).toBe(false);
  });
  it('needs a document name of 1 to 120 characters', () => {
    expect(validateDocumentName(' Plan.pdf ')).toEqual({ ok: true, value: 'Plan.pdf' });
    expect(validateDocumentName(' ').ok).toBe(false);
    expect(validateDocumentName('x'.repeat(121)).ok).toBe(false);
  });
});

describe('documentKind', () => {
  it('accepts PDFs up to 5 MB and images (they are compressed before upload)', () => {
    expect(documentKind('application/pdf', 1000)).toBe('pdf');
    expect(documentKind('application/pdf', DOCUMENT_MAX_BYTES + 1)).toBe(null);
    expect(documentKind('image/heic', 20_000_000)).toBe('image');
    expect(documentKind('image/png', 100)).toBe('image');
  });
  it('refuses video and anything else', () => {
    expect(documentKind('video/mp4', 1000)).toBe(null);
    expect(documentKind('video/quicktime', 1000)).toBe(null);
    expect(documentKind('application/zip', 1000)).toBe(null);
    expect(documentKind('', 1000)).toBe(null);
    expect(documentKind('application/pdf', 0)).toBe(null);
  });
});

describe('formatFileSize', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [1_572_864, '1.5 MB'],
    [5_242_880, '5 MB'],
  ])('%d bytes is %s', (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text);
  });
});
