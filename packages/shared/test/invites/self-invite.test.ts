import { describe, expect, it } from 'vitest';
import { clientTestEmail, selfInviteMessage } from '../../src/invites/self-invite';

describe('clientTestEmail', () => {
  it('adds +client before the @', () => {
    expect(clientTestEmail('lggbueno23@gmail.com')).toBe('lggbueno23+client@gmail.com');
  });
  it('lowercases and trims', () => {
    expect(clientTestEmail('  Sam.Coach@Example.COM ')).toBe('sam.coach+client@example.com');
  });
  it('replaces an existing +tag instead of stacking them', () => {
    expect(clientTestEmail('sam+coach@gmail.com')).toBe('sam+client@gmail.com');
  });
});

describe('selfInviteMessage', () => {
  it('names the address to use instead', () => {
    expect(selfInviteMessage('lggbueno23@gmail.com')).toBe(
      "That's your coach email. To test as a client, use lggbueno23+client@gmail.com",
    );
  });
});
