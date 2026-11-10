import type { Person } from '@/components/people-search';

export type ClientGroup = { coachName: string | null; clients: Person[] };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * The Clients page: one group per coach, sorted by coach name, then a last "No coach" group (coachName null) for
 * clients who were removed or whose coach was deleted. Clients are sorted by name inside each group. Groups are by
 * coach name, as admin_people returns it; coaches (and anyone not a client) are left out. Empty groups are dropped.
 */
export function groupClientsByCoach(people: Person[]): ClientGroup[] {
  const byCoach = new Map<string, Person[]>();
  const noCoach: Person[] = [];
  for (const p of people) {
    if (p.kind !== 'client') continue;
    const coach = p.coach_name?.trim();
    if (!coach) {
      noCoach.push(p);
      continue;
    }
    byCoach.set(coach, [...(byCoach.get(coach) ?? []), p]);
  }
  const sortClients = (list: Person[]) => [...list].sort((a, b) => byName(a.name || a.email, b.name || b.email));
  const groups: ClientGroup[] = [...byCoach.entries()]
    .sort(([a], [b]) => byName(a, b))
    .map(([coachName, clients]) => ({ coachName, clients: sortClients(clients) }));
  if (noCoach.length > 0) groups.push({ coachName: null, clients: sortClients(noCoach) });
  return groups;
}
