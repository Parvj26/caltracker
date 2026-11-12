import { createServerClient } from '@supabase/ssr';
import type { Database } from '@caltracker/shared';
import { NextResponse, type NextRequest } from 'next/server';

/** Refreshes the Supabase session cookies on every request and redirects signed-out visitors to /sign-in. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getClaims refreshes an expired session (that's what writes the new cookies above) and verifies the token's
  // signature locally with the project's public signing key, so a signed-in page load makes no extra trip to
  // Supabase Auth. (getUser asked the Auth server every time.) Data access is still checked by the database's
  // row-level security on every query, which is the real guard.
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = path === '/sign-in' || path === '/forgot-password' || path === '/auth/confirm' || path.startsWith('/invite/');

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}
