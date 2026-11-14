// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { menuOpensUp, shouldOpenUp } from './menu-placement';

const screen = { visibleTop: 0, visibleBottom: 664 };

it('opens below when it fits there', () => {
  expect(menuOpensUp({ ...screen, buttonTop: 100, buttonBottom: 144, menuHeight: 280 })).toBe(false);
});

it('flips up when a card low on the screen would push the menu past the bottom', () => {
  expect(menuOpensUp({ ...screen, buttonTop: 520, buttonBottom: 564, menuHeight: 280 })).toBe(true);
});

it('stays below when there is even less room above', () => {
  expect(menuOpensUp({ visibleTop: 0, visibleBottom: 300, buttonTop: 60, buttonBottom: 104, menuHeight: 280 })).toBe(false);
});

it('counts only the visible part of the page (the visual viewport)', () => {
  // Fits the layout viewport, but the keyboard or Safari's bar leaves only 400 px on screen.
  expect(menuOpensUp({ visibleTop: 0, visibleBottom: 400, buttonTop: 300, buttonBottom: 344, menuHeight: 200 })).toBe(true);
});

afterEach(() => {
  document.body.innerHTML = '';
});

it('reads the button and menu from the page', () => {
  document.body.innerHTML = '<button></button><ul></ul>';
  const button = document.querySelector('button')!;
  const menu = document.querySelector('ul')!;
  const rect = (top: number, height: number) => () => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  button.getBoundingClientRect = rect(window.innerHeight - 60, 44);
  menu.getBoundingClientRect = rect(0, 280);
  expect(shouldOpenUp(button, menu)).toBe(true);
  button.getBoundingClientRect = rect(20, 44);
  expect(shouldOpenUp(button, menu)).toBe(false);
});
