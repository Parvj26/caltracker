// The finish sheet's "How did it feel?" and note for the coach. The log has no field of its own for the feeling,
// so it is kept as the first line of the workout note ("Felt: Good"), which the coach already sees.

export const FEELINGS = ['Easy', 'OK', 'Good', 'Hard', 'Max'] as const;
export type Feeling = (typeof FEELINGS)[number];

/** The log schema's limit on the workout note. */
export const LOG_NOTES_MAX = 2000;

const PREFIX = 'Felt: ';

/** "Felt: Good\n<note>", the note alone, or null when there is nothing to keep. Cut to the notes limit. */
export function composeFinishNotes(feel: Feeling | null, note: string): string | null {
  const body = note.trim();
  const parts = [feel ? `${PREFIX}${feel}` : null, body || null].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return parts.join('\n').slice(0, LOG_NOTES_MAX);
}

/** The feeling and note back out of a workout note written by composeFinishNotes (any other note is all note). */
export function readFinishNotes(notes: string | null): { feel: Feeling | null; note: string } {
  if (!notes) return { feel: null, note: '' };
  const [first = '', ...rest] = notes.split('\n');
  const feel = FEELINGS.find((f) => first === `${PREFIX}${f}`) ?? null;
  return feel ? { feel, note: rest.join('\n') } : { feel: null, note: notes };
}
