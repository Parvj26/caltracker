import { describe, expect, it } from 'vitest';
import { beforeSend } from './before-send';

describe('beforeSend (web)', () => {
  it('scrubs secrets out of URLs', () => {
    const out = beforeSend({
      event: '$pageview',
      properties: {
        $current_url: 'https://staging.caltracker.app/invite/abc?x=1',
        $pathname: '/set-password',
        $referrer: 'https://staging.caltracker.app/auth/confirm?token_hash=t#access_token=a',
        $initial_current_url: 'https://staging.caltracker.app/invite/zzz',
      },
    });
    expect(out?.properties).toMatchObject({
      $current_url: 'https://staging.caltracker.app/invite/[token]',
      $pathname: '/set-password',
      $referrer: 'https://staging.caltracker.app/auth/confirm',
      $initial_current_url: 'https://staging.caltracker.app/invite/[token]',
    });
  });

  it('strips text and attributes from autocaptured clicks except ph-label', () => {
    const out = beforeSend({
      event: '$autocapture',
      properties: {
        $el_text: 'Maya Patel',
        $elements: [{ tag_name: 'button', $el_text: '185 lb', attr__title: 'Maya', 'attr__ph-label': 'invite_client', attr__class: 'x' }],
      },
    });
    expect(out?.properties.$el_text).toBeUndefined();
    expect(out?.properties.$elements).toEqual([{ tag_name: 'button', 'attr__ph-label': 'invite_client' }]);
  });

  it('drops page titles, which can contain client names', () => {
    const out = beforeSend({ event: '$pageview', properties: { title: 'Maya Patel · Clients', $title: 'x', $prev_pageview_pathname: '/invite/abc' } });
    expect(out?.properties).toEqual({ $prev_pageview_pathname: '/invite/[token]' });
  });

  it('strips text and attributes from the elements chain except ph-label', () => {
    const out = beforeSend({
      event: '$autocapture',
      properties: { $elements_chain: 'button.btn:attr__ph-label="start"attr__title="Maya"href="/invite/abc"nth-child="1"text="185 lb";div:text="x"' },
    });
    expect(out?.properties.$elements_chain).toBe('button.btn:attr__ph-label="start"nth-child="1";div:');
  });

  it('sanitizes custom event properties but keeps PostHog $ properties', () => {
    const out = beforeSend({ event: 'task_completed', properties: { task: 'build_program', note: 'secret', $lib: 'web' } });
    expect(out?.properties).toEqual({ task: 'build_program', $lib: 'web' });
  });

  it('keeps the routing fields PostHog needs', () => {
    const out = beforeSend({ event: 'task_started', properties: { token: 'phc', distinct_id: 'u1', task: 'log_meal' } });
    expect(out?.properties).toEqual({ token: 'phc', distinct_id: 'u1', task: 'log_meal' });
    const pv = beforeSend({ event: '$pageview', properties: { token: 'phc', distinct_id: 'u1' } });
    expect(pv?.properties).toEqual({ token: 'phc', distinct_id: 'u1' });
  });

  it('sanitizes $set person properties away from custom events', () => {
    const out = beforeSend({ event: 'task_started', properties: { task: 'invite_client' }, $set: { weight: 80 } });
    expect(out?.$set).toBeUndefined();
  });
});
