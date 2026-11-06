import { z } from 'zod';
import { FirstName, LastName } from '../invites/schema';

export const BIO_MAX_LENGTH = 300;
export const BUSINESS_NAME_MAX_LENGTH = 80;

/** Length in characters as the database counts them (char_length): an emoji is 1, not 2. */
export const characterCount = (text: string): number => [...text].length;

/** 0 to 300 characters, plain text. Line breaks are kept (Windows ones become \n); the ends are trimmed. */
export const Bio = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, '\n').trim())
  .refine((s) => characterCount(s) <= BIO_MAX_LENGTH, `Keep your bio to ${BIO_MAX_LENGTH} characters or fewer.`);

/** 1 to 80 characters after trimming. It is stored as the workspace name. */
export const BusinessName = z
  .string()
  .trim()
  .min(1, 'Enter your business name.')
  .refine((s) => characterCount(s) <= BUSINESS_NAME_MAX_LENGTH, `Keep the business name to ${BUSINESS_NAME_MAX_LENGTH} characters or fewer.`);

/** What the coach profile form saves. */
export const ProfileInput = z.object({
  firstName: FirstName,
  lastName: LastName,
  businessName: BusinessName,
  bio: Bio,
  units: z.enum(['lb', 'kg']),
});
export type ProfileInput = z.infer<typeof ProfileInput>;
