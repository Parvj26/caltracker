import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FreeExercise } from '@caltracker/shared';
import { describe, expect, it } from 'vitest';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'free-exercise-db');
const list = JSON.parse(readFileSync(path.join(dir, 'exercises.json'), 'utf8')) as FreeExercise[];

describe('free-exercise-db fixture', () => {
  it('has 20 exercises including Barbell_Squat and Plank', () => {
    expect(list).toHaveLength(20);
    expect(list.map((e) => e.id)).toEqual(expect.arrayContaining(['Barbell_Squat', 'Plank']));
  });

  it('has every referenced image on disk', () => {
    const missing = list.flatMap((e) => e.images).filter((p) => !existsSync(path.join(dir, p)));
    expect(missing).toEqual([]);
  });
});
