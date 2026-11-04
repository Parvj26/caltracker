import { INVITE_CHUNK_SIZE, type InviteInput, type SendInvitesResponse } from '@caltracker/shared';

export type InviteRowResult = SendInvitesResponse['results'][number];

const CHUNK_FAILED = "We couldn't send this email. Use Resend to try again.";

/**
 * Sends invites to the Edge Function a chunk at a time, one chunk after another, and merges the per-row results.
 * A chunk that fails outright marks only its own rows as `error`; later chunks still go out.
 * (Keeps each call well inside the Edge Function time limit, and a retry only touches what failed.)
 */
export async function sendInChunks(
  invites: InviteInput[],
  sendChunk: (chunk: InviteInput[]) => Promise<InviteRowResult[] | null>,
  chunkSize: number = INVITE_CHUNK_SIZE,
): Promise<InviteRowResult[]> {
  const results: InviteRowResult[] = [];
  for (let i = 0; i < invites.length; i += chunkSize) {
    const chunk = invites.slice(i, i + chunkSize);
    let chunkResults: InviteRowResult[] | null;
    try {
      chunkResults = await sendChunk(chunk);
    } catch {
      chunkResults = null;
    }
    results.push(
      ...(chunkResults ?? chunk.map((c): InviteRowResult => ({ email: c.email, status: 'error', message: CHUNK_FAILED }))),
    );
  }
  return results;
}
