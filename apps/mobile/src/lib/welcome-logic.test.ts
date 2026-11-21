import { describe, expect, it } from 'vitest';
import { COLD_START, WELCOME_AFTER_BACKGROUND_MS, welcomeOnResume, welcomeStep, welcomeText, type WelcomeState } from './welcome-logic';

const MIN = 60 * 1000;
const hidden: WelcomeState = { showing: false, opens: 0 };
const resume = (awayMs: number | null, todayMounted = true) =>
  ({ type: 'resume', backgroundedAt: awayMs === null ? null : 1_000_000, now: 1_000_000 + (awayMs ?? 0), todayMounted }) as const;

describe('welcome: when it shows', () => {
  it('shows on a cold start, from the first frame', () => {
    expect(COLD_START.showing).toBe(true);
  });

  it('shows again only after more than 10 minutes in the background', () => {
    expect(WELCOME_AFTER_BACKGROUND_MS).toBe(10 * MIN);
    expect(welcomeOnResume(0, 10 * MIN + 1)).toBe(true);
    expect(welcomeOnResume(0, 10 * MIN)).toBe(false);
    expect(welcomeOnResume(0, 2 * MIN)).toBe(false);
    // Back from Control Center or a call banner: never went to the background.
    expect(welcomeOnResume(null, 60 * MIN)).toBe(false);
  });

  it('a long time away opens it again and asks Today to read itself again', () => {
    expect(welcomeStep(hidden, resume(11 * MIN))).toEqual({ showing: true, opens: 1 });
  });

  it('a quick switch away goes straight back to where you were', () => {
    expect(welcomeStep(hidden, resume(3 * MIN))).toBe(hidden);
    expect(welcomeStep(hidden, resume(null))).toBe(hidden);
  });

  it('not on a resume when there is no Today to wait for (signed out, no coach)', () => {
    expect(welcomeStep(hidden, resume(30 * MIN, false))).toBe(hidden);
  });

  it('a resume while already showing changes nothing', () => {
    expect(welcomeStep(COLD_START, resume(30 * MIN))).toBe(COLD_START);
  });
});

describe('welcome: when it leaves (never an added wait)', () => {
  it('leaves the moment Today is ready', () => {
    expect(welcomeStep(COLD_START, { type: 'ready' }).showing).toBe(false);
  });

  it('leaves at once when there is no Today to load', () => {
    expect(welcomeStep(COLD_START, { type: 'no-today' }).showing).toBe(false);
  });

  it('leaves at the ceiling if Today never says so', () => {
    expect(welcomeStep(COLD_START, { type: 'timeout' }).showing).toBe(false);
  });

  it('a later Today load while hidden changes nothing', () => {
    expect(welcomeStep(hidden, { type: 'ready' })).toBe(hidden);
  });

  it('keeps the count of fresh opens when it leaves', () => {
    const open = welcomeStep(hidden, resume(11 * MIN));
    expect(welcomeStep(open, { type: 'ready' })).toEqual({ showing: false, opens: 1 });
  });
});

describe('welcome: what it says', () => {
  it('"Welcome back," and the first name', () => {
    expect(welcomeText('Parv Jain', false)).toEqual({ lead: 'Welcome back,', name: 'Parv', accessibilityLabel: 'Welcome back, Parv' });
  });

  it('"Welcome," for a first-time client', () => {
    expect(welcomeText('Maya', true)).toEqual({ lead: 'Welcome,', name: 'Maya', accessibilityLabel: 'Welcome, Maya' });
  });

  it('just the logo without a saved name', () => {
    expect(welcomeText(null, false)).toBeNull();
    expect(welcomeText('   ', true)).toBeNull();
  });
});
