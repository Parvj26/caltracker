import type { DirectoryFilter } from '@caltracker/shared';

/**
 * Which rows the Clients list searches. With an empty box it follows the picked chip (clients matching it, or the
 * invites under "Invited"). Once something is typed it looks through every client and every invite, whatever chip is
 * picked, so a name is never hidden behind the wrong chip; clearing the box goes back to the chip.
 */
export function searchScope(filter: DirectoryFilter, query: string): { clientFilter: DirectoryFilter | null; invites: boolean } {
  if (query.trim() !== '') return { clientFilter: 'active', invites: true };
  if (filter === 'invited') return { clientFilter: null, invites: true };
  return { clientFilter: filter, invites: false };
}
