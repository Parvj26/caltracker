import { describe, expect, it, vi } from 'vitest';
import { alertCode, alertReporter } from './alert-code';

describe('alertCode', () => {
  it('reports a known data-error-code', () => {
    expect(alertCode('invite_email_invalid')).toBe('invite_email_invalid');
  });
  it('reports missing_code for an alert without a known code (no more "alert")', () => {
    expect(alertCode(null)).toBe('missing_code');
    expect(alertCode('alert')).toBe('missing_code');
    expect(alertCode('Luis is not a client')).toBe('missing_code');
  });
});

describe('alertReporter', () => {
  const el = (code: string | null) => ({ code, getAttribute: function (this: { code: string | null }) { return this.code; } });
  it('reports a new alert once, and again when its code changes in place', () => {
    const report = vi.fn();
    const seen = alertReporter(report);
    const a = el('invite_plan_no_program');
    seen(a);
    seen(a);
    expect(report.mock.calls).toEqual([['invite_plan_no_program']]);
    a.code = 'invite_plan_no_start';
    seen(a);
    expect(report.mock.calls).toEqual([['invite_plan_no_program'], ['invite_plan_no_start']]);
  });
  it('reports two alerts with the same code separately', () => {
    const report = vi.fn();
    const seen = alertReporter(report);
    seen(el('field_required'));
    seen(el('field_required'));
    expect(report).toHaveBeenCalledTimes(2);
  });
});
