/**
 * Fields that open a native picker on iPhone and iPad as soon as they get focus: a select's wheel, a date or time
 * picker. A dialog must never start on one, or the picker pops open over it.
 */
const PICKER = 'select, input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"], input[type="week"]';
/** What a dialog's own focusing steps can land on, in page order (close enough to the browser's rule for this check). */
const FOCUSABLE =
  'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Opens a modal dialog without landing focus on a native picker. When the dialog would start on a select or a date
 * field, it starts on its search box if it has one, else on the dialog itself (a screen reader reads its name, and
 * Tab goes on to the first control). Other dialogs keep the browser's usual first-control focus.
 */
export function showDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
  const startsOnPicker = !dialog.querySelector('[autofocus]') && first?.matches(PICKER) === true;
  const search = startsOnPicker ? dialog.querySelector<HTMLElement>('input[type="search"]:not(:disabled)') : null;
  if (startsOnPicker) {
    // The dialog focusing steps pick the [autofocus] element (or the dialog itself when it has the attribute).
    (search ?? dialog).setAttribute('autofocus', '');
    if (!search) dialog.tabIndex = -1;
  }
  dialog.showModal();
  // A browser that skipped the attribute: move off the picker straight away.
  const active = dialog.ownerDocument.activeElement;
  if (startsOnPicker && active instanceof HTMLElement && active.matches(PICKER)) (search ?? dialog).focus();
}
