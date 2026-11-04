import { createClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { largeSecureStore } from './secure-storage';

// Only the public URL and anon key ship in the app (access is enforced by RLS).
// Expo's process.env typing is loose (any); cast to the real shape. Access must stay static for inlining.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
if (!url || !anonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Run `pnpm --filter mobile env:local`.');
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: largeSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
