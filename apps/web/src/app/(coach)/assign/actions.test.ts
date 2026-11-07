import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Assign to several clients: one database call per client (schedule_workout or assign_program), each all or nothing,
// with every client's answer reported back. A refusal for one client doesn't stop the others.
type Rpc = { name: string; args: Record<string, unknown> };
const rpcs: Rpc[] = [];
/** Client ids whose call fails, and with which code. */
let failFor = new Map<string, string>();
let revalidated = 0;

const supabase = {
  rpc: (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    const code = failFor.get(args.p_client_id as string);
    return Promise.resolve(code ? { data: null, error: { code, message: 'no' } } : { data: args.p_assignment_id ?? args.p_new_id, error: null });
  },
  from: () => {
    const b = {
      select: () => b,
      eq: () => b,
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ count: 3, error: null }).then(ok),
    };
    return b;
  },
};

vi.mock('next/cache', () => ({ revalidatePath: () => (revalidated += 1) }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ workspaceId: 'ws' }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve(supabase) }));

import { assignToClients } from './actions';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOURCE = ID(1);
const A = ID(10);
const B = ID(11);
const C = ID(12);

beforeEach(() => {
  rpcs.length = 0;
  failFor = new Map();
  revalidated = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const targets = (date: string) => [
  { clientId: A, id: ID(20), date },
  { clientId: B, id: ID(21), date },
  { clientId: C, id: ID(22), date },
];

describe('assignToClients', () => {
  it('schedules a workout once per client with that client\'s own id and day', async () => {
    const out = await assignToClients({ kind: 'workout', sourceId: SOURCE, today: '2026-11-07', targets: targets('2026-11-07') });
    expect(out).toEqual({
      ok: true,
      results: [
        { clientId: A, ok: true, count: 1 },
        { clientId: B, ok: true, count: 1 },
        { clientId: C, ok: true, count: 1 },
      ],
    });
    expect(rpcs.map((r) => r.name)).toEqual(['schedule_workout', 'schedule_workout', 'schedule_workout']);
    expect(rpcs.find((r) => r.args.p_client_id === B)?.args).toEqual({
      p_new_id: ID(21),
      p_workout_id: SOURCE,
      p_client_id: B,
      p_date: '2026-11-07',
    });
    expect(revalidated).toBeGreaterThan(0);
  });

  it('assigns a program per client and counts the workouts it added', async () => {
    const out = await assignToClients({ kind: 'program', sourceId: SOURCE, today: '2026-11-07', targets: targets('2026-11-09') });
    expect(out.ok && out.results.every((r) => r.ok && r.count === 3)).toBe(true);
    expect(rpcs.every((r) => r.name === 'assign_program' && r.args.p_start_date === '2026-11-09')).toBe(true);
  });

  it('reports a client the coach can no longer assign to, and still assigns the rest', async () => {
    failFor = new Map([[B, '42501']]);
    const out = await assignToClients({ kind: 'workout', sourceId: SOURCE, today: '2026-11-07', targets: targets('2026-11-08') });
    if (!out.ok) throw new Error('expected per-client results');
    expect(out.results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(out.results[1]).toMatchObject({ clientId: B, ok: false });
    expect(out.results[1]!.ok ? '' : out.results[1]!.error).toContain('may no longer be your client');
  });

  it('refuses past days per the date rules without calling the database', async () => {
    const workout = await assignToClients({ kind: 'workout', sourceId: SOURCE, today: '2026-11-07', targets: targets('2026-11-06') });
    expect(workout.ok && workout.results.every((r) => !r.ok)).toBe(true);
    // A program may start up to 7 days back, not 8.
    const program = await assignToClients({ kind: 'program', sourceId: SOURCE, today: '2026-11-07', targets: targets('2026-10-30') });
    expect(program.ok && program.results.every((r) => !r.ok)).toBe(true);
    expect(rpcs).toHaveLength(0);
  });

  it('refuses a device date far from the server\'s, and malformed input', async () => {
    const far = await assignToClients({ kind: 'workout', sourceId: SOURCE, today: '2026-11-20', targets: targets('2026-11-20') });
    expect(far.ok ? '' : far.error).toContain('date looks wrong');
    const none = await assignToClients({ kind: 'workout', sourceId: SOURCE, today: '2026-11-07', targets: [] });
    expect(none.ok).toBe(false);
    expect(rpcs).toHaveLength(0);
  });
});
