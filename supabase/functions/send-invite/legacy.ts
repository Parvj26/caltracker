import { splitFullName } from '@caltracker/shared';

/**
 * TEMPORARY (remove one release after first/last names shipped): during a deploy the database and this function
 * change a minute or so before the web app does, so the old dashboard can still send `{ email, fullName }`.
 * Turns each such invite into `{ email, firstName, lastName }` using the same split as the database migration.
 * When firstName or lastName is present they win and fullName is dropped. Anything else is returned unchanged
 * for the request schema to judge.
 */
export function upgradeLegacyInvites(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.invites)) return raw;
  return {
    ...raw,
    invites: raw.invites.map((invite: unknown) => {
      if (!isRecord(invite) || typeof invite.fullName !== 'string') return invite;
      const { fullName, ...rest } = invite;
      if ('firstName' in rest || 'lastName' in rest) return rest;
      return { ...rest, ...splitFullName(fullName) };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
