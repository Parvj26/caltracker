// The Coach tab's "Meals from <coach> · N" button (docs/superpowers/specs/2026-11-09-food-and-coach-meals-design.md,
// decision 11). Pure, so it is unit tested.

/** Its label, count badge and spoken label; null (hidden) when the coach shares no meals. */
export function coachMealsButton(count: number, firstName: string | null): { label: string; badge: string; accessibilityLabel: string } | null {
  if (count <= 0) return null;
  const label = `Meals from ${firstName ?? 'your coach'}`;
  return {
    label,
    badge: count > 99 ? '99+' : String(count),
    accessibilityLabel: `${label}, ${count === 1 ? '1 meal' : `${count} meals`}`,
  };
}
