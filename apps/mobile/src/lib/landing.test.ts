import { describe, expect, it } from 'vitest';
import { landingHref } from './landing';

describe('landingHref', () => {
  it('sends a signed-out user to sign in', () => {
    expect(landingHref({ signedIn: false, hasCoach: false })).toBe('/sign-in');
    expect(landingHref({ signedIn: false, hasCoach: true })).toBe('/sign-in');
  });

  it('sends a client without a coach to the "Ask your coach" screen', () => {
    expect(landingHref({ signedIn: true, hasCoach: false })).toBe('/home');
  });

  it('sends a client with a coach to Today, never another tab', () => {
    // Joining a coach ("Check again") swaps the screens; landing must name Today, not leave the tab to the router.
    expect(landingHref({ signedIn: true, hasCoach: true })).toBe('/today');
  });
});
