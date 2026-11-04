'use server';

import { after } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export type ForgotPasswordState = { done: boolean };

/**
 * Sends a password-reset email. The answer is always the same, so nobody can use this form to find out
 * which emails have an account. The email link comes from the "Reset password" template and goes through
 * /auth/confirm to /set-password. GoTrue rate-limits repeated requests.
 *
 * Sending the email (SMTP) takes noticeably longer when the account exists, so waiting for it would leak
 * that fact through response time. The request therefore runs after the response has gone out (Next's
 * `after()`), and every address gets the same fast answer.
 */
export async function requestPasswordReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const value = formData.get('email');
  const email = typeof value === 'string' ? value.trim() : '';
  if (email) {
    const supabase = await createServerSupabase();
    after(async () => {
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) console.error('forgot-password: reset request failed', error.code ?? error.status);
      } catch {
        console.error('forgot-password: reset request threw');
      }
    });
  }
  return { done: true };
}
