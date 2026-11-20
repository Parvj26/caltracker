// What the Settings screen shows about the account (approved Settings board, 2026-11-19). Pure, so it is unit tested.

/** "MT" from "Maya Thompson-Richardson"; the email's first letter when there is no name. */
export function accountInitials(name: string | null, email: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) return words.length === 1 ? words[0].slice(0, 1).toUpperCase() : `${words[0][0]}${words.at(-1)![0]}`.toUpperCase();
  return (email ?? '?').slice(0, 1).toUpperCase();
}

/** "maya@example.com · coached by Luis" (each part only when known). */
export function accountLine(email: string | null, coachFirstName: string | null): string {
  return [email, coachFirstName ? `coached by ${coachFirstName}` : null].filter(Boolean).join(' · ');
}

/** The question Sign out asks first. */
export const SIGN_OUT_QUESTION = 'Sign out of CalTracker?';
