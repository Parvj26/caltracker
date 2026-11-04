'use server';

import { createServerSupabase } from '@/lib/supabase/server';

export type ForgotPasswordState = { done: boolean };

/**
 * Sends a password-reset email. The answer is always the same, so nobody can use this form to find out
 * which emails have an account. The email link comes from the "Reset password" template and goes through
 * /auth/confirm to /set-password. GoTrue rate-limits repeated requests.
 */
export async function requestPasswordReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const value = formData.get('email');
  const email = typeof value === 'string' ? value.trim() : '';
  if (email) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) console.error('forgot-password: reset request failed', error.code ?? error.status);
  }
  return { done: true };
}
