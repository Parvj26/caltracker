import { assertEquals } from '@std/assert';
import { upgradeLegacyInvites } from './legacy.ts';

Deno.test('legacy fullName is split into first and last name', () => {
  assertEquals(
    upgradeLegacyInvites({ workspaceId: 'w', invites: [{ email: 'a@x.com', fullName: '  Sam  van Lee ' }] }),
    { workspaceId: 'w', invites: [{ email: 'a@x.com', firstName: 'Sam', lastName: 'van Lee' }] },
  );
});

Deno.test('firstName/lastName win over fullName when present', () => {
  assertEquals(
    upgradeLegacyInvites({
      workspaceId: 'w',
      invites: [{ email: 'a@x.com', fullName: 'Old Name', firstName: 'New', lastName: 'Person' }],
    }),
    { workspaceId: 'w', invites: [{ email: 'a@x.com', firstName: 'New', lastName: 'Person' }] },
  );
  // A firstName alone also wins; the last name then defaults to empty as usual.
  assertEquals(
    upgradeLegacyInvites({ workspaceId: 'w', invites: [{ email: 'a@x.com', fullName: 'Old Name', firstName: 'New' }] }),
    { workspaceId: 'w', invites: [{ email: 'a@x.com', firstName: 'New' }] },
  );
});

Deno.test('anything that is not a legacy body is passed through unchanged', () => {
  const modern = { workspaceId: 'w', invites: [{ email: 'a@x.com', firstName: 'Sam', lastName: '' }] };
  assertEquals(upgradeLegacyInvites(modern), modern);
  for (const odd of [null, 'text', 42, [], { invites: 'no' }, { invites: [null, 7] }]) {
    assertEquals(upgradeLegacyInvites(odd), odd);
  }
  // A non-string fullName is left for the schema to reject.
  assertEquals(upgradeLegacyInvites({ invites: [{ email: 'a@x.com', fullName: 5 }] }), {
    invites: [{ email: 'a@x.com', fullName: 5 }],
  });
});
