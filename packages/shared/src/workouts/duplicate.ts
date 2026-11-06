import type { WorkoutDoc } from './schema';

export const COPY_SUFFIX = ' (copy)';

/** "<name> (copy)", shortening the name (at a word break when it can) so the result still fits `max` characters. */
export function copyName(name: string, max = 100): string {
  const base = name.trim();
  if (base.length + COPY_SUFFIX.length <= max) return `${base}${COPY_SUFFIX}`;
  const room = max - COPY_SUFFIX.length;
  const cut = base.slice(0, room);
  const space = cut.lastIndexOf(' ');
  const short = (base[room] === ' ' || space < room / 2 ? cut : cut.slice(0, space)).trimEnd();
  return `${short}${COPY_SUFFIX}`;
}

/** A copy of a workout to save as a new one: every row gets a new id and the name becomes "<name> (copy)". */
export function duplicateWorkoutDoc(doc: WorkoutDoc, makeId: () => string): WorkoutDoc {
  const sectionIds = new Map(doc.sections.map((s) => [s.id, makeId()]));
  return {
    ...doc,
    id: makeId(),
    name: copyName(doc.name),
    sections: doc.sections.map((s) => ({ ...s, id: sectionIds.get(s.id)! })),
    blocks: doc.blocks.map((b) => ({
      ...b,
      id: makeId(),
      sectionId: b.sectionId === null ? null : (sectionIds.get(b.sectionId) ?? null),
      exercises: b.exercises.map((e) => ({
        ...e,
        id: makeId(),
        sets: e.sets.map((s) => ({ ...s, id: makeId() })),
      })),
    })),
  };
}
