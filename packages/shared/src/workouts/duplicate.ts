import type { WorkoutDoc } from './schema';

export const COPY_SUFFIX = ' (copy)';

/**
 * "<name> (copy)", shortening the name (at a word break when it can) so the result still fits `max` characters.
 * `suffix` replaces " (copy)", e.g. " (Week 3)" for a copy made for one day of a program.
 */
export function copyName(name: string, max = 100, suffix = COPY_SUFFIX): string {
  const base = name.trim();
  if (base.length + suffix.length <= max) return `${base}${suffix}`;
  const room = max - suffix.length;
  const cut = base.slice(0, room);
  const space = cut.lastIndexOf(' ');
  const short = (base[room] === ' ' || space < room / 2 ? cut : cut.slice(0, space)).trimEnd();
  return `${short}${suffix}`;
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
        substitutes: e.substitutes.map((sub) => ({ ...sub, id: makeId(), sets: sub.sets.map((s) => ({ ...s, id: makeId() })) })),
      })),
    })),
  };
}
