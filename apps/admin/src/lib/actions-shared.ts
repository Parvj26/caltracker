/** What every admin action returns to its confirm dialog. */
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** The database's own "admin: …" message, made into a sentence ("admin: no account with that email" → "No account with that email."). */
export function adminErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return GENERIC_ERROR;
  if (error.code === '42501') return "You don't have permission to do that.";
  const m = /^admin: (.+)$/.exec(error.message ?? '');
  if (!m) return GENERIC_ERROR;
  const text = m[1]!;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}
