/**
 * supabase-js's default storage key for a project URL ("sb-<first label of the host>-auth-token"), spelled out so
 * the confirmation retry addresses the same entries. Changing it would sign everyone out.
 * auth-keys.test.ts checks it against the real supabase-js.
 */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/**
 * Where supabase-js keeps the PKCE code verifier that an exchange without a flow id reads (our case: the emailed
 * link carries no flow id). completeConfirmation() restores it after a dropped connection made supabase-js delete it.
 */
export function pkceVerifierKey(storageKey: string): string {
  return `${storageKey}-code-verifier`;
}
