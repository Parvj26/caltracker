/** The program grid's days, labels and DOM ids, so focus can land somewhere sensible after a chip moves. */
export const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const cellLabel = (week: number, day: number) => `Week ${week}, Day ${day}`;
export const chipDomId = (slotId: string) => `program-chip-${slotId}`;
export const focusSoon = (domId: string) => requestAnimationFrame(() => document.getElementById(domId)?.focus());
export const copyWeekButtonDomId = (week: number) => `program-copy-week-${week}`;
