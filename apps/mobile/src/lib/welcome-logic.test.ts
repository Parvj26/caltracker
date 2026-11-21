import { describe, expect, it } from 'vitest';
import { COLD_START, WELCOME_AFTER_BACKGROUND_MS, WELCOME_MAX_MS, WELCOME_MIN_MS, welcomeAgain, welcomeOnResume, welcomeStep, welcomeText, type WelcomeState } from './welcome-logic';

const MIN = 60 * 1000;
const hidden: WelcomeState = { showing: false, opens: 0, ready: true, minDone: true };
const resume = (awayMs: number | null, onToday = true, workoutInProgress = false) =>
  ({ type: 'resume', backgroundedAt: awayMs === null ? null : 1_000_000, now: 1_000_000 + (awayMs ?? 0), onToday, workoutInProgress }) as const;

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
    expect(welcomeStep(hidden, resume(11 * MIN))).toEqual({ showing: true, opens: 1, ready: false, minDone: false });
  });

  it('a quick switch away goes straight back to where you were', () => {
    expect(welcomeStep(hidden, resume(3 * MIN))).toBe(hidden);
    expect(welcomeStep(hidden, resume(null))).toBe(hidden);
  });

  it('not on a resume when there is no Today to wait for (signed out, no coach)', () => {
    expect(welcomeStep(hidden, resume(30 * MIN, false))).toBe(hidden);
  });

  it('never covers another screen: back onto the logger, a preview or another tab just resumes', () => {
    expect(welcomeAgain(resume(30 * MIN, false))).toBe(false);
    expect(welcomeStep(hidden, resume(30 * MIN, false))).toBe(hidden);
  });

  it('never while a workout is in progress, even on Today', () => {
    expect(welcomeAgain(resume(30 * MIN, true, true))).toBe(false);
    expect(welcomeStep(hidden, resume(30 * MIN, true, true))).toBe(hidden);
  });

  it('only onto Today, with no workout going, after more than 10 minutes', () => {
    expect(welcomeAgain(resume(10 * MIN + 1, true, false))).toBe(true);
    expect(welcomeAgain(resume(10 * MIN, true, false))).toBe(false);
  });

  it('a cold start shows from the first frame, waiting for both Today and the minimum time', () => {
    expect(COLD_START).toEqual({ showing: true, opens: 0, ready: false, minDone: false });
  });

  it('a resume while already showing changes nothing', () => {
    expect(welcomeStep(COLD_START, resume(30 * MIN))).toBe(COLD_START);
  });
});

describe('welcome: when it leaves (at the later of Today ready and 800 ms)', () => {
  it('stays at least 800 ms, at most 1.5 s', () => {
    expect(WELCOME_MIN_MS).toBe(800);
    expect(WELCOME_MAX_MS).toBe(1500);
  });

  it('Today ready early: waits for the minimum time', () => {
    const ready = welcomeStep(COLD_START, { type: 'ready' });
    expect(ready.showing).toBe(true);
    expect(welcomeStep(ready, { type: 'min-elapsed' }).showing).toBe(false);
  });

  it('Today slower than the minimum: leaves the moment Today is ready', () => {
    const min = welcomeStep(COLD_START, { type: 'min-elapsed' });
    expect(min.showing).toBe(true);
    expect(welcomeStep(min, { type: 'ready' }).showing).toBe(false);
  });

  it('leaves at the ceiling if Today never says so', () => {
    const min = welcomeStep(COLD_START, { type: 'min-elapsed' });
    expect(welcomeStep(min, { type: 'timeout' }).showing).toBe(false);
  });

  it('leaves at once when there is no Today to load (signed out, no coach: no name to welcome)', () => {
    expect(welcomeStep(COLD_START, { type: 'no-today' }).showing).toBe(false);
  });

  it('a later Today load or timer while hidden changes nothing', () => {
    expect(welcomeStep(hidden, { type: 'ready' })).toBe(hidden);
    expect(welcomeStep(hidden, { type: 'min-elapsed' })).toBe(hidden);
  });

  it('a fresh open after a long time away starts both waits again', () => {
    const open = welcomeStep(hidden, resume(11 * MIN));
    const ready = welcomeStep(open, { type: 'ready' });
    expect(ready.showing).toBe(true);
    expect(welcomeStep(ready, { type: 'min-elapsed' })).toEqual({ showing: false, opens: 1, ready: true, minDone: true });
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
