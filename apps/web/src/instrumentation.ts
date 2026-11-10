import type { Instrumentation } from 'next';

/**
 * Next calls this for errors thrown while handling a request. Only thrown server action errors are reported
 * (as `server_error`, with the route pattern as `where`): no message, stack or request content leaves.
 * Loaded lazily so pages that never error pay nothing; reporting never throws.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (context.routeType !== 'action') return;
  const { reportRequestError } = await import('./lib/analytics/server');
  await reportRequestError(error, request, context);
};
