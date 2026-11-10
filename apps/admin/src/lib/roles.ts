import type { Database } from '@caltracker/shared';

export type AdminRole = Database['public']['Enums']['admin_role'];

const RANK: Record<AdminRole, number> = { readonly: 0, support: 1, owner: 2 };

/** owner > support > readonly (the same order private.admin_require uses). */
export function roleAtLeast(role: AdminRole, min: AdminRole): boolean {
  return RANK[role] >= RANK[min];
}

/** The STAGING tag shows unless NEXT_PUBLIC_APP_ENV is exactly "production". */
export function isProductionEnv(value: string | undefined): boolean {
  return value === 'production';
}
