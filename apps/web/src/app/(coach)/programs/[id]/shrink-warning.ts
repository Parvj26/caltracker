/**
 * What the coach reads before shrinking a program from `fromWeeks` to `toWeeks` removes `count` workouts
 * (Review Focus 5), e.g. "Weeks 5–6 have 3 workouts. They'll be removed from this program."
 */
export function shrinkWarning(fromWeeks: number, toWeeks: number, count: number): string {
  const first = toWeeks + 1;
  const weeks = first === fromWeeks ? `Week ${first} has` : `Weeks ${first}–${fromWeeks} have`;
  const workouts = count === 1 ? '1 workout' : `${count} workouts`;
  const pronoun = count === 1 ? "It'll" : "They'll";
  return `${weeks} ${workouts}. ${pronoun} be removed from this program.`;
}
