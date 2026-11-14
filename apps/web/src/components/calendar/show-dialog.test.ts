// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { showDialog } from './show-dialog';

// jsdom has no dialog focusing steps, so this stand-in does what a browser does: focus the [autofocus] element (or
// the dialog itself when it has the attribute), else the first control.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
    const target = this.hasAttribute('autofocus')
      ? this
      : (this.querySelector<HTMLElement>('[autofocus]') ?? this.querySelector<HTMLElement>('input, select, textarea, button'));
    target?.focus();
  };
});
afterEach(() => {
  document.body.innerHTML = '';
});

function dialogWith(html: string): HTMLDialogElement {
  document.body.innerHTML = `<dialog><h2>Title</h2>${html}<button>Cancel</button></dialog>`;
  return document.querySelector('dialog')!;
}

it('starts on the dialog, not the Week select, so iOS does not pop its wheel open', () => {
  const dialog = dialogWith('<label>Week <select><option>Week 1</option></select></label>');
  showDialog(dialog);
  expect(dialog.open).toBe(true);
  expect(document.activeElement).toBe(dialog);
  expect(dialog.tabIndex).toBe(-1);
});

it('starts on the dialog, not the date field', () => {
  const dialog = dialogWith('<label>Date <input type="date" /></label>');
  showDialog(dialog);
  expect(document.activeElement).toBe(dialog);
});

it('starts on the search box when the dialog has one', () => {
  const dialog = dialogWith('<input type="date" /><input type="search" aria-label="Search" />');
  showDialog(dialog);
  expect(document.activeElement).toBe(dialog.querySelector('input[type="search"]'));
});

it('leaves other dialogs on their first control', () => {
  const dialog = dialogWith('<label>Name <input type="text" /></label><input type="date" />');
  showDialog(dialog);
  expect(document.activeElement).toBe(dialog.querySelector('input[type="text"]'));
  expect(dialog.hasAttribute('autofocus')).toBe(false);
});

it('moves off a picker when the browser ignores autofocus', () => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector<HTMLElement>('select')?.focus();
  };
  const dialog = dialogWith('<select><option>1</option></select>');
  showDialog(dialog);
  expect(document.activeElement).toBe(dialog);
});

it('does nothing to a dialog that is already open', () => {
  const dialog = dialogWith('<select><option>1</option></select>');
  dialog.setAttribute('open', '');
  showDialog(dialog);
  expect(dialog.hasAttribute('autofocus')).toBe(false);
});

const touchScreen = (touch: boolean) => {
  window.matchMedia = ((query: string) => ({ matches: touch && query.includes('coarse'), media: query })) as unknown as typeof window.matchMedia;
};

it('on a touch screen, starts on the dialog instead of the search box when asked, so no keyboard pops up', () => {
  touchScreen(true);
  const dialog = dialogWith('<input type="search" aria-label="Search" /><input type="date" />');
  showDialog(dialog, { noKeyboardOnTouch: true });
  expect(document.activeElement).toBe(dialog);
  expect(dialog.tabIndex).toBe(-1);
});

it('with a mouse, still starts on the search box when asked for no keyboard on touch', () => {
  touchScreen(false);
  const dialog = dialogWith('<input type="search" aria-label="Search" />');
  showDialog(dialog, { noKeyboardOnTouch: true });
  expect(document.activeElement).toBe(dialog.querySelector('input[type="search"]'));
});

it('on a touch screen, moves off a text field when the browser ignores autofocus', () => {
  touchScreen(true);
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector<HTMLElement>('input')?.focus();
  };
  const dialog = dialogWith('<input type="search" aria-label="Search" />');
  showDialog(dialog, { noKeyboardOnTouch: true });
  expect(document.activeElement).toBe(dialog);
});
