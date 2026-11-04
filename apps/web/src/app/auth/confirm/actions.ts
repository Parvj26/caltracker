'use server';

import { redirect } from 'next/navigation';
import { isOtpType } from '@/lib/otp-type';
import { safeNextPath } from '@/lib/safe-next';
import { createServerSupabase } from '@/lib/supabase/server';

/** Spends the one-time token from the email link. Runs only when the person presses Continue. */
export async function confirmLink(formData: FormData): Promise<void> {
  const tokenHash = formData.get('token_hash');
  const type = formData.get('type');
  const nextValue = formData.get('next');
  if (typeof tokenHash !== 'string' || typeof type !== 'string' || !isOtpType(type)) {
    redirect('/sign-in?error=link');
  }
  const next = safeNextPath(typeof nextValue === 'string' ? nextValue : null);
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  // Always a fixed, allowlisted same-site path: never anything taken from the request.
  redirect(error ? '/sign-in?error=link' : next);
}
