'use server';

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';

export type SetPasswordState = { error: string | null };

export async function setPassword(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const password = formData.get('password');
  const confirm = formData.get('confirm');
  if (typeof password !== 'string' || password.length < 8) {
    return { error: 'Use at least 8 characters.' };
  }
  if (password !== confirm) return { error: 'The two passwords do not match.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      error:
        error.code === 'same_password'
          ? 'Choose a password you have not used before.'
          : 'We could not save your password. Please try again, or ask for a new link.',
    };
  }
  redirect('/home');
}
