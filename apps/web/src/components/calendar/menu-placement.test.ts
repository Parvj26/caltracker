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

it('treats a stuck bar on top and a toast at the bottom as edges of what is visible', () => {
  // A 700 px window: a client bar stuck over the top 100 px, and a toast over the bottom from 600.
  document.body.innerHTML = '<div data-overlay-edge="top" style="position: sticky"></div><div data-overlay-edge="bottom" style="position: fixed"></div><button></button><ul></ul>';
  const [bar, toast] = [...document.querySelectorAll<HTMLElement>('[data-overlay-edge]')];
  const button = document.querySelector('button')!;
  const menu = document.querySelector('ul')!;
  const rect = (top: number, height: number) => () => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
  bar!.getBoundingClientRect = rect(0, 100);
  toast!.getBoundingClientRect = rect(600, 60);
  menu.getBoundingClientRect = rect(0, 300);
  // 248 px free below (to the toast), 192 above (to the bar's bottom, not the window's top): stays below.
  button.getBoundingClientRect = rect(300, 44);
  expect(shouldOpenUp(button, menu)).toBe(false);
  // Lower down, with the toast close below: more room above, so up.
  button.getBoundingClientRect = rect(480, 44);
  expect(shouldOpenUp(button, menu)).toBe(true);
  // A bar that isn't stuck (static, as on a laptop) is not an edge: 292 px above beats 248 below.
  bar!.style.position = 'static';
  button.getBoundingClientRect = rect(300, 44);
  expect(shouldOpenUp(button, menu)).toBe(true);
});

it('keeps clear of both the stuck client bar on top and the phone tab bar at the bottom', () => {
  // A 700 px phone window: the client bar and tabs stuck over the top 104 px, the tab bar fixed over the bottom 64.
  document.body.innerHTML = '<div data-overlay-edge="top" style="position: sticky"></div><nav data-overlay-edge="bottom" style="position: fixed"></nav><button></button><ul></ul>';
  const [bar, tabBar] = [...document.querySelectorAll<HTMLElement>('[data-overlay-edge]')];
  const button = document.querySelector('button')!;
  const menu = document.querySelector('ul')!;
  const rect = (top: number, height: number) => () => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
  bar!.getBoundingClientRect = rect(0, 104);
  tabBar!.getBoundingClientRect = rect(636, 64);
  menu.getBoundingClientRect = rect(0, 280);
  // 292 px free below (to the tab bar's top) fits the 280 px menu: below.
  button.getBoundingClientRect = rect(292, 44);
  expect(shouldOpenUp(button, menu)).toBe(false);
  // 234 below (to the tab bar's top, not the window's 298) and 238 above (to the stuck bar's bottom): up.
  button.getBoundingClientRect = rect(350, 44);
  expect(shouldOpenUp(button, menu)).toBe(true);
  // On iPad and desktop the tab bar is hidden (no height): the window's bottom is the edge, 298 below, so below.
  tabBar!.getBoundingClientRect = rect(0, 0);
  expect(shouldOpenUp(button, menu)).toBe(false);
});
