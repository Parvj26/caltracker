import { describe, expect, it } from 'vitest';
import { beforeSend } from '../../src/analytics/before-send';

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

describe('beforeSend (phone)', () => {
  it('hides invite tokens in screen names', () => {
    const out = beforeSend({ event: '$screen', properties: { $screen_name: 'invite/abc123' } });
    expect(out?.properties.$screen_name).toBe('invite/[token]');
  });
  it('keeps only ph-label from touched elements', () => {
    const out = beforeSend({
      event: '$autocapture',
      properties: { $event_type: 'touch', $elements: [{ tag_name: 'Text', $el_text: 'Maya', attr__children: '185', 'attr__ph-label': 'log_set', attr__accessibilityLabel: 'Bench 185' }] },
    });
    expect(out?.properties.$elements).toEqual([{ tag_name: 'Text', 'attr__ph-label': 'log_set' }]);
  });
});

describe('beforeSend (nested values)', () => {
  it('scrubs URLs inside $set and $set_once', () => {
    const out = beforeSend({
      event: '$identify',
      properties: {},
      $set: { name: 'Luis', $current_url: '/invite/abc?code=1' },
      $set_once: { $initial_current_url: 'https://x.app/invite/abc?code=1', $initial_pathname: '/set-password?code=2', $initial_referrer: 'https://x.app/a?t=1' },
    });
    expect(out?.$set).toEqual({ name: 'Luis', $current_url: '/invite/[token]' });
    expect(out?.$set_once).toEqual({ $initial_current_url: 'https://x.app/invite/[token]', $initial_pathname: '/set-password', $initial_referrer: 'https://x.app/a' });
  });
  it('scrubs heatmap URLs', () => {
    const out = beforeSend({ event: '$$heatmap', properties: { $heatmap_data: { 'https://x.app/invite/abc?code=1#h': [{ x: 1 }] } } });
    expect(out?.properties.$heatmap_data).toEqual({ 'https://x.app/invite/[token]': [{ x: 1 }] });
  });
  it('drops exception and web-vitals events', () => {
    expect(beforeSend({ event: '$exception', properties: {} })).toBeNull();
    expect(beforeSend({ event: '$web_vitals', properties: {} })).toBeNull();
  });
  it('keeps the click label on autocaptured clicks only', () => {
    expect(beforeSend({ event: '$autocapture', properties: { label: 'nav_clients' } })?.properties).toEqual({ label: 'nav_clients' });
    expect(beforeSend({ event: '$rageclick', properties: { label: 'save' } })?.properties).toEqual({ label: 'save' });
    expect(beforeSend({ event: '$pageview', properties: { label: 'x' } })?.properties).toEqual({});
  });
});

describe('beforeSend (phone labels)', () => {
  it('keeps testID labels with ids removed', () => {
    const out = beforeSend({
      event: '$autocapture',
      properties: { $elements: [{ tag_name: 'Pressable', attr__testID: 'done-5f0c2c1e-1111-4222-8333-444455556666', attr__children: 'Maya' }, { tag_name: 'View', attr__testID: 'dot-3' }] },
    });
    expect(out?.properties.$elements).toEqual([
      { tag_name: 'Pressable', attr__testID: 'done-[id]' },
      { tag_name: 'View', attr__testID: 'dot-[n]' },
    ]);
  });
});

