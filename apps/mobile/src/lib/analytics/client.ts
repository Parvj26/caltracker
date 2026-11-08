import PostHog from 'posthog-react-native';
import { TaskTracker, beforeSend, isInternalEmail, isQuickUndo, sanitize, type EventName, type OutgoingEvent } from '@caltracker/shared';

/**
 * The only door to PostHog in the phone app (ESLint blocks importing posthog-react-native anywhere else).
 * With no key configured (tests, local) every call is a no-op, and nothing here ever throws.
 */

let client: PostHog | null = null;
let identifiedAs: string | null = null;

export interface AnalyticsPerson {
  id: string;
  name: string;
  email: string;
  workspaceId: string | null;
  workspaceName: string | null;
}

export function getAnalyticsClient(): PostHog | null {
  if (client) return client;
  // Expo's process.env typing is loose (any); access must stay static for inlining.
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY as string | undefined;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST as string | undefined;
  if (!key) return null;
  try {
    client = new PostHog(key, {
      host: host || 'https://us.i.posthog.com',
      personProfiles: 'identified_only',
      captureAppLifecycleEvents: true,
      enableSessionReplay: false,
      // Our guard works on the fields it names; the SDK's own event type carries more, passed through untouched.
      before_send: (event) => beforeSend(event as unknown as OutgoingEvent) as unknown as typeof event,
    });
  } catch {
    client = null;
  }
  return client;
}

export function track(event: EventName, props?: Record<string, unknown>): void {
  const ph = getAnalyticsClient();
  if (!ph) return;
  try {
    ph.capture(event, sanitize(event, props));
  } catch {
    // Analytics must never break the app.
  }
}

let current = '';

/** The scrubbed name of the screen on show (for events raised outside a screen, like slow loads). */
export function currentScreen(): string {
  return current;
}

export function screen(name: string): void {
  current = name;
  const ph = getAnalyticsClient();
  if (!ph) return;
  try {
    void ph.screen(name).catch(() => undefined);
  } catch {
    // ignore
  }
}

export function identifyPerson(person: AnalyticsPerson): void {
  const ph = getAnalyticsClient();
  if (!ph || identifiedAs === person.id) return;
  try {
    ph.identify(person.id, {
      name: person.name,
      email: person.email,
      role: 'client',
      ...(person.workspaceId ? { workspace_id: person.workspaceId } : {}),
      ...(person.workspaceName ? { workspace_name: person.workspaceName } : {}),
      internal: isInternalEmail(person.email),
    });
    identifiedAs = person.id;
  } catch {
    // ignore
  }
}

const tracker = new TaskTracker((event, props) => track(event, props));

export function getTaskTracker(): TaskTracker {
  return tracker;
}

/** Sign-out: forget the person and drop any open tasks so the next user on this phone starts clean. */
export function resetAnalytics(): void {
  tracker.clear();
  identifiedAs = null;
  const ph = getAnalyticsClient();
  if (!ph) return;
  try {
    ph.reset();
  } catch {
    // ignore
  }
}

const createdAt = new Map<string, number>();

/** Remember when something was made, so deleting it soon after counts as a quick undo. */
export function markCreated(itemType: string, id: string): void {
  createdAt.set(`${itemType}:${id}`, Date.now());
}

/** Call when something is deleted; reports `quick_undo` if it was made under 30 s ago. */
export function markUndone(itemType: string, id: string): void {
  const at = createdAt.get(`${itemType}:${id}`);
  createdAt.delete(`${itemType}:${id}`);
  if (at !== undefined && isQuickUndo(at, Date.now())) track('quick_undo', { item_type: itemType });
}
