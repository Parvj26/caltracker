// When the phone may tell the server "I have read the conversation". Pure, so the rule is tested.
export type ReadState = {
  /** The Coach tab is the screen being looked at. */
  viewing: boolean;
  /** The app is in the foreground (not locked, not another app). */
  appActive: boolean;
  conversationId: string | null;
  /** Time of the coach's newest message, or null when there is none. */
  latestFromCoach: string | null;
  myReadAt: string | null;
};

/** True only while the Coach tab is on screen AND the app is active, and there is something newer than my read mark. */
export function shouldMarkRead(s: ReadState): boolean {
  if (!s.viewing || !s.appActive || s.conversationId === null || s.latestFromCoach === null) return false;
  return s.myReadAt === null || Date.parse(s.myReadAt) < Date.parse(s.latestFromCoach);
}
