import type { Units } from '../units/units';
import type { WorkoutDoc } from './schema';
import { formatSetsSummary } from './targets';

/** One line of a calendar card's preview: `text` on screen, `spoken` for screen readers. */
export type PreviewLine = { text: string; spoken: string };
export type WorkoutPreview = { lines: PreviewLine[]; more: number };

/**
 * The first few exercises of a planned workout for a calendar card, in order: "4× Rainbow Squat · 10 lb × 12, 15 lb
 * × 10, …" (the set count, the name, then its sets worded as formatSetsSummary words them). A pick-one group is a
 * single line, "Pick one: Squat or Leg Press", since the client does only one of them. `more` counts the lines left
 * out ("+ 7 more exercises"); a pick-one group counts as one.
 */
export function workoutPreview(doc: Pick<WorkoutDoc, 'blocks'>, units: Units, max = 3): WorkoutPreview {
  const all: PreviewLine[] = [];
  for (const block of doc.blocks) {
    if (block.kind === 'choice') {
      const names = block.exercises.map((e) => e.exerciseName).join(' or ');
      all.push({ text: `Pick one: ${names}`, spoken: `Pick one: ${names}` });
      continue;
    }
    for (const e of block.exercises) {
      const sets = formatSetsSummary(e.sets, e.trackingType, units);
      all.push({
        text: `${sets.count}× ${e.exerciseName}${sets.text ? ` · ${sets.text}` : ''}`,
        spoken: `${e.exerciseName}, ${sets.count} ${sets.count === 1 ? 'set' : 'sets'}${sets.spoken ? `: ${sets.spoken}` : ''}`,
      });
    }
  }
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) };
}
