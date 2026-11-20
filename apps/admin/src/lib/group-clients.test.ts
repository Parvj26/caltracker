import { describe, expect, it } from 'vitest';
import type { Person } from '@/components/people-search';
import { groupClientsByCoach } from './group-clients';

const client = (name: string, coach: string | null, coachId: string | null = coach ? `id-${coach}` : null): Person => ({
  user_id: name,
  kind: 'client',
  name,
  email: `${name.toLowerCase().replace(/\s+/g, '')}@x.test`,
  coach_name: coach,
  coach_id: coachId,
});

describe('groupClientsByCoach', () => {
  it('groups by coach, sorted by coach name, with "No coach" last', () => {
    const groups = groupClientsByCoach([
      client('Zed', null),
      client('Join One', 'Parv (test)'),
      client('Parv Jain', 'Luis Bueno'),
      client('Apple Review', 'Parv (test)'),
      { user_id: 'c1', kind: 'coach', name: 'Luis Bueno', email: 'l@x.test', coach_name: null, coach_id: null },
      { user_id: 'a1', kind: 'account', name: 'Never Joined', email: 'n@x.test', coach_name: null, coach_id: null },
    ]);
    expect(groups.map((g) => [g.coachName, g.clients.map((c) => c.name)])).toEqual([
      ['Luis Bueno', ['Parv Jain']],
      ['Parv (test)', ['Apple Review', 'Join One']],
      [null, ['Zed']],
    ]);
  });

  it('keeps two coaches with the same name apart', () => {
    const groups = groupClientsByCoach([client('Al', 'Sam', 'sam-1'), client('Bo', 'Sam', 'sam-2')]);
    expect(groups.map((g) => [g.coachId, g.clients.map((c) => c.name)])).toEqual([
      ['sam-1', ['Al']],
      ['sam-2', ['Bo']],
    ]);
  });

  it('sorts coaches and clients ignoring case', () => {
    const groups = groupClientsByCoach([client('bea', 'zoe'), client('Al', 'Adam'), client('Cy', 'zoe')]);
    expect(groups.map((g) => g.coachName)).toEqual(['Adam', 'zoe']);
    expect(groups[1]!.clients.map((c) => c.name)).toEqual(['bea', 'Cy']);
  });

  it('a client with no coach id is in No coach, and empty groups are left out', () => {
    expect(groupClientsByCoach([client('Al', null)])).toEqual([{ coachId: null, coachName: null, clients: [client('Al', null)] }]);
    expect(groupClientsByCoach([client('Al', 'Adam')]).some((g) => g.coachId === null)).toBe(false);
    expect(groupClientsByCoach([])).toEqual([]);
  });
});
