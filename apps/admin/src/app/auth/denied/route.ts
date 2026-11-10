import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

/** Not an admin at all: sign out this browser, then show "Not authorised". (A low role stays signed in.) */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut({ scope: 'local' });
  return NextResponse.redirect(new URL('/not-authorised', request.url), 303);
}
