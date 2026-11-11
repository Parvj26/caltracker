import { afterEach, describe, expect, it, vi } from 'vitest';

const reportRequestError = vi.fn(() => Promise.resolve());
vi.mock('./lib/analytics/server', () => ({ reportRequestError }));

const { onRequestError } = await import('./instrumentation');

type Args = Parameters<typeof onRequestError>;
const request = { path: '/clients?q=luis', method: 'POST', headers: {} } as Args[1];
const context = (routeType: Args[2]['routeType']) =>
  ({ routerKind: 'App Router', routePath: '/(coach)/clients/page', routeType, renderSource: undefined, revalidateReason: undefined }) as unknown as Args[2];

afterEach(() => reportRequestError.mockClear());

describe('onRequestError', () => {
  it('forwards thrown server action errors', async () => {
    const err = new Error('x');
    await onRequestError(err, request, context('action'));
    expect(reportRequestError).toHaveBeenCalledExactlyOnceWith(err, request, context('action'));
  });

  it('ignores render, route and proxy errors', async () => {
    for (const type of ['render', 'route', 'proxy', 'middleware'] as const) {
      await onRequestError(new Error('x'), request, context(type as Args[2]['routeType']));
    }
    expect(reportRequestError).not.toHaveBeenCalled();
  });
});
