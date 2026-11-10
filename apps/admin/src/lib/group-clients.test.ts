import { describe, expect, it } from 'vitest';
import type { Person } from '@/components/people-search';
import { groupClientsByCoach } from './group-clients';

const client = (name: string, coach: string | null): Person => ({
  user_id: name,
  kind: 'client',
  name,
  email: `${name.toLowerCase().replace(/\s+/g, '')}@x.test`,
  coach_name: coach,
});

describe('groupClientsByCoach', () => {
  it('groups by coach, sorted by coach name, with "No coach" last', () => {
    const groups = groupClientsByCoach([
      client('Zed', null),
      client('Join One', 'Parv (test)'),
      client('Parv Jain', 'Luis Bueno'),
      client('Apple Review', 'Parv (test)'),
      { user_id: 'c1', kind: 'coach', name: 'Luis Bueno', email: 'l@x.test', coach_name: null },
    ]);
    expect(groups.map((g) => [g.coachName, g.clients.map((c) => c.name)])).toEqual([
      ['Luis Bueno', ['Parv Jain']],
      ['Parv (test)', ['Apple Review', 'Join One']],
      [null, ['Zed']],
    ]);
  });

  it('sorts coaches and clients ignoring case', () => {
    const groups = groupClientsByCoach([client('bea', 'zoe'), client('Al', 'Adam'), client('Cy', 'zoe')]);
    expect(groups.map((g) => g.coachName)).toEqual(['Adam', 'zoe']);
    expect(groups[1]!.clients.map((c) => c.name)).toEqual(['bea', 'Cy']);
  });

  it('treats a blank coach name as no coach and leaves out empty groups', () => {
    expect(groupClientsByCoach([client('Al', '  ')])).toEqual([{ coachName: null, clients: [client('Al', '  ')] }]);
    expect(groupClientsByCoach([client('Al', 'Adam')]).some((g) => g.coachName === null)).toBe(false);
    expect(groupClientsByCoach([])).toEqual([]);
  });
});
