'use server';

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';

export type SignInState = { error: string | null };

/** Password first; admins then go to two-step (/mfa), anyone else is signed out and told "Not authorised". */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const emailValue = formData.get('email');
  const passwordValue = formData.get('password');
  const email = typeof emailValue === 'string' ? emailValue.trim() : '';
  const password = typeof passwordValue === 'string' ? passwordValue : '';
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Same message for unknown email and wrong password, so we never reveal which emails exist.
    const invalid = error.code === 'invalid_credentials' || error.status === 400;
    return { error: invalid ? 'Incorrect email or password' : 'Something went wrong. Please try again.' };
  }
  const me = await supabase.rpc('admin_me');
  if (me.error) return { error: 'Something went wrong. Please try again.' };
  if (me.data.length === 0) {
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/not-authorised');
  }
  redirect('/mfa');
}
