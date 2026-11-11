import { describe, expect, it } from 'vitest';
import { buildServerErrorEvent, isServerFailureCode } from '../../src/analytics/server-error';

const USER = '0b6a8f7e-3c2d-4e1f-9a8b-7c6d5e4f3a2b';

class PostgrestError extends Error {
  body: unknown;
  constructor(message: string) {
    super(message);
    this.body = { name: 'Luis', email: 'luis@example.com' };
  }
}

describe('buildServerErrorEvent', () => {
  it('keeps no message, stack, body or other user content', () => {
    const error = {
      message: 'luis@example.com',
      stack: 'at saveClient (luis@example.com)',
      body: { name: 'Luis' },
      details: 'Key (email)=(luis@example.com) already exists',
      hint: 'Luis',
    };
    const json = JSON.stringify(
      buildServerErrorEvent({ error, code: 'invite_send_failed', where: 'action:invite.sendInvite', distinctId: USER }),
    );
    for (const secret of ['luis', 'Luis', 'stack', 'example.com', 'already exists']) expect(json).not.toContain(secret);
  });

  it('keeps no content from a real Error subclass either', () => {
    const json = JSON.stringify(
      buildServerErrorEvent({ error: new PostgrestError('duplicate luis@example.com'), code: 'assign_save_failed', where: 'action:assign' }),
    );
    expect(json).not.toMatch(/luis|Luis|duplicate|at /);
    expect(json).toContain('"type":"PostgrestError"');
  });

  it('outputs exactly the allowed fields, with value equal to code', () => {
    const event = buildServerErrorEvent({
      error: new TypeError('x'),
      code: 'assign_save_failed',
      where: 'action:assign.assignProgram',
      distinctId: USER,
      sessionId: '0192f3a1-aaaa-7bbb-8ccc-123456789abc',
    });
    expect(Object.keys(event).sort()).toEqual(['distinct_id', 'event', 'properties']);
    expect(Object.keys(event.properties).sort()).toEqual(['$exception_list', '$session_id', 'code', 'where']);
    expect(event).toEqual({
      event: '$exception',
      distinct_id: USER,
      properties: {
        $exception_list: [{ type: 'TypeError', value: 'assign_save_failed' }],
        code: 'assign_save_failed',
        where: 'action:assign.assignProgram',
        $session_id: '0192f3a1-aaaa-7bbb-8ccc-123456789abc',
      },
    });
    expect(Object.keys(event.properties.$exception_list[0]).sort()).toEqual(['type', 'value']);
  });

  it('names the type ActionFailed without an error, Error for odd constructors', () => {
    expect(buildServerErrorEvent({ code: 'x_failed', where: 'fn:send-invite' }).properties.$exception_list[0].type).toBe(
      'ActionFailed',
    );
    expect(buildServerErrorEvent({ error: { message: 'm' }, code: 'x_failed', where: 'fn:a' }).properties.$exception_list[0].type).toBe(
      'Object',
    );
    expect(buildServerErrorEvent({ error: 'luis@example.com', code: 'x_failed', where: 'fn:a' }).properties.$exception_list[0].type).toBe(
      'Error',
    );
    expect(buildServerErrorEvent({ error: null, code: 'x_failed', where: 'fn:a' }).properties.$exception_list[0].type).toBe('Error');
    const weird = new Error('m');
    Object.defineProperty(weird, 'constructor', { value: { name: 'Luis luis@example.com' } });
    expect(buildServerErrorEvent({ error: weird, code: 'x_failed', where: 'fn:a' }).properties.$exception_list[0].type).toBe('Error');
    const throwing = new Proxy({}, { getPrototypeOf: () => { throw new Error('boom'); }, get: () => { throw new Error('boom'); } });
    expect(buildServerErrorEvent({ error: throwing, code: 'x_failed', where: 'fn:a' }).properties.$exception_list[0].type).toBe('Error');
  });

  it('falls back to server_error for a bad code', () => {
    for (const code of ['Bad Code', 'luis@example.com', 'a'.repeat(41), '', 'x_', '_x', 'X_FAILED']) {
      const event = buildServerErrorEvent({ code, where: 'fn:a' });
      expect(event.properties.code).toBe('server_error');
      expect(event.properties.$exception_list[0].value).toBe('server_error');
    }
    expect(buildServerErrorEvent({ code: 'a'.repeat(40), where: 'fn:a' }).properties.code).toBe('a'.repeat(40));
    expect(buildServerErrorEvent({ code: 'server_error', where: 'fn:a' }).properties.code).toBe('server_error');
  });

  it('falls back to unknown for a bad where', () => {
    for (const where of ['', 'action:', 'luis@example.com', 'action:has space', 'other:x', `fn:${'a'.repeat(81)}`, 'action:(coach)/x']) {
      expect(buildServerErrorEvent({ code: 'x_failed', where }).properties.where).toBe('unknown');
    }
    expect(buildServerErrorEvent({ code: 'x_failed', where: 'action:clients/[clientId]/training/page' }).properties.where).toBe(
      'action:clients/[clientId]/training/page',
    );
  });

  it('uses server as distinct id without a valid user id, and skips the person profile', () => {
    for (const distinctId of [undefined, null, '', 'luis@example.com', 'not-a-uuid']) {
      const event = buildServerErrorEvent({ code: 'x_failed', where: 'fn:a', distinctId });
      expect(event.distinct_id).toBe('server');
      expect(event.properties.$process_person_profile).toBe(false);
    }
    const withUser = buildServerErrorEvent({ code: 'x_failed', where: 'fn:a', distinctId: USER });
    expect(withUser.distinct_id).toBe(USER);
    expect('$process_person_profile' in withUser.properties).toBe(false);
  });

  it('drops a session id that does not look like one', () => {
    for (const sessionId of [undefined, null, '', 'luis@example.com', 'a'.repeat(65), 'a b']) {
      expect('$session_id' in buildServerErrorEvent({ code: 'x_failed', where: 'fn:a', sessionId }).properties).toBe(false);
    }
  });
});

describe('isServerFailureCode', () => {
  it('is true for server_error and *_failed only', () => {
    expect(isServerFailureCode('server_error')).toBe(true);
    expect(isServerFailureCode('assign_save_failed')).toBe(true);
    expect(isServerFailureCode('field_required')).toBe(false);
    expect(isServerFailureCode('invite_email_invalid')).toBe(false);
    expect(isServerFailureCode('failed')).toBe(false);
  });
});
