// The welcome on a fresh open (approved Welcome board): when it shows, what it says, when it leaves. Pure (no React,
// no timers), so it is unit tested. welcome-gate.ts holds the live state; WelcomeOverlay draws it.

/** Coming back after longer than this in the background counts as a fresh open. */
export const WELCOME_AFTER_BACKGROUND_MS = 10 * 60 * 1000;

/**
 * The welcome never holds Today back: it leaves the moment Today's first load is done. This is only the ceiling for
 * when that signal never comes (a deep link to another screen, the update screen), so the app is never stuck behind it.
 */
export const WELCOME_MAX_MS = 1500;

/** Its fade into Today, and the name's fade in under the logo. */
export const WELCOME_FADE_MS = 250;
export const WELCOME_NAME_FADE_MS = 180;

/** True when coming back to the front counts as a fresh open: more than 10 minutes in the background. */
export function welcomeOnResume(backgroundedAt: number | null, now: number): boolean {
  return backgroundedAt !== null && now - backgroundedAt > WELCOME_AFTER_BACKGROUND_MS;
}

export type WelcomeState = {
  showing: boolean;
  /** Counts fresh opens after a long time away: Today reads itself again on each, and the welcome waits for that. */
  opens: number;
};

export type WelcomeEvent =
  /** Back to the front. Today is mounted only when signed in with a coach: otherwise there is nothing to wait for. */
  | { type: 'resume'; backgroundedAt: number | null; now: number; todayMounted: boolean }
  /** Today's load finished (shown, or its error shown). */
  | { type: 'ready' }
  /** Signed out or without a coach: Today never loads. */
  | { type: 'no-today' }
  /** WELCOME_MAX_MS passed. */
  | { type: 'timeout' };

/** A cold start: the app has just launched, so the welcome is up from the first frame (it continues the splash). */
export const COLD_START: WelcomeState = { showing: true, opens: 0 };

export function welcomeStep(state: WelcomeState, event: WelcomeEvent): WelcomeState {
  switch (event.type) {
    case 'resume':
      if (state.showing || !event.todayMounted || !welcomeOnResume(event.backgroundedAt, event.now)) return state;
      return { showing: true, opens: state.opens + 1 };
    case 'ready':
    case 'no-today':
    case 'timeout':
      return state.showing ? { ...state, showing: false } : state;
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
