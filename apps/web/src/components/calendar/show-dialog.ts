/**
 * Fields that open a native picker on iPhone and iPad as soon as they get focus: a select's wheel, a date or time
 * picker. A dialog must never start on one, or the picker pops open over it.
 */
const PICKER = 'select, input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"], input[type="week"]';
/** What a dialog's own focusing steps can land on, in page order (close enough to the browser's rule for this check). */
const FOCUSABLE =
  'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** Fields that bring up the on-screen keyboard when focused. */
const TYPING = 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"], textarea';
/** A touch screen (iPhone, iPad): focusing a text field there pops the keyboard over half the dialog. */
const isTouchScreen = () => typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

/**
 * Opens a modal dialog without landing focus on a native picker. When the dialog would start on a select or a date
 * field, it starts on its search box if it has one, else on the dialog itself (a screen reader reads its name, and
 * Tab goes on to the first control). Other dialogs keep the browser's usual first-control focus.
 * With `noKeyboardOnTouch`, a touch screen always starts on the dialog itself, so no keyboard or picker pops open.
 */
export function showDialog(dialog: HTMLDialogElement, options: { noKeyboardOnTouch?: boolean } = {}): void {
  if (dialog.open) return;
  // A picker dialog on a phone: the list shows with its search box ready, and the keyboard comes only when it is tapped.
  if (options.noKeyboardOnTouch && isTouchScreen()) {
    dialog.setAttribute('autofocus', '');
    dialog.tabIndex = -1;
    dialog.showModal();
    const active = dialog.ownerDocument.activeElement;
    if (active instanceof HTMLElement && active !== dialog && active.matches(`${TYPING}, ${PICKER}`)) dialog.focus();
    return;
  }
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
