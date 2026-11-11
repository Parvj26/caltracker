/**
 * Saved filters in PostHog → Replay, so the PO can find the coach sessions worth watching (spec: better usage
 * insight, "How the PO finds sessions"). Created or updated by name from posthog-dashboards.ts; safe to re-run.
 * Internal and test accounts are left out through the project's test-account filter (set by the same script).
 */

interface EventFilter {
  id: string;
  name: string;
  type: 'events';
  order: number;
}

export interface ReplayFilter {
  name: string;
  description: string;
  type: 'filters';
  filters: {
    date_from: string;
    filter_test_accounts: true;
    order: 'start_time';
    filter_group: { type: 'OR'; values: { type: 'OR'; values: EventFilter[] }[] };
  };
}

/** Sessions containing any of these events. */
function anyOf(name: string, description: string, events: string[]): ReplayFilter {
  return {
    name,
    description,
    type: 'filters',
    filters: {
      date_from: '-30d',
      filter_test_accounts: true,
      order: 'start_time',
      filter_group: { type: 'OR', values: [{ type: 'OR', values: events.map((id, order) => ({ id, name: id, type: 'events', order })) }] },
    },
  };
}

export const REPLAY_FILTERS: ReplayFilter[] = [
  anyOf('Coach friction', 'Sessions with rage clicks or dead clicks (clicks that did nothing).', ['$rageclick', '$dead_click']),
  anyOf('Coach errors', 'Sessions where an error was shown or the server failed; the event list shows the code and where.', ['error_shown', '$exception']),
  anyOf('Gave up', 'Sessions where a task was left unfinished; filter by the task property (e.g. assign_program).', ['task_abandoned']),
];

type Api = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/** Creates each saved filter, or updates the one with the same name. Returns links for the log. */
export async function upsertReplayFilters(api: Api): Promise<{ name: string; created: boolean; shortId: string }[]> {
  const existing = await api<{ results: { short_id: string; name: string }[] }>('GET', '/session_recording_playlists/?limit=200');
  const out: { name: string; created: boolean; shortId: string }[] = [];
  for (const f of REPLAY_FILTERS) {
    const found = existing.results.find((x) => x.name === f.name);
    const saved = found
      ? await api<{ short_id: string }>('PATCH', `/session_recording_playlists/${found.short_id}/`, f)
      : await api<{ short_id: string }>('POST', '/session_recording_playlists/', f);
    out.push({ name: f.name, created: !found, shortId: saved.short_id });
  }
  return out;
}
