// Pure rules for push notifications on the phone (unit tested): the app-icon badge and where a tapped push opens.
import { isPushRoute } from '@caltracker/shared';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The app-icon badge: unread coach messages plus unread comment notifications (the server's badge counts the same). */
export function badgeTotal(unreadMessages: number, unreadCommentNotifications: number): number {
  return Math.max(0, unreadMessages) + Math.max(0, unreadCommentNotifications);
}

/** Unread community notifications of kind comment (reactions don't count towards the badge). */
export function unreadCommentCount(rows: ReadonlyArray<{ kind: string; readAt: string | null }>): number {
  return rows.filter((r) => r.kind === 'comment' && r.readAt === null).length;
}

/**
 * The data of a tapped notification. A local notification keeps its data in content.data; for an APNs push the
 * payload's custom keys (route, type) may be in content.data, under content.data.body, or only in the trigger's
 * payload, depending on the platform version. The first object with a route wins; else content.data as it is.
 */
export function pushDataOf(contentData: unknown, triggerPayload: unknown): Obj | null {
  const candidates = [contentData, isObj(contentData) ? contentData.body : undefined, triggerPayload];
  const withRoute = candidates.find((c): c is Obj => isObj(c) && typeof c.route === 'string');
  if (withRoute) return withRoute;
  return isObj(contentData) && Object.keys(contentData).length > 0 ? contentData : null;
}

const LOG_SUMMARY = /^\/log\/([0-9a-f-]{36})\/summary$/i;

/**
 * Where a tapped push opens, or null to ignore it (not one of ours, or the local still-training reminder, which
 * log-notifications handles). "Coach logged your session" opens the sticker reveal the first time on this phone.
 */
export function tapTarget(data: unknown, revealed: ReadonlySet<string>): string | null {
  if (!isObj(data) || data.kind === 'reminder' || !isPushRoute(data.route)) return null;
  const route = data.route;
  if (data.type === 'coach_logged') {
    const logId = LOG_SUMMARY.exec(route)?.[1];
    if (logId && !revealed.has(logId)) return `/log/${logId}/reveal?coach=1`;
  }
  return route;
}

/** "Later" on the Today card hides it this long. */
export const PUSH_CARD_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** Where this phone keeps when the Today card may show again, per user. */
export const pushCardSnoozeKey = (userId: string) => `caltracker.pushCardSnoozedUntil.${userId}`;

/**
 * The Today card asking for notifications: only while iOS has never asked (after that only iPhone Settings can turn
 * them on, which Settings -> Notifications explains), not while snoozed with "Later", and not on the first-time
 * welcome (one thing at a time).
 */
export function showPushCard(s: {
  permission: 'granted' | 'denied' | 'undetermined' | null;
  snoozedUntil: number | null;
  now: number;
  firstTime: boolean;
}): boolean {
  if (s.permission !== 'undetermined' || s.firstTime) return false;
  return s.snoozedUntil === null || s.now >= s.snoozedUntil;
}

/** The Today card's line, naming the coach by first name ("your coach" when unknown). */
export function pushCardText(coachName: string | null): string {
  const first = coachName?.trim().split(/\s+/)[0] || 'your coach';
  return `Get a ping when ${first} assigns a workout or sends you a message.`;
}
