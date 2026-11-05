import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  // 'local': end only this browser's session. The default ('global') would also sign the coach out of the
  // mobile/iPad app and every other browser.
  await supabase.auth.signOut({ scope: 'local' });
  // 303 so the browser follows the POST with a GET.
  return NextResponse.redirect(new URL('/sign-in', request.url), 303);
}
