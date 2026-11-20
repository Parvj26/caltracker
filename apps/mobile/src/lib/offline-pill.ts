// The words for the small grey "Offline" pill beside a screen's title (approved less-text board LT9). It replaces the
// offline sentences on Today, Food, Progress, Workouts, History, the sticker book and Community; one tap shows the
// note under the title. Pure, so it is unit tested.

export const OFFLINE_PILL_TEXT = 'Offline';

/** The one line a tap on the pill shows. */
export const OFFLINE_PILL_NOTE = 'Saved on your phone, updates when you’re back online';

/** What a screen reader says for the pill: the label always carries the note, so nobody has to tap to hear it. */
export function offlinePillA11y(open: boolean): { label: string; hint: string; expanded: boolean } {
  return {
    label: `${OFFLINE_PILL_TEXT}. ${OFFLINE_PILL_NOTE}`,
    hint: open ? 'Hides the note' : 'Shows the note under the title',
    expanded: open,
  };
}
