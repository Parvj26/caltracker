import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  // 'local': end only this browser's session, not the admin's phone app.
  await supabase.auth.signOut({ scope: 'local' });
  // 303 so the browser follows the POST with a GET.
  return NextResponse.redirect(new URL('/sign-in', request.url), 303);
}
