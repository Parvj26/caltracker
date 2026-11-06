import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FreeExercise } from '@caltracker/shared';
import { describe, expect, it } from 'vitest';
import { EXTRA_ID_PREFIX, validateExtras, type ExtraExercise } from './caltracker-extras';

const dir = path.dirname(fileURLToPath(import.meta.url));
const extras = JSON.parse(readFileSync(path.join(dir, 'caltracker-extra-exercises.json'), 'utf8')) as ExtraExercise[];
const free = JSON.parse(
  readFileSync(path.join(dir, 'fixtures', 'free-exercise-db', 'exercises.json'), 'utf8'),
) as FreeExercise[];
const freeIds = free.map((e) => e.id);
const good = (): ExtraExercise => structuredClone(extras[0]!);

describe('CalTracker extra exercises', () => {
  it('ships the 10 trainer exercises and they validate', () => {
    expect(extras).toHaveLength(10);
    expect(validateExtras(extras, freeIds)).toHaveLength(10);
    expect(extras.map((e) => e.name)).toContain('Machine Assisted Pull Up');
  });

  it('rejects an unknown muscle', () => {
    expect(() => validateExtras([{ ...good(), primaryMuscles: ['quads'] }], freeIds)).toThrow(/unknown muscle "quads"/);
  });

  it('rejects an unknown category or tracking type', () => {
    expect(() => validateExtras([{ ...good(), category: 'yoga' }], freeIds)).toThrow(/unknown category/);
    expect(() => validateExtras([{ ...good(), trackingType: 'calories' }], freeIds)).toThrow(/tracking type/);
  });

  it('rejects ids without the caltracker: prefix or that clash with free-exercise-db', () => {
    expect(() => validateExtras([{ ...good(), id: 'Barbell_Squat' }], freeIds)).toThrow(/must start with/);
    expect(() => validateExtras([good()], [good().id])).toThrow(/clashes/);
  });

  it('rejects duplicates and images', () => {
    expect(() => validateExtras([good(), good()], freeIds)).toThrow(/duplicate id/);
    expect(() => validateExtras([{ ...good(), images: ['x.jpg'] }], freeIds)).toThrow(/images/);
  });

  it('never uses an id shape free-exercise-db uses', () => {
    expect(freeIds.some((id) => id.startsWith(EXTRA_ID_PREFIX) || id.includes(':'))).toBe(false);
  });
});
