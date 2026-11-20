import type { Person } from '@/components/people-search';

export type ClientGroup = { coachId: string | null; coachName: string | null; clients: Person[] };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * The Clients page: one group per coach, sorted by coach name, then a last "No coach" group (coachId null) for
 * clients who were removed or whose coach was deleted. Clients are sorted by name inside each group. Groups are by
 * coach id (two coaches can share a name); coaches and accounts that never had a coach are left out. Empty groups are
 * dropped.
 */
export function groupClientsByCoach(people: Person[]): ClientGroup[] {
  const byCoach = new Map<string, { name: string; clients: Person[] }>();
  const noCoach: Person[] = [];
  for (const p of people) {
    if (p.kind !== 'client') continue;
    if (!p.coach_id) {
      noCoach.push(p);
      continue;
    }
    const group = byCoach.get(p.coach_id) ?? { name: p.coach_name?.trim() ?? '', clients: [] };
    group.clients.push(p);
    byCoach.set(p.coach_id, group);
  }
  const sortClients = (list: Person[]) => [...list].sort((a, b) => byName(a.name || a.email, b.name || b.email));
  const groups: ClientGroup[] = [...byCoach.entries()]
    .sort(([idA, a], [idB, b]) => byName(a.name, b.name) || idA.localeCompare(idB))
    .map(([coachId, g]) => ({ coachId, coachName: g.name, clients: sortClients(g.clients) }));
  if (noCoach.length > 0) groups.push({ coachId: null, coachName: null, clients: sortClients(noCoach) });
  return groups;
}
