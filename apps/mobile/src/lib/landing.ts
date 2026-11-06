/**
 * Where the app opens for a user: sign in, the "Ask your coach" screen, or Today.
 *
 * Used by "/" and by the signed-in area's guards. When a client joins a coach ("Check again"), the guards swap the
 * screens and redirect here; without a named target they fell back to the tab group itself, which doesn't say which
 * tab, and the client landed on the Zoo tab instead of Today.
 */
export function landingHref({ signedIn, hasCoach }: { signedIn: boolean; hasCoach: boolean }): '/sign-in' | '/home' | '/today' {
  if (!signedIn) return '/sign-in';
  return hasCoach ? '/today' : '/home';
}
