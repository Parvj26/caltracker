/**
 * "Sam liked your post", "Sam and Kim liked your post", "Sam and 4 others liked your post".
 * `names` are the likers newest first (the first one is named); `total` is how many there are in all.
 */
export function groupedLikeText(names: readonly string[], total: number = names.length, object = 'your post'): string {
  const count = Math.max(total, names.length);
  const first = names[0] ?? 'Someone';
  if (count <= 1) return `${first} liked ${object}`;
  if (count === 2 && names[1]) return `${first} and ${names[1]} liked ${object}`;
  const others = count - 1;
  return `${first} and ${others} ${others === 1 ? 'other' : 'others'} liked ${object}`;
}

/**
 * The line under a post: "Be the first to like this", "You like this", "Sam likes this", "You and Sam like this",
 * "You and 3 others like this", "Sam and 2 others like this".
 */
export function likersLine(otherNames: readonly string[], youLiked: boolean): string {
  const others = otherNames.length;
  if (!youLiked && others === 0) return '';
  if (youLiked && others === 0) return 'You like this';
  if (youLiked) return others === 1 ? `You and ${otherNames[0]} like this` : `You and ${others} others like this`;
  if (others === 1) return `${otherNames[0]} likes this`;
  if (others === 2) return `${otherNames[0]} and ${otherNames[1]} like this`;
  return `${otherNames[0]} and ${others - 1} others like this`;
}
