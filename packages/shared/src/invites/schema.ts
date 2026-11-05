import { z } from 'zod';
import { NAME_MAX_LENGTH } from '../names';

/** Required: 1 to 100 characters after trimming. */
export const FirstName = z.string().trim().min(1).max(NAME_MAX_LENGTH);
/** Optional (some people use one name): up to 100 characters after trimming. */
export const LastName = z.string().trim().max(NAME_MAX_LENGTH);

export const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: FirstName,
  lastName: LastName.default(''),
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
