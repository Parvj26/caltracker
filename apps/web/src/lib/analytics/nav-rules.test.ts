import { describe, expect, it } from 'vitest';
import { buildProgramLeft, navTarget, slowNavMs } from './nav-rules';

describe('buildProgramLeft', () => {
  it('stays open on the new form and on the program being built', () => {
    expect(buildProgramLeft('/programs/new', 'p1')).toBe(false);
    expect(buildProgramLeft('/programs/p1', 'p1')).toBe(false);
    expect(buildProgramLeft('/programs/new', null)).toBe(false);
  });
  it('is given up anywhere else, including another program', () => {
    expect(buildProgramLeft('/programs/p2', 'p1')).toBe(true);
    expect(buildProgramLeft('/clients', 'p1')).toBe(true);
    expect(buildProgramLeft('/programs', null)).toBe(true);
  });
});

describe('navTarget', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  it('returns the path a plain click goes to', () => {
    expect(navTarget('/clients?x=1', '_self', click, 'https://a.app', '/home')).toBe('/clients');
  });
  it('ignores new-tab clicks and same-page query changes', () => {
    expect(navTarget('/clients', '_blank', click, 'https://a.app', '/home')).toBeNull();
    expect(navTarget('/clients', '', { ...click, metaKey: true }, 'https://a.app', '/home')).toBeNull();
    expect(navTarget('/home?tab=2', '', click, 'https://a.app', '/home')).toBeNull();
  });
});

describe('slowNavMs', () => {
  it('reports only real slow loads, not stale starts', () => {
    expect(slowNavMs(1000, 4000)).toBe(3000);
    expect(slowNavMs(1000, 2500)).toBeNull();
    expect(slowNavMs(1000, 20_000)).toBeNull();
  });
});
