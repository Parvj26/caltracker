import { z } from 'zod';

export const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(1).max(100),
});
export type InviteInput = z.infer<typeof InviteInput>;

/** Invites per send-invite call. The dashboard chunks a bigger batch (CSV upload: 200 rows in total). */
export const INVITE_CHUNK_SIZE = 20;

export const SendInvitesRequest = z.object({
  workspaceId: z.string().uuid(),
  invites: z.array(InviteInput).min(1).max(50),
});
export type SendInvitesRequest = z.infer<typeof SendInvitesRequest>;

export const INVITE_RESULT_STATUSES = [
  'sent',
  'resent',
  'already_member',
  'with_another_coach',
  'is_coach',
  'error',
] as const;
export type InviteResultStatus = (typeof INVITE_RESULT_STATUSES)[number];

export const SendInvitesResponse = z.object({
  results: z.array(
    z.object({
      email: z.string(),
      status: z.enum(INVITE_RESULT_STATUSES),
      message: z.string().optional(),
    }),
  ),
});
export type SendInvitesResponse = z.infer<typeof SendInvitesResponse>;
