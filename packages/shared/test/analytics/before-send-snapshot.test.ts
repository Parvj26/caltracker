import { describe, expect, it } from 'vitest';
import { beforeSend } from '../../src/analytics/before-send';

// Session recordings ($snapshot) are already masked in the browser by rrweb; the event guard must not mangle them.
describe('beforeSend and recordings', () => {
  it('passes $snapshot events through unchanged', () => {
    const snapshot = {
      $snapshot_data: [{ type: 2, data: { node: { type: 0, childNodes: [] }, initialOffset: { top: 0, left: 0 } }, timestamp: 1 }],
      $session_id: 's',
      $window_id: 'w',
      $snapshot_bytes: 123,
    };
    const input = { event: '$snapshot', properties: structuredClone(snapshot) };
    const out = beforeSend(input);
    expect(out?.event).toBe('$snapshot');
    expect(out?.properties).toEqual(snapshot);
  });

  it('still drops browser $exception events', () => {
    expect(beforeSend({ event: '$exception', properties: { $exception_list: [{ value: 'luis@example.com' }] } })).toBeNull();
  });
});
