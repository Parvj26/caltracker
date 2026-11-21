// The welcome on a fresh open (approved Welcome board): when it shows, what it says, when it leaves. Pure (no React,
// no timers), so it is unit tested. welcome-gate.ts holds the live state; WelcomeOverlay draws it.

/** Coming back after longer than this in the background counts as a fresh open. */
export const WELCOME_AFTER_BACKGROUND_MS = 10 * 60 * 1000;

/**
 * The welcome stays at least this long on a fresh open, so it reads as a deliberate welcome rather than a flash (the
 * name's fade-in and the logo's lift finish well inside it). It leaves at the later of this and Today being ready.
 */
export const WELCOME_MIN_MS = 800;

/**
 * The ceiling for when Today's signal never comes (a deep link to another screen, the update screen), so the app is
 * never stuck behind the welcome.
 */
export const WELCOME_MAX_MS = 1500;

/** Its fade into Today, and the name's fade in under the logo. */
export const WELCOME_FADE_MS = 250;
export const WELCOME_NAME_FADE_MS = 180;

/** True when coming back to the front counts as a fresh open: more than 10 minutes in the background. */
export function welcomeOnResume(backgroundedAt: number | null, now: number): boolean {
  return backgroundedAt !== null && now - backgroundedAt > WELCOME_AFTER_BACKGROUND_MS;
}

/**
 * Coming back after a long time away shows the welcome only onto the Today tab with no workout going. It never covers
 * the workout logger or any other screen mid-task: there the app just resumes where the client was.
 */
export function welcomeAgain(r: { backgroundedAt: number | null; now: number; onToday: boolean; workoutInProgress: boolean }): boolean {
  return r.onToday && !r.workoutInProgress && welcomeOnResume(r.backgroundedAt, r.now);
}

export type WelcomeState = {
  showing: boolean;
  /** Counts fresh opens after a long time away: Today reads itself again on each, and the welcome waits for that. */
  opens: number;
  /** Today's load is done for this open. */
  ready: boolean;
  /** WELCOME_MIN_MS has passed since the welcome appeared. */
  minDone: boolean;
};

export type WelcomeEvent =
  /**
   * Back to the front. `onToday`: the Today tab is the screen in view (nothing pushed over it; only when signed in
   * with a coach). `workoutInProgress`: a workout is being logged on this phone.
   */
  | { type: 'resume'; backgroundedAt: number | null; now: number; onToday: boolean; workoutInProgress: boolean }
  /** Today's load finished (shown, or its error shown). */
  | { type: 'ready' }
  /** WELCOME_MIN_MS passed since the welcome appeared. */
  | { type: 'min-elapsed' }
  /** Signed out or without a coach: Today never loads, and there is no name to welcome (the logo just fades). */
  | { type: 'no-today' }
  /** WELCOME_MAX_MS passed. */
  | { type: 'timeout' };

/** A cold start: the app has just launched, so the welcome is up from the first frame (it continues the splash). */
export const COLD_START: WelcomeState = { showing: true, opens: 0, ready: false, minDone: false };

const hide = (s: WelcomeState): WelcomeState => (s.showing ? { ...s, showing: false } : s);

export function welcomeStep(state: WelcomeState, event: WelcomeEvent): WelcomeState {
  switch (event.type) {
    case 'resume':
      if (state.showing || !welcomeAgain(event)) return state;
      return { showing: true, opens: state.opens + 1, ready: false, minDone: false };
    // It leaves at the later of Today being ready and the minimum time.
    case 'ready':
      if (!state.showing || state.ready) return state;
      return state.minDone ? hide({ ...state, ready: true }) : { ...state, ready: true };
    case 'min-elapsed':
      if (!state.showing || state.minDone) return state;
      return state.ready ? hide({ ...state, minDone: true }) : { ...state, minDone: true };
    case 'no-today':
    case 'timeout':
      return hide(state);
  }
}

export type WelcomeText = { lead: string; name: string; accessibilityLabel: string };

/**
 * "Welcome back," / "Parv" under the logo; "Welcome," / "Maya" for a first-time client (as Today's own header says).
 * Null without a saved first name: then just the logo shows.
 */
export function welcomeText(firstName: string | null, firstTime: boolean): WelcomeText | null {
  const name = firstName?.trim().split(/\s+/)[0];
  if (!name) return null;
  const lead = firstTime ? 'Welcome,' : 'Welcome back,';
  return { lead, name, accessibilityLabel: `${lead} ${name}` };
}
