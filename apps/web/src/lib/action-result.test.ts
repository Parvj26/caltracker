import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportServerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics/server', () => ({ reportServerError }));

const { fail } = await import('./action-result');

beforeEach(() => {
  reportServerError.mockReset();
});

describe('fail', () => {
  it('returns only ok:false and the code', () => {
    expect(fail('assign_save_failed', 'action:assign.assignProgram')).toEqual({ ok: false, code: 'assign_save_failed' });
  });

  it('reports a server failure once, with only the code and where', () => {
    fail('assign_save_failed', 'action:assign.assignProgram');
    expect(reportServerError.mock.calls).toEqual([[{ code: 'assign_save_failed', where: 'action:assign.assignProgram' }]]);
    reportServerError.mockReset();
    fail('server_error', 'action:clients.removeClient');
    expect(reportServerError.mock.calls).toEqual([[{ code: 'server_error', where: 'action:clients.removeClient' }]]);
  });

  it('never reports a refusal of bad input', () => {
    fail('field_required', 'action:overview.addNote');
    fail('request_invalid', 'action:overview.addNote');
    fail('meal_photo_invalid', 'action:meals.saveCoachMeal');
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it('still answers when the reporter throws', () => {
    reportServerError.mockImplementation(() => {
      throw new Error('down');
    });
    expect(fail('assign_save_failed', 'action:assign.assignProgram')).toEqual({ ok: false, code: 'assign_save_failed' });
  });
});
