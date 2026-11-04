import { INVITE_CHUNK_SIZE, type InviteInput, type SendInvitesResponse } from '@caltracker/shared';

export type InviteRowResult = SendInvitesResponse['results'][number];

/**
 * The whole call failed (network error, 500, bad answer), so we don't know which rows the function reached:
 * some may have been emailed. Retrying is safe: the function treats a re-send within 2 minutes of the last
 * send as a no-op, and a failed email is backdated so it can be re-sent at once.
 */
const CHUNK_FAILED = 'Not confirmed — this invite may have gone out. Check Pending invites, or use Retry failed rows.';

/**
 * Sends invites to the Edge Function a chunk at a time, one chunk after another, and merges the per-row results.
 * A chunk that fails outright marks only its own rows as `error` (outcome unknown); later chunks still go out.
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
