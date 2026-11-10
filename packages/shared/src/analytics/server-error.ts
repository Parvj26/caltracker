/**
 * Builds the PostHog `$exception` event for a server failure (web server action or Edge Function).
 * Privacy: only fixed, pattern-checked fields leave. The error's message, stack, body, details or any
 * other content are never read beyond its constructor name, because they can hold user data.
 */
export type ServerErrorEvent = {
  event: '$exception';
  distinct_id: string;
  properties: {
    $exception_list: [{ type: string; value: string }];
    code: string;
    where: string;
    $session_id?: string;
    $process_person_profile?: false;
  };
};

export type ServerErrorInput = {
  error?: unknown;
  code: string;
  where: string;
  distinctId?: string | null | undefined;
  sessionId?: string | null | undefined;
};

const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const CODE_PATTERN = /^[a-z]+(_[a-z0-9]+)*$/;
const WHERE_PATTERN = /^(action|fn):[A-Za-z0-9_./[\]-]{1,80}$/;
const SESSION_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorType(error: unknown, given: boolean): string {
  if (!given) return 'ActionFailed';
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return 'Error';
    const name: unknown = (error as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === 'string' && TYPE_PATTERN.test(name) ? name : 'Error';
  } catch {
    return 'Error';
  }
}

/** A code the server-error event accepts: snake_case, at most 40 characters. */
export function isValidServerErrorCode(code: unknown): code is string {
  return typeof code === 'string' && code.length <= 40 && CODE_PATTERN.test(code);
}

/** A `where` the server-error event accepts: `action:<route>` or `fn:<function>`. */
export function isValidServerErrorWhere(where: unknown): where is string {
  return typeof where === 'string' && WHERE_PATTERN.test(where);
}

/** True for codes that mean the server failed (`server_error` or `*_failed`), not a validation mistake. */
export function isServerFailureCode(code: string): boolean {
  return code === 'server_error' || /^[a-z0-9_]+_failed$/.test(code);
}

export function buildServerErrorEvent(input: ServerErrorInput): ServerErrorEvent {
  const code = isValidServerErrorCode(input.code) ? input.code : 'server_error';
  const where = isValidServerErrorWhere(input.where) ? input.where : 'unknown';
  const user = typeof input.distinctId === 'string' && UUID_PATTERN.test(input.distinctId) ? input.distinctId : null;
  const properties: ServerErrorEvent['properties'] = {
    $exception_list: [{ type: errorType(input.error, 'error' in input && input.error !== undefined), value: code }],
    code,
    where,
  };
  if (typeof input.sessionId === 'string' && SESSION_PATTERN.test(input.sessionId)) properties.$session_id = input.sessionId;
  if (!user) properties.$process_person_profile = false;
  return { event: '$exception', distinct_id: user ?? 'server', properties };
}
