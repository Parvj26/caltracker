import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  // 303 so the browser follows the POST with a GET.
  return NextResponse.redirect(new URL('/sign-in', request.url), 303);
}
