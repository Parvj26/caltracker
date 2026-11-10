import { isErrorCode } from './error-codes';
import { ALLOWED_KEYS, type AnalyticsProps } from './events';

const ALLOWED = new Set<string>(ALLOWED_KEYS);
const QUERY_MAX = 60;

/**
 * The privacy guard: keeps only allow-listed keys with primitive values. `query` is allowed only on
 * exercise searches (exercise names are not personal) and is capped at 60 characters. `code` must be
 * in the error-code list; anything else becomes `missing_code` so we notice.
 */
export function sanitize(event: string, props: Record<string, unknown> | undefined): AnalyticsProps {
  const out: AnalyticsProps = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (!ALLOWED.has(key)) continue;
    if (key === 'query' && event !== 'exercise_search_no_results') continue;
    if (key === 'code') {
      out.code = isErrorCode(value) ? value : 'missing_code';
      continue;
    }
    if (typeof value === 'string') out[key] = key === 'query' ? value.slice(0, QUERY_MAX) : value;
    else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') out[key] = value;
  }
  return out;
}
