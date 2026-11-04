import type { EmailOtpType } from '@supabase/supabase-js';

const OTP_TYPES: readonly EmailOtpType[] = ['invite', 'recovery', 'signup', 'magiclink', 'email', 'email_change'];

export function isOtpType(value: string | null | undefined): value is EmailOtpType {
  return OTP_TYPES.some((t) => t === value);
}
