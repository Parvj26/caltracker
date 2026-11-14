import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createServerSupabase();
  // 'local': end only this browser's session. The default ('global') would also sign the coach out of the
  // mobile/iPad app and every other browser.
  await supabase.auth.signOut({ scope: 'local' });
  // 303 so the browser follows the POST with a GET. A relative Location: the browser resolves it against the address
  // it is actually on. Building it from request.url sent Safari to http://0.0.0.0:3000 on a dev server bound to all
  // interfaces (`next dev -H 0.0.0.0`), and would do the same behind any proxy that doesn't pass the public host on.
  return new NextResponse(null, { status: 303, headers: { Location: '/sign-in' } });
}
