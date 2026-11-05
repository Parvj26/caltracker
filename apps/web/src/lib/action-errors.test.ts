import { describe, expect, it } from 'vitest';
import { STALE_DEPLOY_MESSAGE, isStaleDeployError } from './action-errors';

// What Next 16.4 actually throws in the browser when a page loaded before a deploy calls a server action the new
// deploy doesn't have (next/dist/client/components/router-reducer/reducers/server-action-reducer.js).
class UnrecognizedActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnrecognizedActionError';
  }
}

describe('isStaleDeployError', () => {
  it("spots Next's UnrecognizedActionError (the x-nextjs-action-not-found response)", () => {
    const id = '7f3a9c0e1b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a12';
    const e = new UnrecognizedActionError(
      `Server Action "${id}" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action`,
    );
    expect(isStaleDeployError(e)).toBe(true);
  });

  it('spots the plain-text 409 body when a proxy drops the not-found header', () => {
    expect(isStaleDeployError(new Error('Server Action unavailable.'))).toBe(true);
  });

  it('spots the older "Failed to find Server Action" wording', () => {
    expect(isStaleDeployError(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.'))).toBe(true);
  });

  it('ignores other failures', () => {
    expect(isStaleDeployError(new Error('An unexpected response was received from the server.'))).toBe(false);
    expect(isStaleDeployError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleDeployError(new Error("You can't add workouts for this client."))).toBe(false);
    expect(isStaleDeployError('Server Action unavailable.')).toBe(false);
    expect(isStaleDeployError(null)).toBe(false);
  });

  it('has the copy the product owner asked for', () => {
    expect(STALE_DEPLOY_MESSAGE).toBe('CalTracker was just updated. Reload the page to continue.');
  });
});
