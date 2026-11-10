import { describe, expect, it } from 'vitest';
import { ATTENTION_KINDS, attentionCopy } from '../../src/admin/attention-copy';

describe('attentionCopy', () => {
  it('covers all 6 kinds', () => {
    expect(ATTENTION_KINDS).toEqual([
      'invite_expired',
      'no_signin_7d',
      'notifications_off',
      'push_failed',
      'coach_inactive_14d',
      'coach_no_meals',
    ]);
    for (const kind of ATTENTION_KINDS) {
      const copy = attentionCopy(kind);
      expect(copy.problem.length, kind).toBeGreaterThan(0);
      expect(copy.actionLabel.length, kind).toBeGreaterThan(0);
    }
  });

  it('uses the mockup copy', () => {
    expect(attentionCopy('invite_expired')).toEqual({ problem: 'Invite expired', actionLabel: 'Resend invite' });
    expect(attentionCopy('notifications_off')).toEqual({ problem: 'Notifications off', actionLabel: 'Open' });
    expect(attentionCopy('coach_no_meals')).toEqual({ problem: 'No meals shared', actionLabel: 'Open' });
    expect(attentionCopy('no_signin_7d').actionLabel).toBe('Open');
    expect(attentionCopy('push_failed').actionLabel).toBe('Open');
    expect(attentionCopy('coach_inactive_14d').actionLabel).toBe('Open');
  });
});
