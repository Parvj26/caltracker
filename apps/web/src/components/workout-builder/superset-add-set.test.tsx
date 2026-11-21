import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SupersetAddSet, onlyThisLabel } from './superset-add-set';

describe('a superset’s + Set ▾', () => {
  it('names the one exercise the menu adds to, with its badge', () => {
    expect(onlyThisLabel('Chest Press', 'C1')).toBe('Only Chest Press (C1)');
    expect(onlyThisLabel('Chest Press', '')).toBe('Only Chest Press');
  });

  it('is one button for every exercise ("copies last sets") and a ▾ that opens a menu', () => {
    const html = renderToStaticMarkup(<SupersetAddSet exerciseName="Chest Press" badge="C1" onRound={() => {}} onOnlyThis={() => {}} />);
    expect(html).toContain('aria-label="Add a set to every exercise in the superset"');
    expect(html).toContain('(copies last sets)');
    expect(html).toContain('aria-haspopup="menu"');
    // Closed to start with.
    expect(html).not.toContain('role="menu"');
    const phone = renderToStaticMarkup(<SupersetAddSet exerciseName="Chest Press" badge="C1" onRound={() => {}} onOnlyThis={() => {}} phone />);
    expect(phone).toContain('copies last sets');
    expect(phone).not.toContain('(copies last sets)');
  });

  it('is off, saying why, once an exercise has 20 sets', () => {
    const html = renderToStaticMarkup(<SupersetAddSet exerciseName="Chest Press" badge="C1" onRound={() => {}} onOnlyThis={() => {}} full />);
    expect(html).toMatch(/<button[^>]*aria-label="Add a set to every exercise in the superset"[^>]*disabled=""/);
    expect(html).toContain('20 sets max');
  });
});
