import { z } from 'zod';

// Limits and input checks for the community. The database enforces the same limits (20261106013000_community.sql);
// these give the apps friendly messages before a round trip.

export const POST_BODY_MAX = 2000;
export const COMMENT_BODY_MAX = 1000;
export const REPORT_NOTE_MAX = 500;
export const MAX_POST_PHOTOS = 4;

export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam or selling',
  harassment: 'Bullying or harassment',
  inappropriate: 'Inappropriate content',
  other: 'Something else',
};

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** A personal best on a PR card, in kg (formatted for each reader's units). */
export const CardPr = z.object({
  exerciseName: z.string().min(1).max(120),
  prKind: z.enum(['heaviest', 'reps_at_weight', 'e1rm']),
  valueKg: z.number().positive(),
  reps: z.number().int().positive().nullable(),
});
export type CardPr = z.infer<typeof CardPr>;

/**
 * What the app asks to share: only which sticker or which workout. The database (create_community_post) builds the
 * card that is stored and shown from its own records (the zoo book, the workout log and its stored award) and refuses
 * any other key, so nothing on a card can be made up by the phone.
 */
export const CardRequest = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sticker'), stickerKey: z.string().min(1).max(100) }),
  z.strictObject({ kind: z.literal('workout'), logId: uuid }),
  z.strictObject({ kind: z.literal('pr'), logId: uuid }),
]);
export type CardRequest = z.infer<typeof CardRequest>;

/** A stored card, as the database built it. Workout cards show counts, not volume (that sum lives only here). */
export const CommunityCard = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sticker'), stickerKey: z.string().min(1), shiny: z.boolean(), count: z.number().int().positive() }),
  z.object({
    kind: z.literal('workout'),
    logId: uuid,
    workoutName: z.string(),
    finishedAt: z.string().nullable(),
    exerciseCount: z.number().int().nonnegative(),
    setCount: z.number().int().nonnegative(),
    stickerKey: z.string().nullable(),
    multiple: z.number().positive().nullable(),
    shiny: z.boolean(),
  }),
  z.object({
    kind: z.literal('pr'),
    logId: uuid,
    workoutName: z.string(),
    finishedAt: z.string().nullable(),
    prs: z.array(CardPr).min(1).max(5),
  }),
]);
export type CommunityCard = z.infer<typeof CommunityCard>;

/** Reads a stored card; null for anything that isn't a card this version understands. */
export function parseCard(value: unknown): CommunityCard | null {
  if (value === null || value === undefined) return null;
  const parsed = CommunityCard.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Reads a share request (the composer's route parameter); null when it isn't one. */
export function parseCardRequest(value: unknown): CardRequest | null {
  const parsed = CardRequest.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const PostInput = z
  .object({
    body: z.string().max(POST_BODY_MAX, `Posts can be up to ${POST_BODY_MAX} characters.`),
    photoCount: z.number().int().min(0).max(MAX_POST_PHOTOS, `Up to ${MAX_POST_PHOTOS} photos per post.`),
    card: CardRequest.nullable(),
  })
  .refine((p) => p.body.trim().length > 0 || p.photoCount > 0 || p.card !== null, {
    message: 'Write something or add a photo.',
    path: ['body'],
  });
export type PostInput = z.infer<typeof PostInput>;

export const CommentInput = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, 'Write a comment first.')
      .max(COMMENT_BODY_MAX, `Comments can be up to ${COMMENT_BODY_MAX} characters.`),
  );

export const ReportInput = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(REPORT_NOTE_MAX, `Keep it under ${REPORT_NOTE_MAX} characters.`),
});
export type ReportInput = z.infer<typeof ReportInput>;
