import { z } from 'zod';
import { FirstName, LastName } from '../invites/schema';

/** Workspace names: 1 to 80 characters after trimming (the database checks the same). */
export const WORKSPACE_NAME_MAX_LENGTH = 80;
export const WorkspaceName = z.string().trim().min(1).max(WORKSPACE_NAME_MAX_LENGTH);

/**
 * Body of the admin-coach Edge Function (owner admins only, two-step sign-in).
 *   create: a new coach account (invite email), their workspace and owner membership.
 *   delete: the workspace and everything in it; confirmName must be the workspace name exactly.
 */
export const AdminCoachRequest = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    email: z.string().trim().toLowerCase().email(),
    firstName: FirstName,
    lastName: LastName.default(''),
    workspaceName: WorkspaceName,
  }),
  z.object({
    action: z.literal('delete'),
    workspaceId: z.string().uuid(),
    // Not trimmed: the typed name must match exactly.
    confirmName: z.string().min(1).max(200),
  }),
]);
export type AdminCoachRequest = z.input<typeof AdminCoachRequest>;

export const AdminCoachResponse = z.union([
  z.object({ created: z.literal(true), userId: z.string(), workspaceId: z.string() }),
  z.object({
    deleted: z.literal(true),
    workspaceName: z.string(),
    clientsEmailed: z.number(),
    emailsFailed: z.number(),
    accountsNotDeleted: z.number(),
  }),
  // Refused or failed: `message` is a sentence to show the admin.
  z.object({ error: z.string(), message: z.string().optional() }),
]);
export type AdminCoachResponse = z.infer<typeof AdminCoachResponse>;

/** "Type <name> to confirm": only an exact match (case and spaces too) enables Delete. */
export function deleteConfirmMatches(typed: string, workspaceName: string): boolean {
  return typed.length > 0 && typed === workspaceName;
}
