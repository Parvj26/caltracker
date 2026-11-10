/**
 * Every error the apps may show, each with the fixed message the user sees. The code travels with
 * `error_shown` (and server `$exception` events), so the PO reads which error appeared.
 * Adding a code = one line here. Server failures end in `_failed`.
 */
const SERVER_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export const ERROR_CODES = {
  invite_email_invalid: 'Check the name and email, then try again.',
  invite_already_client: 'This person is already one of your clients.',
  invite_send_failed: "Couldn't send the invite. Please try again.",
  csv_bad_format: "Some rows couldn't be read. Fix them and upload again.",
  assign_none_selected: 'Pick at least one client.',
  assign_date_invalid: 'Pick a valid start date.',
  assign_save_failed: "Couldn't assign this. Please try again.",
  program_name_required: 'Give the program a name.',
  program_save_failed: "Couldn't save the program. Please try again.",
  workout_save_failed: "Couldn't save the workout. Please try again.",
  exercise_not_found: 'That exercise is no longer in your library.',
  upload_too_large: 'That file is too large.',
  upload_failed: "Couldn't upload the file. Please try again.",
  sign_in_failed: 'Wrong email or password.',
  otp_expired: 'This link has expired. Ask for a new one.',
  session_expired: 'You were signed out. Please sign in again.',
  permission_denied: "You don't have access to this.",
  network_offline: "You're offline. Check your connection and try again.",
  server_error: SERVER_ERROR_MESSAGE,
  field_required: 'Fill in this field.',
  field_format: 'Check this field and try again.',
  save_failed: "Couldn't save. Please try again.",
  missing_code: SERVER_ERROR_MESSAGE,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, v);
}

export function errorMessage(code: ErrorCode): string {
  return ERROR_CODES[code];
}

/** Button label rule: `<area>_<action>[_<thing>]`, never an id, name or typed value. */
export const LABEL_PATTERN = /^[a-z]+(_[a-z0-9]+)+$/;
