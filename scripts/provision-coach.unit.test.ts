import { describe, expect, it } from 'vitest';
import { parseProvisionArgs } from './provision-coach';

const USAGE = /Usage: provision:coach --email <email> --first-name/;

describe('parseProvisionArgs', () => {
  it('reads email, first name, last name and workspace', () => {
    expect(
      parseProvisionArgs(['--email', 'sam@x.com', '--first-name', ' Sam ', '--last-name', ' Lee ', '--workspace', 'Sam Gym']),
    ).toEqual({ email: 'sam@x.com', firstName: 'Sam', lastName: 'Lee', workspaceName: 'Sam Gym' });
  });

  it('allows the last name to be left out', () => {
    expect(parseProvisionArgs(['--email', 'c@x.com', '--first-name', 'Cher', '--workspace', 'Gym']).lastName).toBe('');
  });

  it('requires email, first name and workspace', () => {
    expect(() => parseProvisionArgs(['--first-name', 'Sam', '--workspace', 'Gym'])).toThrow(USAGE);
    expect(() => parseProvisionArgs(['--email', 'a@x.com', '--workspace', 'Gym'])).toThrow(USAGE);
    expect(() => parseProvisionArgs(['--email', 'a@x.com', '--first-name', '  ', '--workspace', 'Gym'])).toThrow(USAGE);
    expect(() => parseProvisionArgs(['--email', 'a@x.com', '--first-name', 'Sam'])).toThrow(USAGE);
  });

  it('rejects names over 100 characters', () => {
    const long = 'x'.repeat(101);
    expect(() => parseProvisionArgs(['--email', 'a@x.com', '--first-name', long, '--workspace', 'Gym'])).toThrow(/100/);
    expect(() =>
      parseProvisionArgs(['--email', 'a@x.com', '--first-name', 'Sam', '--last-name', long, '--workspace', 'Gym']),
    ).toThrow(/100/);
  });

  it('rejects the old --name option', () => {
    expect(() => parseProvisionArgs(['--email', 'a@x.com', '--name', 'Sam Lee', '--workspace', 'Gym'])).toThrow();
  });
});
