import type { MacroKey } from '@caltracker/shared';

/** What the meal form holds, as far as "has the coach changed anything?" goes. */
export type MealFormSnapshot = {
  name: string;
  macroText: Record<MacroKey, string>;
  ingredients: string;
  howTo: string;
  /** The saved photo still attached, by its path (null once removed). */
  photoPath: string | null;
  /** A new photo has been picked but not saved. */
  newFile: boolean;
};

const same = (a: string, b: string) => a.trim() === b.trim();

/** True when the form differs from what it opened with, so Cancel should ask "Discard changes?" first. */
export function mealFormDirty(initial: MealFormSnapshot, now: MealFormSnapshot): boolean {
  return (
    !same(initial.name, now.name) ||
    !same(initial.ingredients, now.ingredients) ||
    !same(initial.howTo, now.howTo) ||
    (Object.keys(initial.macroText) as MacroKey[]).some((k) => !same(initial.macroText[k], now.macroText[k])) ||
    initial.photoPath !== now.photoPath ||
    now.newFile
  );
}
