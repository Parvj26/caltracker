import { describe, expect, it } from 'vitest';
import { fail } from './action-result';

describe('fail', () => {
  it('returns only ok:false and the code', () => {
    expect(fail('assign_save_failed', 'action:assign.assignProgram')).toEqual({ ok: false, code: 'assign_save_failed' });
  });
});
