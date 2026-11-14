/** How often clients logged a shared meal, for its card: "Not logged yet", "Logged 1 time", "Logged 12 times". */
export function loggedLabel(count: number): string {
  if (!Number.isFinite(count) || count < 1) return 'Not logged yet';
  return count === 1 ? 'Logged 1 time' : `Logged ${count} times`;
}

/** The letter on a meal's tile when it has no photo: its first letter or digit, upper case ("?" if it has none). */
export function mealInitial(name: string): string {
  const first = /[\p{L}\p{N}]/u.exec(name.normalize('NFC'))?.[0];
  return first ? first.toLocaleUpperCase() : '?';
}
