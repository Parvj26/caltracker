/** Longest first name or last name we accept. */
export const NAME_MAX_LENGTH = 100;

export interface PersonName {
  firstName: string;
  lastName: string;
}

/**
 * Splits a single "full name" into first and last name: the first word is the first name and everything after
 * the first space is the last name. Same rule as public.split_full_name() in the database.
 */
export function splitFullName(fullName: string): PersonName {
  const trimmed = fullName.trim();
  const gap = trimmed.search(/\s/);
  if (gap === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, gap), lastName: trimmed.slice(gap).trim() };
}

/** "First Last", with no stray space when either part is empty. Same rule as the generated full_name column. */
export function formatFullName({ firstName, lastName }: PersonName): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * Sort order for people lists: by last name, then first name, ignoring case and accents.
 * Someone with only one name is filed under that name.
 */
export function compareByLastName(a: PersonName, b: PersonName): number {
  const key = (p: PersonName) => p.lastName.trim() || p.firstName.trim();
  return collator.compare(key(a), key(b)) || collator.compare(a.firstName.trim(), b.firstName.trim());
}
