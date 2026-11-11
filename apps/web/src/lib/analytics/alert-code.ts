import { isErrorCode, type ErrorCode } from '@caltracker/shared';

/** The code an on-screen alert reports: its `data-error-code` when known, else `missing_code` so we notice. */
export function alertCode(attr: string | null | undefined): ErrorCode {
  return isErrorCode(attr) ? attr : 'missing_code';
}
