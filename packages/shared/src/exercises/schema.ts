import { z } from 'zod';
import { TRACKING_TYPES } from './tracking';
import { canonicalYoutubeUrl, parseYoutubeUrl } from './youtube';

export const YOUTUBE_URL_ERROR = 'Paste a YouTube link (youtube.com or youtu.be).';

/** Empty or missing becomes null; anything else must be a YouTube link and is stored in canonical form. */
export const OptionalYoutubeUrl = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx): string | null => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = parseYoutubeUrl(value);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: YOUTUBE_URL_ERROR });
      return z.NEVER;
    }
    return canonicalYoutubeUrl(parsed.videoId);
  });

const textList = z.array(z.string().trim().min(1).max(500)).max(100).default([]);

export const CustomExerciseInput = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Keep the name under 100 characters.'),
  trackingType: z.enum(TRACKING_TYPES as [string, ...string[]]) as z.ZodType<
    (typeof TRACKING_TYPES)[number]
  >,
  primaryMuscles: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  equipment: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((v) => (v ? v : null)),
  instructions: textList,
  youtubeUrl: OptionalYoutubeUrl,
});
export type CustomExerciseInput = z.output<typeof CustomExerciseInput>;

export const ExerciseOverrideInput = z.object({
  exerciseId: z.string().uuid(),
  youtubeUrl: OptionalYoutubeUrl,
  coachNotes: z
    .string()
    .trim()
    .max(2000, 'Keep notes under 2000 characters.')
    .nullish()
    .transform((v) => (v ? v : null)),
});
