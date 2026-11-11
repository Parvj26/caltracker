'use server';

import { redirect } from 'next/navigation';
import type { ErrorCode } from '@caltracker/shared';
import { createServerSupabase } from '@/lib/supabase/server';

export type SetPasswordState = { code: ErrorCode | null };

export async function setPassword(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const password = formData.get('password');
  const confirm = formData.get('confirm');
  if (typeof password !== 'string' || password.length < 8) {
    return { code: 'password_too_short' };
  }
  if (password !== confirm) return { code: 'password_mismatch' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { code: error.code === 'same_password' ? 'password_reused' : 'password_save_failed' };
  }
  redirect('/home');
}
