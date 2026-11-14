/** How far the coach has looked at a finished workout, as the Activity feed shows it. */
export interface LogReview {
  /** Every comment on the log, from anyone. */
  comments: number;
  /**
   * True once someone other than the client (the coach) has commented. Nothing records the coach opening a log, so
   * "reviewed" means "the coach has commented". A comment whose author's account is gone doesn't count.
   */
  reviewed: boolean;
}

/** The review state of each log, from its comments' authors. Comments on logs not in `logs` are ignored. */
export function logReviewByLog(
  logs: readonly { id: string; clientId: string }[],
  comments: readonly { logId: string; authorId: string | null }[],
): Map<string, LogReview> {
  const clientOf = new Map(logs.map((l) => [l.id, l.clientId]));
  const out = new Map<string, LogReview>(logs.map((l) => [l.id, { comments: 0, reviewed: false }]));
  for (const c of comments) {
    const state = out.get(c.logId);
    if (!state) continue;
    state.comments += 1;
    if (c.authorId !== null && c.authorId !== clientOf.get(c.logId)) state.reviewed = true;
  }
  return out;
}
