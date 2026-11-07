import { describe, expect, it } from 'vitest';
import {
  AssignToClientsInput,
  assignSummary,
  filterClients,
  nextFreeDay,
  nextMonday,
  workoutClashes,
} from '../../src/programs/assign-targets';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('nextFreeDay', () => {
  it('is the first day from `from` on with nothing planned', () => {
    expect(nextFreeDay('2026-11-09', [])).toBe('2026-11-09');
    expect(nextFreeDay('2026-11-09', ['2026-11-09', '2026-11-10', '2026-11-12'])).toBe('2026-11-11');
  });

  it('ignores days before `from`', () => {
    expect(nextFreeDay('2026-11-09', ['2026-11-08', '2026-11-07'])).toBe('2026-11-09');
  });

  it('runs across month and year ends', () => {
    expect(nextFreeDay('2026-12-31', ['2026-12-31'])).toBe('2027-01-01');
  });

  it('gives up after a year and answers `from` (a fully booked calendar still gets a day)', () => {
    const taken = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2026, 10, 9 + i)).toISOString().slice(0, 10));
    expect(nextFreeDay('2026-11-09', taken)).toBe('2026-11-09');
  });
});

describe('nextMonday', () => {
  it('is the Monday after today, a week on when today is a Monday', () => {
    expect(nextMonday('2026-11-07')).toBe('2026-11-09'); // Saturday
    expect(nextMonday('2026-11-08')).toBe('2026-11-09'); // Sunday
    expect(nextMonday('2026-11-09')).toBe('2026-11-16'); // Monday
    expect(nextMonday('2026-11-11')).toBe('2026-11-16'); // Wednesday
  });
});

describe('workoutClashes', () => {
  it('names what is already on that day', () => {
    const existing = [
      { date: '2026-11-09', name: 'Legs' },
      { date: '2026-11-10', name: 'Arms' },
      { date: '2026-11-09', name: 'Run' },
    ];
    expect(workoutClashes('2026-11-09', existing)).toEqual([{ date: '2026-11-09', names: ['Legs', 'Run'] }]);
    expect(workoutClashes('2026-11-11', existing)).toEqual([]);
  });
});

describe('filterClients', () => {
  const clients = [
    { id: '1', firstName: 'José', lastName: 'Álvarez' },
    { id: '2', firstName: 'Amy', lastName: 'Jones' },
    { id: '3', firstName: 'Ben', lastName: 'Joseph' },
  ];

  it('keeps everyone for a blank query', () => {
    expect(filterClients(clients, '  ')).toEqual(clients);
  });

  it('matches part of the full name, ignoring case and accents, with no cap', () => {
    expect(filterClients(clients, 'jos').map((c) => c.id)).toEqual(['1', '3']);
    expect(filterClients(clients, 'amy j').map((c) => c.id)).toEqual(['2']);
  });
});

describe('assignSummary', () => {
  it('says how many clients got it', () => {
    expect(assignSummary('Legs', [{ ok: true }])).toBe('Assigned Legs to 1 client.');
    expect(assignSummary('Legs', [{ ok: true }, { ok: true }])).toBe('Assigned Legs to 2 clients.');
  });

  it('says how many failed', () => {
    expect(assignSummary('Legs', [{ ok: true }, { ok: false }, { ok: false }])).toBe(
      "Assigned Legs to 1 of 3 clients. 2 couldn't be assigned.",
    );
    expect(assignSummary('Legs', [{ ok: false }])).toBe("Couldn't assign Legs.");
  });
});

describe('AssignToClientsInput', () => {
  const base = { kind: 'workout' as const, sourceId: ID(1), today: '2026-11-07' };

  it('takes one id and day per client', () => {
    const r = AssignToClientsInput.safeParse({ ...base, targets: [{ clientId: ID(2), id: ID(3), date: '2026-11-07' }] });
    expect(r.success).toBe(true);
  });

  it('needs at least one client, at most 100, and each client once', () => {
    expect(AssignToClientsInput.safeParse({ ...base, targets: [] }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => ({ clientId: ID(1000 + i), id: ID(2000 + i), date: '2026-11-07' }));
    expect(AssignToClientsInput.safeParse({ ...base, targets: many }).success).toBe(false);
    const twice = [
      { clientId: ID(2), id: ID(3), date: '2026-11-07' },
      { clientId: ID(2), id: ID(4), date: '2026-11-08' },
    ];
    expect(AssignToClientsInput.safeParse({ ...base, targets: twice }).success).toBe(false);
  });

  it('needs distinct new ids, so one id never stands for two clients', () => {
    const sameId = [
      { clientId: ID(2), id: ID(3), date: '2026-11-07' },
      { clientId: ID(4), id: ID(3), date: '2026-11-07' },
    ];
    expect(AssignToClientsInput.safeParse({ ...base, targets: sameId }).success).toBe(false);
  });

  it('refuses an unknown kind or a bad date', () => {
    expect(AssignToClientsInput.safeParse({ ...base, kind: 'week', targets: [{ clientId: ID(2), id: ID(3), date: '2026-11-07' }] }).success).toBe(false);
    expect(AssignToClientsInput.safeParse({ ...base, targets: [{ clientId: ID(2), id: ID(3), date: '7 Nov' }] }).success).toBe(false);
  });
});
