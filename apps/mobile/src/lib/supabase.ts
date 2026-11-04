import { createClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { authStorageKey, pkceVerifierKey } from './auth-keys';
import type { VerifierStore } from './confirm-link';
import { largeSecureStore } from './secure-storage';

// Only the public URL and anon key ship in the app (access is enforced by RLS).
// Expo's process.env typing is loose (any); cast to the real shape. Access must stay static for inlining.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
if (!url || !anonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Run `pnpm --filter mobile env:local`.');
}

// supabase-js's own default key, spelled out so the confirmation retry below addresses the same entry.
// Changing it would sign everyone out.
const storageKey = authStorageKey(url);

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storageKey,
    storage: largeSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE: the code verifier is stored through the same adapter, so a deep link can only complete
    // a sign-up that started in this app (no injected tokens).
    flowType: 'pkce',
  },
});

// The PKCE verifier key supabase-js reads when exchanging a code without a flow id (our case).
// completeConfirmation() restores it if a dropped connection made supabase-js delete it.
const verifierKey = pkceVerifierKey(storageKey);
export const pkceVerifier: VerifierStore = {
  read: () => largeSecureStore.getItem(verifierKey),
  restore: (verifier) => largeSecureStore.setItem(verifierKey, verifier),
};
