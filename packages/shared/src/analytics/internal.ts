/** Extra internal (test/family) accounts to hide from reports. PO to add VK's email. */
export const INTERNAL_EMAILS: readonly string[] = [];

const PO_PATTERN = /^parvjain2503(\+[^@]*)?@gmail\.com$/i;

/** True for the PO's own and test accounts, which reports filter out. */
export function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  return PO_PATTERN.test(lower) || INTERNAL_EMAILS.includes(lower);
}
