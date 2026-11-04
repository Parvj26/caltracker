import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

const OTP_TYPES: readonly EmailOtpType[] = ['invite', 'recovery', 'signup', 'magiclink', 'email', 'email_change'];

/** Only same-site relative paths: one leading slash, never `//host` or `/\host`. */
export function safeNextPath(next: string | null): string {
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next;
  return '/clients';
}

// Landing point of the links in Supabase auth emails (invite, password reset).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const rawType = searchParams.get('type');
  const type = OTP_TYPES.find((t) => t === rawType);
  const next = safeNextPath(searchParams.get('next'));

  if (tokenHash && type) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL('/sign-in?error=link', request.url));
}
