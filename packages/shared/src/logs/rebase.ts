import type { WorkoutLogDoc } from './schema';

/** One edit of a log: a shared log operation, bound to its arguments. Same doc back when it changes nothing. */
export type LogEdit = (log: WorkoutLogDoc) => WorkoutLogDoc;

/**
 * Re-applies edits not yet saved on top of the server's newer copy of the log, for when a save was refused as stale
 * (for example the client's last sets from their phone arrived just after the coach took over). The log operations
 * work on set, exercise and block ids, so an edit means the same on either copy. An edit that no longer changes
 * anything (its set is gone) is dropped, and nothing applies once the log is finished or discarded. Returns the new doc and the edits still unsaved, each
 * with the revision it produced. Pure.
 */
export function rebaseEdits(
  server: WorkoutLogDoc,
  edits: readonly LogEdit[],
): { doc: WorkoutLogDoc; unsaved: { edit: LogEdit; revision: number }[] } {
  let doc = server;
  const unsaved: { edit: LogEdit; revision: number }[] = [];
  for (const edit of edits) {
    // Only an in-progress log takes edits (a finish or discard ends it; later edits are dropped).
    if (doc.status !== 'in_progress') break;
    const next = edit(doc);
    if (next === doc) continue;
    doc = next;
    unsaved.push({ edit, revision: next.revision });
  }
  return { doc, unsaved };
}
