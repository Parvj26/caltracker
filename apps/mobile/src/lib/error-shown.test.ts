import { beforeEach, describe, expect, it, vi } from 'vitest';

const { track, error } = vi.hoisted(() => ({ track: vi.fn(), error: vi.fn() }));
vi.mock('./analytics/client', () => ({ track, currentScreen: () => '/sign-in', getTaskTracker: () => ({ error }) }));

import { errorTextContent, reportErrorShown } from './error-shown';

beforeEach(() => {
  track.mockClear();
  error.mockClear();
});

describe('phone ErrorText reporting', () => {
  it('sends error_shown with its code, never "alert"', () => {
    reportErrorShown('sign_in_failed');
    expect(track).toHaveBeenCalledWith('error_shown', { code: 'sign_in_failed', screen: '/sign-in' });
    expect(error).toHaveBeenCalledTimes(1);
  });
  it('shows the catalogue message when no text is given', () => {
    expect(errorTextContent('sign_in_failed')).toBe('Wrong email or password.');
  });
  it('shows fixed copy when given', () => {
    expect(errorTextContent('field_required', 'Enter your first name.')).toBe('Enter your first name.');
  });
});
