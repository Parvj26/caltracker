import { describe, expect, it } from 'vitest';
import { accountInitials, accountLine } from './settings-logic';

describe('account header', () => {
  it('shows initials from the name, else the email', () => {
    expect(accountInitials('Maya Thompson-Richardson', 'maya@example.com')).toBe('MT');
    expect(accountInitials('Maya Ann Lee', null)).toBe('ML');
    expect(accountInitials('Cher', null)).toBe('C');
    expect(accountInitials(null, 'maya@example.com')).toBe('M');
    expect(accountInitials('  ', null)).toBe('?');
  });
  it('says the email and who coaches the client', () => {
    expect(accountLine('maya@example.com', 'Luis')).toBe('maya@example.com · coached by Luis');
    expect(accountLine('maya@example.com', null)).toBe('maya@example.com');
    expect(accountLine(null, null)).toBe('');
  });
});
