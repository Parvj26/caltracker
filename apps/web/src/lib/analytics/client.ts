import posthog from 'posthog-js';
import { TaskTracker, isInternalEmail, isQuickUndo, sanitize, type EventName } from '@caltracker/shared';
import { beforeSend, type OutgoingEvent } from '@caltracker/shared';

/**
 * The only door to PostHog in the web app (ESLint blocks importing posthog-js anywhere else).
 * With no key configured (tests, CI, local) every call is a no-op, and nothing here ever throws.
 */

let ready = false;
let identifiedAs: string | null = null;

export interface AnalyticsPerson {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
}

export function initAnalytics(): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (ready || !key) return;
  try {
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      autocapture: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      capture_pageview: 'history_change',
      rageclick: true,
      capture_dead_clicks: true,
      enable_heatmaps: true,
      disable_session_recording: true,
      // Our guard works on the fields it names; the SDK's own event type carries more, passed through untouched.
      before_send: (event) => (event ? (beforeSend(event as unknown as OutgoingEvent) as unknown as typeof event) : null),
    });
    ready = true;
  } catch {
    ready = false;
  }
}

export function track(event: EventName, props?: Record<string, unknown>): void {
  if (!ready) return;
  try {
    posthog.capture(event, sanitize(event, props));
  } catch {
    // Analytics must never break the app.
  }
}

export function identifyPerson(person: AnalyticsPerson): void {
  if (!ready || identifiedAs === person.id) return;
  try {
    posthog.identify(person.id, {
      name: person.name,
      email: person.email,
      role: 'coach',
      workspace_id: person.workspaceId,
      workspace_name: person.workspaceName,
      internal: isInternalEmail(person.email),
    });
    identifiedAs = person.id;
  } catch {
    // ignore
  }
}

/** Sets a person property only the first time (e.g. when someone first reached a milestone). */
export function setOnce(props: Record<string, string>): void {
  if (!ready) return;
  try {
    posthog.setPersonProperties(undefined, props);
  } catch {
    // ignore
  }
}

const tracker = new TaskTracker((event, props) => track(event, props));

export function getTaskTracker(): TaskTracker {
  return tracker;
}

/** Sign-out: forget the person and drop any open tasks so the next user starts clean. */
export function resetAnalytics(): void {
  tracker.clear();
  identifiedAs = null;
  if (!ready) return;
  try {
    posthog.reset();
  } catch {
    // ignore
  }
}

const createdAt = new Map<string, number>();

/** Remember when something was made, so deleting it soon after counts as a quick undo. */
export function markCreated(itemType: string, id: string): void {
  createdAt.set(`${itemType}:${id}`, Date.now());
}

/** Call when something is deleted or reverted; reports `quick_undo` if it was made under 30 s ago. */
export function markUndone(itemType: string, id: string): void {
  const at = createdAt.get(`${itemType}:${id}`);
  createdAt.delete(`${itemType}:${id}`);
  if (at !== undefined && isQuickUndo(at, Date.now())) track('quick_undo', { item_type: itemType });
}
