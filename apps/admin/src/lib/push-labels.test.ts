import { describe, expect, it } from 'vitest';
import { pushErrorText, pushOutcome, pushTimelineEvent, pushType } from './push-labels';

describe('pushOutcome', () => {
  it('maps every outcome the database can store', () => {
    expect(['sent', 'disabled', 'no_device', 'expired', 'failed'].map((o) => pushOutcome(o).label)).toEqual([
      'Sent',
      'Turned off',
      'No phone',
      'Expired',
      'Failed',
    ]);
  });
  it('shows Waiting for an unsent push', () => {
    expect(pushOutcome(null).label).toBe('Waiting');
  });
});

describe('pushType', () => {
  it('uses plain words, and falls back to the raw type', () => {
    expect(pushType('daily_reminder')).toBe('Daily reminder');
    expect(pushType('something_new')).toBe('something_new');
  });
});

describe('pushTimelineEvent', () => {
  const base = { at: '2026-11-20T10:00:00Z', sent_at: '2026-11-20T10:01:00Z', type: 'message' };
  it('says Delivered only for sent', () => {
    expect(pushTimelineEvent({ ...base, outcome: 'sent' })).toMatchObject({ label: 'Notification sent · New message', status: 'delivered' });
    for (const outcome of ['no_device', 'disabled', 'expired', 'failed', null]) {
      expect(pushTimelineEvent({ ...base, outcome }).status).not.toBe('delivered');
      expect(pushTimelineEvent({ ...base, outcome }).label).not.toMatch(/^Notification sent/);
    }
  });
  it('names the real outcome', () => {
    expect(pushTimelineEvent({ ...base, outcome: 'no_device' }).label).toBe('Notification not sent: no phone · New message');
    expect(pushTimelineEvent({ ...base, outcome: 'disabled' }).label).toBe('Notification not sent: turned off · New message');
    expect(pushTimelineEvent({ ...base, outcome: 'expired' }).label).toBe('Notification not sent: expired · New message');
    expect(pushTimelineEvent({ ...base, sent_at: null, outcome: null })).toMatchObject({ at: base.at, label: 'Notification waiting · New message' });
  });
});

describe('pushErrorText', () => {
  it('explains each delivery problem', () => {
    expect(pushErrorText({ outcome: 'no_device', error: null })).toBe('No phone registered');
    expect(pushErrorText({ outcome: 'expired', error: null })).toMatch(/^Expired/);
    expect(pushErrorText({ outcome: 'failed', error: 'BadDeviceToken' })).toBe('Failed: BadDeviceToken');
  });
});
